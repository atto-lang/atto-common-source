use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Number, Value};
use std::{
    collections::BTreeSet,
    fmt, fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryEvidenceError(pub String);

impl fmt::Display for MemoryEvidenceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}
impl std::error::Error for MemoryEvidenceError {}

fn err(msg: impl Into<String>) -> MemoryEvidenceError {
    MemoryEvidenceError(msg.into())
}

struct StrictValue(Value);

impl<'de> Deserialize<'de> for StrictValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = StrictValue;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("JSON value")
            }
            fn visit_bool<E: de::Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(StrictValue(Value::Bool(v)))
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Self::Value, E> {
                Ok(StrictValue(Value::Number(v.into())))
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Self::Value, E> {
                Ok(StrictValue(Value::Number(v.into())))
            }
            fn visit_f64<E: de::Error>(self, v: f64) -> Result<Self::Value, E> {
                Number::from_f64(v)
                    .map(|n| StrictValue(Value::Number(n)))
                    .ok_or_else(|| E::custom("non-finite number"))
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(StrictValue(Value::String(v.into())))
            }
            fn visit_string<E: de::Error>(self, v: String) -> Result<Self::Value, E> {
                Ok(StrictValue(Value::String(v)))
            }
            fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(StrictValue(Value::Null))
            }
            fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(StrictValue(Value::Null))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
                let mut values = Vec::new();
                while let Some(StrictValue(v)) = a.next_element::<StrictValue>()? {
                    values.push(v);
                }
                Ok(StrictValue(Value::Array(values)))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
                let mut map = Map::new();
                while let Some(key) = a.next_key::<String>()? {
                    if map.contains_key(&key) {
                        return Err(de::Error::custom(format!("duplicate JSON field: {key}")));
                    }
                    let StrictValue(value) = a.next_value::<StrictValue>()?;
                    map.insert(key, value);
                }
                Ok(StrictValue(Value::Object(map)))
            }
        }
        deserializer.deserialize_any(V)
    }
}

pub fn parse_json(text: &str) -> Result<Value, MemoryEvidenceError> {
    let mut de = serde_json::Deserializer::from_str(text);
    let StrictValue(value) = StrictValue::deserialize(&mut de).map_err(|e| err(e.to_string()))?;
    de.end().map_err(|e| err(e.to_string()))?;
    Ok(value)
}

fn obj<'a>(v: &'a Value, label: &str) -> Result<&'a Map<String, Value>, MemoryEvidenceError> {
    v.as_object()
        .ok_or_else(|| err(format!("{label}: expected object")))
}
fn str_field<'a>(
    m: &'a Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<&'a str, MemoryEvidenceError> {
    m.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| err(format!("{label}: invalid {key}")))
}
fn exact_nonnegative_number(v: &Value, field: &str) -> Result<f64, MemoryEvidenceError> {
    if v.is_boolean() {
        return Err(err(format!("{field}: expected finite nonnegative number")));
    }
    let Some(n) = v.as_f64() else {
        return Err(err(format!("{field}: expected finite nonnegative number")));
    };
    if !n.is_finite() || n < 0.0 {
        return Err(err(format!("{field}: expected finite nonnegative number")));
    }
    Ok(n)
}
fn positive_int(v: Option<&Value>, field: &str) -> Result<u64, MemoryEvidenceError> {
    let Some(v) = v else {
        return Err(err(format!("{field}: expected positive integer")));
    };
    if v.is_boolean() {
        return Err(err(format!("{field}: expected positive integer")));
    }
    let Some(n) = v.as_u64() else {
        return Err(err(format!("{field}: expected positive integer")));
    };
    if n < 1 {
        return Err(err(format!("{field}: expected positive integer")));
    }
    Ok(n)
}
fn zero_int(v: Option<&Value>, field: &str) -> Result<(), MemoryEvidenceError> {
    let Some(v) = v else {
        return Err(err(format!("{field}: must be exactly zero")));
    };
    if v.is_boolean() || v.as_i64() != Some(0) {
        return Err(err(format!("{field}: must be exactly zero")));
    }
    Ok(())
}
fn lowercase_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}
fn string_array(v: Option<&Value>, label: &str) -> Result<Vec<String>, MemoryEvidenceError> {
    let Some(a) = v.and_then(Value::as_array) else {
        return Err(err(format!("{label}: invalid proofs")));
    };
    if a.is_empty() {
        return Err(err(format!("{label}: invalid proofs")));
    }
    let mut out = Vec::with_capacity(a.len());
    for item in a {
        let Some(s) = item.as_str().filter(|s| !s.is_empty()) else {
            return Err(err(format!("{label}: invalid proofs")));
        };
        out.push(s.into());
    }
    Ok(out)
}

