use oreslang_memory_evidence::{default_manifest_path, run};
use std::{env, path::PathBuf};

fn usage() -> ! {
    eprintln!("usage: oreslang-memory-evidence [--manifest PATH] --evidence PATH");
    std::process::exit(2)
}
fn main() {
    let mut args=env::args_os().skip(1);
    let mut manifest: Option<PathBuf>=None;
    let mut evidence: Option<PathBuf>=None;
    while let Some(arg)=args.next() {
        match arg.to_str() {
            Some("--manifest") => manifest=Some(args.next().map(PathBuf::from).unwrap_or_else(|| usage())),
            Some("--evidence") => evidence=Some(args.next().map(PathBuf::from).unwrap_or_else(|| usage())),
            _ => usage(),
        }
    }
    let manifest=manifest.unwrap_or_else(default_manifest_path);
    let evidence=evidence.unwrap_or_else(|| usage());
    match run(&manifest,&evidence) {
        Ok(profile) => {
            println!("MEMORY_EVIDENCE_STRUCTURALLY_VALID_ONLY profile={profile}");
            println!("NOT CERTIFIED: independently verify pinned code, binary, steps and observed measurements");
        }
        Err(e) => {
            eprintln!("MEMORY_EVIDENCE_REJECTED: {e}");
            std::process::exit(1);
        }
    }
}
