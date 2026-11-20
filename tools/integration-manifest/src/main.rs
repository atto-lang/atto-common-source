//! Shared source-free manifest contract checker. Never claims backend integration or CI parity.
use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Number, Value};
use std::{collections::BTreeSet, env, fmt, fs, io::Read, path::{Path, PathBuf}};
#[cfg(target_os="linux")]
use std::os::unix::fs::OpenOptionsExt;

const MAX_BYTES: u64 = 4096;
const PROTOCOL: &str = "oreslang-ecosystem-integration";
const NOTE: &str = "Declared integration touchpoints only; no CI or runtime parity is asserted.";
const FIELDS: [&str; 7] = ["schemaVersion","protocol","repository","role","upstreams","evidence","note"];

fn upstreams(name: &str) -> Option<&'static [&'static str]> {
    match name {
        "oreslang-source.java" | "oreslang-source.llvm" | "oreslang-source.js"
        | "oreslang-source.hdl" | "oreslang-source.forge" | "oreslang-source.net"
            => Some(&["oreslang-common-source", "oreslang-target-profiles"]),
        "oreslang-source.wasm" => Some(&[
            "oreslang-source.llvm", "oreslang-target-profiles", "oreslang-wasm",
        ]),
        _ => None,
    }
}

struct Strict(Value);

struct StrictVisitor;

impl<'de> Visitor<'de> for StrictVisitor {
    type Value = Strict;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("strict JSON value without duplicate keys")
    }
    fn visit_bool<E: de::Error>(self, v: bool) -> Result<Self::Value, E> {
        Ok(Strict(Value::Bool(v)))
    }
    fn visit_i64<E: de::Error>(self, v: i64) -> Result<Self::Value, E> {
        Ok(Strict(Value::Number(Number::from(v))))
    }
    fn visit_u64<E: de::Error>(self, v: u64) -> Result<Self::Value, E> {
        Ok(Strict(Value::Number(Number::from(v))))
    }
    fn visit_f64<E: de::Error>(self, _: f64) -> Result<Self::Value, E> {
        Err(E::custom("non-integer JSON numbers are forbidden in integration manifests"))
    }
    fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
        Ok(Strict(Value::String(v.to_owned())))
    }
    fn visit_string<E: de::Error>(self, v: String) -> Result<Self::Value, E> {
        Ok(Strict(Value::String(v)))
    }
    fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(Strict(Value::Null))
    }
    fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(Strict(Value::Null))
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        let mut values = Vec::new();
        while let Some(Strict(value)) = seq.next_element::<Strict>()? {
            if values.len() >= 512 {
                return Err(de::Error::custom("array exceeds admission budget"));
            }
            values.push(value);
        }
        Ok(Strict(Value::Array(values)))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut values = Map::new();
        while let Some((key, Strict(value))) = map.next_entry::<String, Strict>()? {
            if values.len() >= 512 {
                return Err(de::Error::custom("object exceeds admission budget"));
            }
            if values.insert(key.clone(), value).is_some() {
                return Err(de::Error::custom(format!("duplicate JSON key: {key}")));
            }
        }
        Ok(Strict(Value::Object(values)))
    }
}

impl<'de> Deserialize<'de> for Strict {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(StrictVisitor)
    }
}