const EXPECTED_GUEST: [&str; 6] = [
    "llvm-native",
    "desktop-native",
    "wasm32-core",
    "embedded-freestanding",
    "graal-jvm",
    "graal-native-image",
];
const RECORD_FIELDS: [&str; 19] = [
    "schema_version",
    "profile",
    "delivery",
    "source_tree_sha",
    "fixture_blob_sha",
    "binary_sha256",
    "run_id",
    "job_id",
    "executed_steps",
    "executed_guest_tests",
    "failed_tests",
    "skipped_tests",
    "errored_tests",
    "run_conclusion",
    "execution_kind",
    "host_gc_policy",
    "guest_gc_policy",
    "proofs",
    "metrics",
];

pub fn validate_manifest(manifest: &Value) -> Result<&Map<String, Value>, MemoryEvidenceError> {
    let m = obj(manifest, "manifest")?;
    if m.get("schema_version").and_then(Value::as_u64) != Some(1)
        || m.get("schema_version").is_some_and(Value::is_boolean)
    {
        return Err(err("manifest: unsupported schema_version"));
    }
    let shared = string_array(m.get("shared_proofs"), "manifest")
        .map_err(|_| err("manifest: invalid shared_proofs"))?;
    if shared.len() != shared.iter().collect::<BTreeSet<_>>().len() {
        return Err(err("manifest: duplicate shared_proofs"));
    }
    let profiles = m
        .get("profiles")
        .and_then(Value::as_object)
        .ok_or_else(|| err("manifest: missing or unknown target profiles"))?;
    let names: BTreeSet<_> = profiles.keys().map(String::as_str).collect();
    let expected: BTreeSet<_> = EXPECTED_GUEST.into_iter().collect();
    if names != expected {
        return Err(err("manifest: missing or unknown target profiles"));
    }
    let shared_set: BTreeSet<_> = shared.iter().map(String::as_str).collect();
    for (name, pv) in profiles {
        let p = pv
            .as_object()
            .ok_or_else(|| err(format!("{name}: invalid guest GC policy")))?;
        let guest_gc = p
            .get("guest_gc")
            .and_then(Value::as_str)
            .ok_or_else(|| err(format!("{name}: invalid guest GC policy")))?;
        if !matches!(
            guest_gc,
            "forbidden" | "not-required-for-guest-resource-correctness"
        ) {
            return Err(err(format!("{name}: invalid guest GC policy")));
        }
        str_field(p, "host_gc", name)
            .map_err(|_| err(format!("{name}: host GC / delivery missing")))?;
        str_field(p, "delivery", name)
            .map_err(|_| err(format!("{name}: host GC / delivery missing")))?;
        let proofs = string_array(p.get("proofs"), name)?;
        let proofset: BTreeSet<_> = proofs.iter().map(String::as_str).collect();
        if proofs.len() != proofset.len() || proofset.iter().any(|x| shared_set.contains(x)) {
            return Err(err(format!("{name}: duplicate / overlapping proofs")));
        }
        let metrics = p
            .get("metrics")
            .and_then(Value::as_object)
            .ok_or_else(|| err(format!("{name}: invalid metric rules")))?;
        if metrics.is_empty()
            || metrics
                .values()
                .any(|v| !matches!(v.as_str(), Some("zero" | "measured")))
        {
            return Err(err(format!("{name}: invalid metric rules")));
        }
        if guest_gc == "forbidden" && !metrics.keys().any(|k| k.contains("gc_invocations")) {
            return Err(err(format!("{name}: missing guest/no-tracing GC counter")));
        }
    }
    Ok(profiles)
}

