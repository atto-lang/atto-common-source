//! Verify the exact SHA-1 Git blob identity of the shared HTTP guest fixture.
//! Identity is only an admission guard. It proves neither compiler nor runtime parity.
use sha1::{Digest, Sha1};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const EXPECTED_BLOB: &str = "a0b3fc658d1460eab62c85b3cc897143ea77a7ff";
const FIXTURE: &str = "fixtures/http-guest-counter-handler.ores";

fn git_blob(source: &[u8]) -> String {
    let mut hash = Sha1::new();
    hash.update(format!("blob {}\0", source.len()).as_bytes());
    hash.update(source);
    format!("{:x}", hash.finalize())
}

fn verify_bytes(source: &[u8]) -> Result<String, String> {
    let actual = git_blob(source);
    if actual != EXPECTED_BLOB {
        return Err(format!(
            "PARITY_FIXTURE_MISMATCH expected={EXPECTED_BLOB} actual={actual}"
        ));
    }
    Ok(actual)
}

fn verify(root: &Path) -> Result<String, String> {
    let fixture = root.join(FIXTURE);
    let file_type = fs::symlink_metadata(&fixture)
        .map_err(|e| format!("{}: {e}", fixture.display()))?
        .file_type();
    if file_type.is_symlink() || !file_type.is_file() {
        return Err(format!("fixture must be a regular file: {}", fixture.display()));
    }
    let source = fs::read(&fixture).map_err(|e| format!("{}: {e}", fixture.display()))?;
    verify_bytes(&source)
}

fn main() {
    let mut args = env::args_os().skip(1);
    let root = match args.next() {
        None => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."),
        Some(flag) if flag == "--root" => match args.next() {
            Some(root) if args.next().is_none() => PathBuf::from(root),
            _ => {
                eprintln!("usage: http-fixture-identity [--root PATH]");
                std::process::exit(2)
            }
        },
        _ => {
            eprintln!("usage: http-fixture-identity [--root PATH]");
            std::process::exit(2)
        }
    };
    match verify(&root) {
        Ok(actual) => {
            println!("PARITY_FIXTURE_IDENTICAL sha={actual} expected_llvm_and_graal=true");
            println!("NOTE: identity alone does not certify source compilation or runtime behavior");
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const CANONICAL: &[u8] =
        include_bytes!("../../../fixtures/http-guest-counter-handler.ores");

    #[test]
    fn canonical_fixture_matches_pinned_git_blob() {
        assert_eq!(verify_bytes(CANONICAL), Ok(EXPECTED_BLOB.to_owned()));
    }

    #[test]
    fn mutation_rejects_even_if_source_remains_well_formed() {
        let mut modified = CANONICAL.to_vec();
        modified.push(b'\n');
        assert!(verify_bytes(&modified).unwrap_err().contains("PARITY_FIXTURE_MISMATCH"));
    }

    #[test]
    fn uses_git_blob_framing_not_bare_file_sha1() {
        let bare = Sha1::digest(b"hello");
        assert_ne!(git_blob(b"hello"), format!("{bare:x}"));
    }
}