fn validate_value(document: &Value, repository_name: &str) -> Result<(), String> {
    let expected_upstreams = upstreams(repository_name).ok_or("unknown source repository")?;
    let map = document.as_object().ok_or("manifest must be an object")?;
    let expected: BTreeSet<_> = FIELDS.iter().copied().collect();
    let actual: BTreeSet<_> = map.keys().map(String::as_str).collect();
    if actual != expected || map.len() != 7 {
        return Err("manifest must contain exactly seven declared keys".into());
    }
    if map["schemaVersion"].as_u64() != Some(1) || map["schemaVersion"].as_bool().is_some() {
        return Err("unsupported schemaVersion".into());
    }
    if map["protocol"].as_str() != Some(PROTOCOL) {
        return Err("unsupported integration protocol".into());
    }
    let expected_identity = format!("ores-truffle-oreslang/{repository_name}");
    if map["repository"].as_str() != Some(expected_identity.as_str()) {
        return Err("repository identity mismatch".into());
    }
    if map["role"].as_str() != Some("compiler") {
        return Err("unexpected integration role".into());
    }
    let actual_upstreams: Vec<&str> = map["upstreams"].as_array()
        .ok_or("upstreams must be an array")?
        .iter()
        .map(Value::as_str)
        .collect::<Option<Vec<_>>>()
        .ok_or("upstreams must contain only strings")?;
    if actual_upstreams.as_slice() != expected_upstreams {
        return Err("unexpected, reordered, or duplicated upstream dependencies".into());
    }
    if map["evidence"].as_str() != Some("not-attested") {
        return Err("unverified CI/runtime evidence promotion refused".into());
    }
    if map["note"].as_str() != Some(NOTE) {
        return Err("evidence disclaimer changed".into());
    }
    Ok(())
}

fn verify_bytes(bytes: &[u8], repository_name: &str) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_BYTES {
        return Err("manifest empty or exceeds 4 KiB".into());
    }
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        return Err("UTF-8 BOM forbidden".into());
    }
    std::str::from_utf8(bytes).map_err(|_| "invalid manifest UTF-8")?;
    let Strict(document): Strict = serde_json::from_slice(bytes)
        .map_err(|e| format!("JSON admission failed: {e}"))?;
    validate_value(&document, repository_name)
}

#[cfg(target_os="linux")]
fn read_manifest(path: &Path) -> Result<Vec<u8>, String> {
    // Linux O_NOFOLLOW | O_NONBLOCK: refuse final symlinks and avoid FIFO hangs.
    let mut file = fs::OpenOptions::new().read(true)
        .custom_flags(0o400000 | 0o4000)
        .open(path).map_err(|e| format!("cannot open integration manifest: {e}"))?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err("manifest must be a bounded regular file".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("manifest exceeds 4 KiB".into());
    }
    Ok(bytes)
}

#[cfg(not(target_os="linux"))]
fn read_manifest(_path: &Path) -> Result<Vec<u8>, String> {
    Err("safe no-follow filesystem admission requires Linux".into())
}

fn verify_root(root: &Path) -> Result<String, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err("repository root must be a directory".into());
    }
    let name = root.file_name().and_then(|n| n.to_str())
        .ok_or("repository root is not a valid target")?;
    let path = root.join(".oreslang/integration.json");
    verify_bytes(&read_manifest(&path)?, name)?;
    Ok(name.to_owned())
}