pub fn check_record(manifest: &Value, record: &Value) -> Result<String, MemoryEvidenceError> {
    let profiles = validate_manifest(manifest)?;
    let r = obj(record, "record")?;
    if r.get("schema_version").and_then(Value::as_u64) != Some(1)
        || r.get("schema_version").is_some_and(Value::is_boolean)
    {
        return Err(err("record: unsupported schema_version"));
    }
    let actual: BTreeSet<_> = r.keys().map(String::as_str).collect();
    let expected: BTreeSet<_> = RECORD_FIELDS.into_iter().collect();
    if actual != expected {
        return Err(err("record: unknown/missing evidence fields"));
    }
    let name = r
        .get("profile")
        .and_then(Value::as_str)
        .ok_or_else(|| err("record: unknown profile"))?;
    let profile = profiles
        .get(name)
        .and_then(Value::as_object)
        .ok_or_else(|| err("record: unknown profile"))?;
    if r.get("delivery") != profile.get("delivery") {
        return Err(err("record: delivery mismatch (no fallback allowed)"));
    }
    for (field, len) in [
        ("source_tree_sha", 40usize),
        ("fixture_blob_sha", 40),
        ("binary_sha256", 64),
    ] {
        let Some(s) = r.get(field).and_then(Value::as_str) else {
            return Err(err(format!("record: invalid {field}")));
        };
        if !lowercase_hex(s, len) {
            return Err(err(format!("record: invalid {field}")));
        }
    }
    for field in ["run_id", "job_id", "executed_steps", "executed_guest_tests"] {
        positive_int(r.get(field), field)?;
    }
    for field in ["failed_tests", "skipped_tests", "errored_tests"] {
        zero_int(r.get(field), field)?;
    }
    if r.get("run_conclusion").and_then(Value::as_str) != Some("success")
        || r.get("execution_kind").and_then(Value::as_str) != Some("compiled-guest")
    {
        return Err(err("record: missing successful compiled-guest execution"));
    }
    if r.get("host_gc_policy") != profile.get("host_gc") {
        return Err(err("record: missing host GC boundary disclosure"));
    }
    if r.get("guest_gc_policy") != profile.get("guest_gc") {
        return Err(err("record: guest GC policy mismatch"));
    }

    let manifest_obj = manifest.as_object().unwrap();
    let shared = string_array(manifest_obj.get("shared_proofs"), "manifest")
        .map_err(|_| err("manifest: invalid shared_proofs"))?;
    let own = string_array(profile.get("proofs"), name)?;
    let mut needed = shared;
    needed.extend(own);
    let proofs = r
        .get("proofs")
        .and_then(Value::as_object)
        .ok_or_else(|| err("record: missing/unknown/failed mandatory ownership/GC proof"))?;
    let proof_keys: BTreeSet<_> = proofs.keys().map(String::as_str).collect();
    let needed_keys: BTreeSet<_> = needed.iter().map(String::as_str).collect();
    if proof_keys != needed_keys
        || needed
            .iter()
            .any(|p| proofs.get(p) != Some(&Value::Bool(true)))
    {
        return Err(err(
            "record: missing/unknown/failed mandatory ownership/GC proof",
        ));
    }
    let metric_rules = profile.get("metrics").and_then(Value::as_object).unwrap();
    let metrics = r
        .get("metrics")
        .and_then(Value::as_object)
        .ok_or_else(|| err("record: missing/unknown metrics"))?;
    let metric_keys: BTreeSet<_> = metrics.keys().map(String::as_str).collect();
    let expected_metric_keys: BTreeSet<_> = metric_rules.keys().map(String::as_str).collect();
    if metric_keys != expected_metric_keys {
        return Err(err("record: missing/unknown metrics"));
    }
    for (metric, rule) in metric_rules {
        let val = metrics
            .get(metric)
            .ok_or_else(|| err("record: missing/unknown metrics"))?;
        let n = exact_nonnegative_number(val, metric)?;
        if rule.as_str() == Some("zero") && n != 0.0 {
            return Err(err(format!("record: nonzero counter {metric}")));
        }
    }
    Ok(name.into())
}

