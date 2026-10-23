//! Experimental, backend-neutral Oreslang incremental query model.
//!
//! This is a reference model, not a language parser, compiler, production
//! cache, or security-sensitive compiler authority.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const MAX_DEPTH: usize = 64;
const MAX_INPUT_BYTES: usize = 1_048_576;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueryError {
    InvalidSchemaVersion,
    InvalidInputName,
    InputDepthExceeded,
    InputTooLarge,
    QueryIdentityMustBeString,
    QueryCycle(QueryKey),
    QueryDepthExceeded,
    InvalidRegistry,
    DuplicateRegistrySymbol,
    InvalidCallList,
    InvalidObjectIdentity,
    InvalidInliningList,
    InvalidInlineDependency,
    MissingToolchain(String),
    InvalidFunction(String),
    UnknownQueryType(String),
    InternalValueShape,
}

impl std::fmt::Display for QueryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidSchemaVersion => f.write_str("A nonempty semantic schema version is required"),
            Self::InvalidInputName => f.write_str("Input names must be nonempty strings"),
            Self::InputDepthExceeded => f.write_str("Input nesting exceeds 64 levels"),
            Self::InputTooLarge => f.write_str("Input exceeds the 1 MiB reference-model limit"),
            Self::QueryIdentityMustBeString => f.write_str("Query kind and identity must be strings"),
            Self::QueryCycle(key) => write!(f, "Cyclic query: {key:?}"),
            Self::QueryDepthExceeded => f.write_str("Query depth exceeds the reference-model limit"),
            Self::InvalidRegistry => f.write_str("Registry must be a list of symbol names"),
            Self::DuplicateRegistrySymbol => f.write_str("Duplicate symbols in registry"),
            Self::InvalidCallList => f.write_str("Call list must be a list of symbols"),
            Self::InvalidObjectIdentity => {
                f.write_str("Object queries require a single target/function separator")
            }
            Self::InvalidInliningList => {
                f.write_str("Inlining dependencies must be a list of symbols")
            }
            Self::InvalidInlineDependency => f.write_str("Invalid inline dependency"),
            Self::MissingToolchain(target) => {
                write!(f, "Missing toolchain contract for {target}")
            }
            Self::InvalidFunction(name) => write!(f, "Unresolved or invalid function {name}"),
            Self::UnknownQueryType(kind) => write!(f, "Unknown query type: {kind}"),
            Self::InternalValueShape => f.write_str("Internal query value shape mismatch"),
        }
    }
}
impl std::error::Error for QueryError {}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct QueryKey {
    pub kind: String,
    pub symbol: String,
}