fn main() {
    let mut args = env::args_os().skip(1);
    let root = match args.next() {
        None => PathBuf::from("."),
        Some(flag) if flag == "--repository-root" => match args.next() {
            Some(dir) if args.next().is_none() => PathBuf::from(dir),
            _ => { eprintln!("usage: rust-integration-manifest [--repository-root PATH]"); std::process::exit(2); }
        },
        _ => { eprintln!("usage: rust-integration-manifest [--repository-root PATH]"); std::process::exit(2); }
    };
    match verify_root(&root) {
        Ok(name) => println!("integration declaration verified: {name}; evidence remains not-attested"),
        Err(error) => { eprintln!("integration manifest DENIED: {error}"); std::process::exit(1); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(repository_name: &str) -> Value {
        json!({
            "schemaVersion": 1,
            "protocol": PROTOCOL,
            "repository": format!("ores-truffle-oreslang/{repository_name}"),
            "role": "compiler",
            "upstreams": upstreams(repository_name).unwrap(),
            "evidence": "not-attested",
            "note": NOTE
        })
    }

    #[test]
    fn all_seven_compiler_manifests_have_distinct_exact_contracts() {
        for repo in [
            "oreslang-source.java", "oreslang-source.llvm", "oreslang-source.wasm",
            "oreslang-source.js", "oreslang-source.hdl", "oreslang-source.forge",
            "oreslang-source.net",
        ] {
            assert!(verify_bytes(&serde_json::to_vec(&fixture(repo)).unwrap(), repo).is_ok(), "{repo}");
        }
    }

    #[test]
    fn rejects_unknown_source_and_cross_backend_identity_spoof() {
        let bytes = serde_json::to_vec(&fixture("oreslang-source.java")).unwrap();
        assert!(verify_bytes(&bytes, "oreslang-source.unknown").is_err());
        assert!(verify_bytes(&bytes, "oreslang-source.net").is_err());
    }

    #[test]
    fn rejects_duplicate_normalized_keys_and_falsified_attestations() {
        let value = serde_json::to_string(&fixture("oreslang-source.java")).unwrap();
        let dup = format!("{},\"evidence\":\"not-attested\"}}", &value[..value.len() - 1]);
        assert!(verify_bytes(dup.as_bytes(), "oreslang-source.java").is_err());
        let normalized = value.replacen("\"role\":", "\"r\\u006fle\":", 1);
        let duplicated = format!("{},\"role\":\"compiler\"}}", &normalized[..normalized.len() - 1]);
        assert!(verify_bytes(duplicated.as_bytes(), "oreslang-source.java").is_err());
        let mut doc = fixture("oreslang-source.java");
        doc["evidence"] = json!("verified");
        assert!(validate_value(&doc, "oreslang-source.java").is_err());
    }

    #[test]
    fn rejects_upstream_reorder_bool_schema_and_missing_disclaimer() {
        let mut doc = fixture("oreslang-source.wasm");
        doc["upstreams"] = json!(["oreslang-wasm", "oreslang-target-profiles", "oreslang-source.llvm"]);
        assert!(validate_value(&doc, "oreslang-source.wasm").is_err());
        let mut doc = fixture("oreslang-source.java");
        doc["schemaVersion"] = json!(true);
        assert!(validate_value(&doc, "oreslang-source.java").is_err());
        doc = fixture("oreslang-source.java");
        doc.as_object_mut().unwrap().remove("note");
        assert!(validate_value(&doc, "oreslang-source.java").is_err());
    }

    #[test]
    fn rejects_bom_bad_utf8_non_json_literals_and_excess_bytes() {
        let base = serde_json::to_vec(&fixture("oreslang-source.java")).unwrap();
        let mut bom = vec![0xef, 0xbb, 0xbf]; bom.extend(&base);
        assert!(verify_bytes(&bom, "oreslang-source.java").is_err());
        assert!(verify_bytes(&[0xff], "oreslang-source.java").is_err());
        assert!(verify_bytes(b"{\"schemaVersion\":NaN}", "oreslang-source.java").is_err());
        assert!(verify_bytes(&vec![b' '; (MAX_BYTES + 1) as usize], "oreslang-source.java").is_err());
    }

    #[cfg(target_os="linux")]
    #[test]
    fn rejects_symlinked_final_component_and_directories() {
        use std::os::unix::fs::symlink;
        use std::time::{SystemTime, UNIX_EPOCH};
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let tmp = env::temp_dir().join(format!("oreslang-manifest-{}-{nonce}", std::process::id()));
        let root = tmp.join("oreslang-source.java");
        let dir = root.join(".oreslang");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("integration.json");
        fs::write(&file, serde_json::to_vec(&fixture("oreslang-source.java")).unwrap()).unwrap();
        assert!(verify_root(&root).is_ok());
        let alias = tmp.join("external.json");
        fs::rename(&file, &alias).unwrap();
        symlink(&alias, &file).unwrap();
        assert!(verify_root(&root).is_err());
        assert!(read_manifest(&dir).is_err());
        fs::remove_dir_all(&tmp).unwrap();
    }
}