pub fn run(manifest_path: &Path, evidence_path: &Path) -> Result<String, MemoryEvidenceError> {
    let manifest_text = fs::read_to_string(manifest_path).map_err(|e| err(e.to_string()))?;
    let evidence_text = fs::read_to_string(evidence_path).map_err(|e| err(e.to_string()))?;
    let manifest = parse_json(&manifest_text)?;
    let evidence = parse_json(&evidence_text)?;
    check_record(&manifest, &evidence)
}

pub fn default_manifest_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../contracts/v1/memory-runtime-profiles.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn manifest() -> Value {
        parse_json(include_str!(
            "../../../contracts/v1/memory-runtime-profiles.json"
        ))
        .unwrap()
    }
    fn synthetic(name: &str) -> Value {
        let m = manifest();
        let p = &m["profiles"][name];
        let mut proofs = Map::new();
        for x in m["shared_proofs"]
            .as_array()
            .unwrap()
            .iter()
            .chain(p["proofs"].as_array().unwrap())
        {
            proofs.insert(x.as_str().unwrap().into(), Value::Bool(true));
        }
        let mut metrics = Map::new();
        for k in p["metrics"].as_object().unwrap().keys() {
            metrics.insert(k.clone(), Value::Number(0.into()));
        }
        serde_json::json!({
            "schema_version":1,"profile":name,"delivery":p["delivery"],
            "source_tree_sha":"a".repeat(40),"fixture_blob_sha":"b".repeat(40),"binary_sha256":"c".repeat(64),
            "run_id":12,"job_id":13,"executed_steps":4,"executed_guest_tests":22,
            "failed_tests":0,"skipped_tests":0,"errored_tests":0,
            "run_conclusion":"success","execution_kind":"compiled-guest",
            "host_gc_policy":p["host_gc"],"guest_gc_policy":p["guest_gc"],
            "proofs":Value::Object(proofs),"metrics":Value::Object(metrics)
        })
    }
    fn reject(name: &str, mutate: impl FnOnce(&mut Value)) {
        let m = manifest();
        let mut r = synthetic(name);
        mutate(&mut r);
        assert!(check_record(&m, &r).is_err());
    }

    #[test]
    fn manifest_has_six_modes_and_synthetic_records_pass() {
        let m = manifest();
        assert_eq!(validate_manifest(&m).unwrap().len(), 6);
        for name in EXPECTED_GUEST {
            assert_eq!(check_record(&m, &synthetic(name)).unwrap(), name);
        }
    }
    #[test]
    fn rejects_zero_step_failures_and_fake_execution_kind() {
        reject("llvm-native", |r| r["executed_steps"] = 0.into());
        reject("llvm-native", |r| r["executed_guest_tests"] = 0.into());
        reject("llvm-native", |r| r["execution_kind"] = "host-model".into());
        for f in ["failed_tests", "skipped_tests", "errored_tests"] {
            reject("llvm-native", |r| r[f] = 1.into());
            reject("llvm-native", |r| r[f] = Value::Bool(false));
        }
        reject("llvm-native", |r| r["run_conclusion"] = "cancelled".into());
    }
    #[test]
    fn rejects_missing_false_and_nonboolean_required_proofs() {
        let m = manifest();
        let p = m["shared_proofs"][0].as_str().unwrap().to_string();
        reject("wasm32-core", |r| {
            r["proofs"].as_object_mut().unwrap().remove(&p);
        });
        reject("wasm32-core", |r| r["proofs"][&p] = Value::Bool(false));
        reject("wasm32-core", |r| r["proofs"][&p] = 1.into());
        for proof in [
            "abandoned_frame_cleanup_ack_before_retirement",
            "actor_execution_lane_quorum_before_retirement",
        ] {
            for name in EXPECTED_GUEST {
                reject(name, |r| {
                    r["proofs"].as_object_mut().unwrap().remove(proof);
                });
                reject(name, |r| r["proofs"][proof] = Value::Bool(false));
                reject(name, |r| r["proofs"][proof] = 1.into());
            }
        }
    }
    #[test]
    fn rejects_nonzero_strict_gc_and_hidden_hotpath_allocations() {
        reject("llvm-native", |r| {
            r["metrics"]["tracing_gc_invocations"] = 1.into()
        });
        reject("wasm32-core", |r| {
            r["metrics"]["wasm_gc_opcode_count"] = 1.into()
        });
        reject("embedded-freestanding", |r| {
            r["metrics"]["post_init_heap_alloc_bytes_in_no_alloc_region"] = 1.into()
        });
        for name in ["graal-jvm", "graal-native-image"] {
            reject(name, |r| {
                r["metrics"]["steady_state_guest_hot_loop_alloc_bytes_per_op"] =
                    serde_json::json!(0.01)
            });
        }
    }
    #[test]
    fn rejects_fake_delivery_gc_boundaries_and_invalid_provenance() {
        reject("llvm-native", |r| r["delivery"] = "jvm-jit".into());
        reject("graal-native-image", |r| r["delivery"] = "jvm-jit".into());
        reject("wasm32-core", |r| r["host_gc_policy"] = "forbidden".into());
        reject("graal-jvm", |r| r["guest_gc_policy"] = "forbidden".into());
        reject("desktop-native", |r| r["source_tree_sha"] = "abc".into());
        reject("desktop-native", |r| {
            r["binary_sha256"] = "x".repeat(64).into()
        });
        reject("desktop-native", |r| {
            r["metrics"]["alloc_bytes_per_operation"] = (-1).into()
        });
        reject("desktop-native", |r| {
            r["metrics"]["alloc_bytes_per_operation"] = Value::Bool(true)
        });
    }
    #[test]
    fn schema_types_and_duplicate_json_keys_fail_closed() {
        reject("llvm-native", |r| r["schema_version"] = Value::Bool(true));
        reject("graal-jvm", |r| {
            r["profile"] = serde_json::json!(["invalid"])
        });
        let mut m = manifest();
        m["schema_version"] = Value::Bool(true);
        assert!(validate_manifest(&m).is_err());
        assert!(parse_json("{\"run_id\":1,\"run_id\":2}")
            .unwrap_err()
            .0
            .contains("duplicate JSON field"));
        assert!(parse_json("{\"metrics\":{\"x\":0,\"x\":1}}")
            .unwrap_err()
            .0
            .contains("duplicate JSON field"));
    }
    #[test]
    fn rejects_unregistered_or_missing_evidence_fields() {
        reject("llvm-native", |r| {
            r["proofs"]["extra_proof"] = Value::Bool(true);
        });
        reject("wasm32-core", |r| {
            r["metrics"]["extra_metric"] = 0.into();
        });
        reject("graal-native-image", |r| {
            r["extra_field"] = Value::Bool(true);
        });
        reject("graal-jvm", |r| {
            r["metrics"]
                .as_object_mut()
                .unwrap()
                .remove("jvm_gc_invocations");
        });
    }
    #[test]
    fn newly_mandatory_manifest_proof_is_not_silently_ignored() {
        let mut m = manifest();
        m["shared_proofs"]
            .as_array_mut()
            .unwrap()
            .push("new_mandatory_borrow_boundary".into());
        assert!(check_record(&m, &synthetic("llvm-native")).is_err());
    }
}