impl QueryKey {
    fn new(kind: &str, symbol: &str) -> Self {
        Self {
            kind: kind.to_owned(),
            symbol: symbol.to_owned(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum QueryValue {
    Json(Value),
    MissingInput(String),
}

impl QueryValue {
    fn json(&self) -> Result<&Value, QueryError> {
        match self {
            Self::Json(value) => Ok(value),
            Self::MissingInput(_) => Err(QueryError::InternalValueShape),
        }
    }

    fn into_json(self) -> Result<Value, QueryError> {
        match self {
            Self::Json(value) => Ok(value),
            Self::MissingInput(_) => Err(QueryError::InternalValueShape),
        }
    }

    fn is_missing(&self) -> bool {
        matches!(self, Self::MissingInput(_))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct QueryResult {
    pub value: QueryValue,
    pub fingerprint: String,
    pub dependencies: Vec<(QueryKey, String)>,
}

#[derive(Debug, Clone)]
pub struct QueryEngine {
    schema_version: String,
    inputs: BTreeMap<String, Value>,
    cache: BTreeMap<QueryKey, QueryResult>,
    computations: BTreeMap<QueryKey, u64>,
    frames: Vec<BTreeMap<QueryKey, String>>,
    active: BTreeSet<QueryKey>,
}

impl QueryEngine {
    pub fn new(schema_version: &str) -> Result<Self, QueryError> {
        if schema_version.is_empty() {
            return Err(QueryError::InvalidSchemaVersion);
        }
        Ok(Self {
            schema_version: schema_version.to_owned(),
            inputs: BTreeMap::new(),
            cache: BTreeMap::new(),
            computations: BTreeMap::new(),
            frames: Vec::new(),
            active: BTreeSet::new(),
        })
    }

    pub fn demo() -> Self {
        let mut q = Self::new("incremental-demo-v1").expect("valid fixed schema");
        q.set_input("registry", json!(["f", "g"])).unwrap();
        for (name, calls) in [("f", json!([])), ("g", json!(["f"]))] {
            q.set_input(&format!("signature:{name}"), json!("fn(int) -> int"))
                .unwrap();
            q.set_input(&format!("effects:{name}"), json!(["pure"]))
                .unwrap();
            q.set_input(
                &format!("body:{name}"),
                json!(if name == "f" { "return 1" } else { "return f(1)" }),
            )
            .unwrap();
            q.set_input(&format!("calls:{name}"), calls).unwrap();
            q.set_input(&format!("inlines:{name}"), json!([]))
                .unwrap();
        }
        q.set_input("toolchain:llvm", json!("llvm@pinned")).unwrap();
        q.set_input("toolchain:wasm", json!("wasm@pinned")).unwrap();
        q
    }

    pub fn schema_version(&self) -> &str {
        &self.schema_version
    }

    pub fn computation_count(&self, kind: &str, symbol: &str) -> u64 {
        *self
            .computations
            .get(&QueryKey::new(kind, symbol))
            .unwrap_or(&0)
    }

    pub fn computation_counts(&self) -> &BTreeMap<QueryKey, u64> {
        &self.computations
    }

    pub fn set_input(&mut self, name: &str, value: Value) -> Result<bool, QueryError> {
        if name.is_empty() {
            return Err(QueryError::InvalidInputName);
        }
        validate_depth(&value, 0)?;
        let encoded = serde_json::to_vec(&value).map_err(|_| QueryError::InternalValueShape)?;
        if encoded.len() > MAX_INPUT_BYTES {
            return Err(QueryError::InputTooLarge);
        }

        if let Some(previous) = self.inputs.get(name) {
            if self.digest(&QueryValue::Json(previous.clone()))?
                == self.digest(&QueryValue::Json(value.clone()))?
            {
                return Ok(false);
            }
        }

        self.inputs.insert(name.to_owned(), value);
        self.cache.remove(&QueryKey::new("input", name));
        Ok(true)
    }

    pub fn result(&mut self, kind: &str, symbol: &str) -> Result<QueryResult, QueryError> {
        self.evaluate(QueryKey::new(kind, symbol))
    }

    fn use_query(&mut self, kind: &str, symbol: &str) -> Result<QueryValue, QueryError> {
        let key = QueryKey::new(kind, symbol);
        let child = self.evaluate(key.clone())?;
        if let Some(frame) = self.frames.last_mut() {
            frame.insert(key, child.fingerprint.clone());
        }
        Ok(child.value)
    }

    fn evaluate(&mut self, key: QueryKey) -> Result<QueryResult, QueryError> {
        if self.active.contains(&key) {
            return Err(QueryError::QueryCycle(key));
        }
        if self.active.len() >= MAX_DEPTH {
            return Err(QueryError::QueryDepthExceeded);
        }
        self.active.insert(key.clone());

        let outcome = self.evaluate_active(&key);
        self.active.remove(&key);
        outcome
    }

    fn evaluate_active(&mut self, key: &QueryKey) -> Result<QueryResult, QueryError> {
        if let Some(cached) = self.cache.get(key).cloned() {
            let mut green = true;
            for (dep, fingerprint) in &cached.dependencies {
                if self.evaluate(dep.clone())?.fingerprint != *fingerprint {
                    green = false;
                    break;
                }
            }
            if green {
                return Ok(cached);
            }
        }

        self.frames.push(BTreeMap::new());
        let computed = self.compute(&key.kind, &key.symbol);
        let frame = self.frames.pop().expect("frame was just pushed");
        let value = computed?;
        let dependencies = frame.into_iter().collect::<Vec<_>>();
        let result = QueryResult {
            fingerprint: self.digest(&value)?,
            value,
            dependencies,
        };

        *self.computations.entry(key.clone()).or_insert(0) += 1;
        self.cache.insert(key.clone(), result.clone());
        Ok(result)
    }

    fn digest(&self, value: &QueryValue) -> Result<String, QueryError> {
        let payload = match value {
            QueryValue::MissingInput(name) => {
                json!({"kind":"missing-input","name":name})
            }
            QueryValue::Json(value) => {
                json!({"kind":"present-value","value":value})
            }
        };
        let envelope = json!({
            "payload": payload,
            "schema": self.schema_version,
        });
        let encoded =
            serde_json::to_vec(&envelope).map_err(|_| QueryError::InternalValueShape)?;
        let digest = Sha256::digest(encoded);
        Ok(format!("{digest:x}"))
    }

    fn compute(&mut self, kind: &str, identity: &str) -> Result<QueryValue, QueryError> {
        match kind {
            "input" => {
                if let Some(value) = self.inputs.get(identity) {
                    Ok(QueryValue::Json(value.clone()))
                } else {
                    Ok(QueryValue::MissingInput(identity.to_owned()))
                }
            }
            "lookup" => {
                let names = self.use_query("input", "registry")?;
                let names = json_string_list(&names).ok_or(QueryError::InvalidRegistry)?;
                let unique = names.iter().collect::<BTreeSet<_>>();
                if unique.len() != names.len() {
                    return Err(QueryError::DuplicateRegistrySymbol);
                }
                Ok(QueryValue::Json(json!(names.iter().any(|name| name == identity))))
            }
            "interface" => {
                let exists = self
                    .use_query("lookup", identity)?
                    .json()?
                    .as_bool()
                    .ok_or(QueryError::InternalValueShape)?;
                if !exists {
                    return Ok(QueryValue::Json(json!({"missing":identity})));
                }
                let signature = self.use_query("input", &format!("signature:{identity}"))?;
                let effects = self.use_query("input", &format!("effects:{identity}"))?;
                if signature.is_missing() || effects.is_missing() {
                    return Ok(QueryValue::Json(json!({"missing":identity})));
                }
                Ok(QueryValue::Json(json!({
                    "effects": effects.into_json()?,
                    "signature": signature.into_json()?,
                })))
            }
            "typed" => {
                let own_interface = self.use_query("interface", identity)?.into_json()?;
                let body = self.use_query("input", &format!("body:{identity}"))?;
                let calls = self.use_query("input", &format!("calls:{identity}"))?;
                if body.is_missing() || calls.is_missing() {
                    return Ok(QueryValue::Json(
                        json!({"missing_input":identity,"valid":false}),
                    ));
                }
                let calls = json_string_list(&calls).ok_or(QueryError::InvalidCallList)?;
                let mut dependencies = Vec::with_capacity(calls.len());
                for name in calls {
                    let iface = self.use_query("interface", &name)?.into_json()?;
                    dependencies.push(json!([name, iface]));
                }
                let own_missing = own_interface
                    .as_object()
                    .is_some_and(|o| o.contains_key("missing"));
                let dep_missing = dependencies.iter().any(|pair| {
                    pair.get(1)
                        .and_then(Value::as_object)
                        .is_some_and(|o| o.contains_key("missing"))
                });
                Ok(QueryValue::Json(json!({
                    "body": body.into_json()?,
                    "callee_interfaces": dependencies,
                    "own_interface": own_interface,
                    "valid": !own_missing && !dep_missing,
                })))
            }
            "mir" => {
                let typed = self.use_query("typed", identity)?.into_json()?;
                let valid = typed
                    .get("valid")
                    .and_then(Value::as_bool)
                    .ok_or(QueryError::InternalValueShape)?;
                Ok(QueryValue::Json(json!({
                    "typed": typed,
                    "verified": valid,
                })))
            }
            "object" => {
                let Some(separator) = identity.find('\0') else {
                    return Err(QueryError::InvalidObjectIdentity);
                };
                let target = &identity[..separator];
                let function = &identity[separator + 1..];
                if target.is_empty() || function.is_empty() || function.contains('\0') {
                    return Err(QueryError::InvalidObjectIdentity);
                }

                let mir = self.use_query("mir", function)?.into_json()?;
                if mir.get("verified").and_then(Value::as_bool) != Some(true) {
                    return Err(QueryError::InvalidFunction(function.to_owned()));
                }

                let inlines = self.use_query("input", &format!("inlines:{function}"))?;
                let inlines = json_string_list(&inlines).ok_or(QueryError::InvalidInliningList)?;
                let mut embedded = Vec::with_capacity(inlines.len());
                for name in inlines {
                    let inline = self.use_query("mir", &name)?.into_json()?;
                    if inline.get("verified").and_then(Value::as_bool) != Some(true) {
                        return Err(QueryError::InvalidInlineDependency);
                    }
                    embedded.push(json!([name, inline]));
                }

                let toolchain = self.use_query("input", &format!("toolchain:{target}"))?;
                if toolchain.is_missing() {
                    return Err(QueryError::MissingToolchain(target.to_owned()));
                }
                Ok(QueryValue::Json(json!({
                    "inlines": embedded,
                    "mir": mir,
                    "target": target,
                    "toolchain": toolchain.into_json()?,
                })))
            }
            "link" => {
                let symbols = self.use_query("input", "registry")?;
                let mut symbols = json_string_list(&symbols).ok_or(QueryError::InvalidRegistry)?;
                symbols.sort();
                let mut artifacts = Vec::with_capacity(symbols.len());
                for name in symbols {
                    let object_identity = format!("{identity}\0{name}");
                    let artifact = self.use_query("object", &object_identity)?.into_json()?;
                    artifacts.push(json!([name, artifact]));
                }
                Ok(QueryValue::Json(json!({
                    "artifacts": artifacts,
                    "target": identity,
                })))
            }
            other => Err(QueryError::UnknownQueryType(other.to_owned())),
        }
    }
}

fn json_string_list(value: &QueryValue) -> Option<Vec<String>> {
    let QueryValue::Json(Value::Array(items)) = value else {
        return None;
    };
    items
        .iter()
        .map(|item| item.as_str().map(ToOwned::to_owned))
        .collect()
}

fn validate_depth(value: &Value, depth: usize) -> Result<(), QueryError> {
    if depth > MAX_DEPTH {
        return Err(QueryError::InputDepthExceeded);
    }
    match value {
        Value::Array(items) => {
            for item in items {
                validate_depth(item, depth + 1)?;
            }
        }
        Value::Object(map) => {
            for item in map.values() {
                validate_depth(item, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json_result(result: QueryResult) -> Value {
        result.value.into_json().unwrap()
    }

    #[test]
    fn noop_and_identical_input_are_fully_green() {
        let mut q = QueryEngine::demo();
        let first = q.result("link", "llvm").unwrap().fingerprint;
        let counts = q.computation_counts().clone();
        assert!(!q.set_input("body:f", json!("return 1")).unwrap());
        assert_eq!(q.result("link", "llvm").unwrap().fingerprint, first);
        assert_eq!(q.computation_counts(), &counts);
    }

    #[test]
    fn body_edit_does_not_retypecheck_noninlined_callers() {
        let mut q = QueryEngine::demo();
        q.result("link", "llvm").unwrap();
        let typed_g = q.result("typed", "g").unwrap().fingerprint;
        let typed_g_before = q.computation_count("typed", "g");
        let object_g_before = q.computation_count("object", "llvm\0g");
        let object_f_before = q.computation_count("object", "llvm\0f");
        let link_before = q.computation_count("link", "llvm");

        q.set_input("body:f", json!("return 3")).unwrap();
        q.result("link", "llvm").unwrap();

        assert_eq!(q.result("typed", "g").unwrap().fingerprint, typed_g);
        assert_eq!(q.computation_count("typed", "g"), typed_g_before);
        assert_eq!(q.computation_count("object", "llvm\0g"), object_g_before);
        assert!(q.computation_count("object", "llvm\0f") > object_f_before);
        assert!(q.computation_count("link", "llvm") > link_before);
    }

    #[test]
    fn signature_edit_invalidates_typed_dependents() {
        let mut q = QueryEngine::demo();
        q.result("link", "llvm").unwrap();
        let interface_before = q.computation_count("interface", "f");
        let typed_g_before = q.computation_count("typed", "g");
        let object_g_before = q.computation_count("object", "llvm\0g");

        q.set_input("signature:f", json!("fn(int) -> string"))
            .unwrap();
        q.result("link", "llvm").unwrap();

        assert!(q.computation_count("interface", "f") > interface_before);
        assert!(q.computation_count("typed", "g") > typed_g_before);
        assert!(q.computation_count("object", "llvm\0g") > object_g_before);
    }

    #[test]
    fn inlining_invalidates_codegen_but_not_caller_type() {
        let mut q = QueryEngine::demo();
        q.set_input("inlines:g", json!(["f"])).unwrap();
        q.result("link", "llvm").unwrap();
        let typed_g_before = q.computation_count("typed", "g");
        let object_g_before = q.computation_count("object", "llvm\0g");

        q.set_input("body:f", json!("return 5")).unwrap();
        q.result("link", "llvm").unwrap();

        assert_eq!(q.computation_count("typed", "g"), typed_g_before);
        assert!(q.computation_count("object", "llvm\0g") > object_g_before);
    }

    #[test]
    fn negative_resolution_dependency_recovers_when_symbol_appears() {
        let mut q = QueryEngine::demo();
        q.set_input("calls:g", json!(["later"])).unwrap();
        let first = q.result("typed", "g").unwrap();
        assert_eq!(first.value.json().unwrap()["valid"], false);

        q.set_input("registry", json!(["f", "g", "later"])).unwrap();
        q.set_input("signature:later", json!("fn() -> int")).unwrap();
        q.set_input("effects:later", json!([])).unwrap();
        q.set_input("body:later", json!("return 6")).unwrap();
        q.set_input("calls:later", json!([])).unwrap();
        q.set_input("inlines:later", json!([])).unwrap();

        let second = q.result("typed", "g").unwrap();
        assert_eq!(second.value.json().unwrap()["valid"], true);
        assert_ne!(first.fingerprint, second.fingerprint);
    }

    #[test]
    fn target_specific_changes_reuse_target_neutral_analysis() {
        let mut q = QueryEngine::demo();
        q.result("link", "llvm").unwrap();
        q.result("link", "wasm").unwrap();
        let typed_f_before = q.computation_count("typed", "f");
        let typed_g_before = q.computation_count("typed", "g");
        let llvm_f_before = q.computation_count("object", "llvm\0f");
        let wasm_f_before = q.computation_count("object", "wasm\0f");

        q.set_input("toolchain:wasm", json!("wasm@new")).unwrap();
        q.result("link", "wasm").unwrap();
        q.result("link", "llvm").unwrap();

        assert_eq!(q.computation_count("typed", "f"), typed_f_before);
        assert_eq!(q.computation_count("typed", "g"), typed_g_before);
        assert_eq!(q.computation_count("object", "llvm\0f"), llvm_f_before);
        assert!(q.computation_count("object", "wasm\0f") > wasm_f_before);
    }

    #[test]
    fn input_bounds_and_noop_semantics_are_fail_closed() {
        let mut q = QueryEngine::demo();
        assert_eq!(q.set_input("", json!(1)), Err(QueryError::InvalidInputName));

        let mut nested = json!(0);
        for _ in 0..=MAX_DEPTH {
            nested = json!([nested]);
        }
        assert_eq!(
            q.set_input("too-deep", nested),
            Err(QueryError::InputDepthExceeded)
        );

        let oversized = "x".repeat(MAX_INPUT_BYTES + 1);
        assert_eq!(
            q.set_input("too-large", json!(oversized)),
            Err(QueryError::InputTooLarge)
        );
    }

    #[test]
    fn malformed_registry_calls_object_identity_and_toolchain_reject() {
        let mut q = QueryEngine::demo();
        q.set_input("registry", json!(["f", "f"])).unwrap();
        assert_eq!(
            q.result("lookup", "f").unwrap_err(),
            QueryError::DuplicateRegistrySymbol
        );

        let mut q = QueryEngine::demo();
        q.set_input("calls:g", json!("f")).unwrap();
        assert_eq!(
            q.result("typed", "g").unwrap_err(),
            QueryError::InvalidCallList
        );

        let mut q = QueryEngine::demo();
        assert_eq!(
            q.result("object", "llvm").unwrap_err(),
            QueryError::InvalidObjectIdentity
        );
        assert_eq!(
            q.result("object", "\0f").unwrap_err(),
            QueryError::InvalidObjectIdentity
        );
        assert_eq!(
            q.result("object", "llvm\0f\0g").unwrap_err(),
            QueryError::InvalidObjectIdentity
        );

        let mut q = QueryEngine::demo();
        q.inputs.remove("toolchain:llvm");
        q.cache.remove(&QueryKey::new("input", "toolchain:llvm"));
        assert_eq!(
            q.result("object", "llvm\0f").unwrap_err(),
            QueryError::MissingToolchain("llvm".into())
        );
    }

    #[test]
    fn missing_inputs_are_distinct_from_forgeable_json() {
        let mut q = QueryEngine::new("incremental-demo-v1").unwrap();
        let missing = q.result("input", "x").unwrap().fingerprint;
        q.set_input("x", json!({"kind":"missing-input","name":"x"}))
            .unwrap();
        let forged = q.result("input", "x").unwrap().fingerprint;
        assert_ne!(missing, forged);
    }

    #[test]
    fn unknown_query_kind_rejects() {
        let mut q = QueryEngine::demo();
        assert_eq!(
            q.result("mystery", "f").unwrap_err(),
            QueryError::UnknownQueryType("mystery".into())
        );
    }

    #[test]
    fn link_orders_registry_symbols_deterministically() {
        let mut q = QueryEngine::demo();
        q.set_input("registry", json!(["g", "f"])).unwrap();
        let link = json_result(q.result("link", "llvm").unwrap());
        assert_eq!(link["artifacts"][0][0], "f");
        assert_eq!(link["artifacts"][1][0], "g");
    }
}
