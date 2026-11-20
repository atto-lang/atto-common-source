# Shared Rust Oreslang integration declaration gate

Run `cargo test --manifest-path tools/integration-manifest/Cargo.toml`.

A backend repository can run the same binary with:
`cargo run --manifest-path tools/integration-manifest/Cargo.toml -- --repository-root /path/to/oreslang-source.llvm`

This checks exactly seven declaration fields, all seven known compiler repository
identities, ordered upstream dependencies, the mandatory `not-attested` value,
the immutable no-parity disclaimer, strict JSON with duplicate-key rejection,
and Linux nofollow bounded manifest opens.

It is a **source-free structural validator**. These declarations do not
demonstrate implementation, compiler execution, transport behavior, CI success,
runtime performance, or backend parity. The five existing Python backend
gates remain authoritative until their migration is executed and reviewed.
