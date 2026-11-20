# Shared HTTP guest fixture identity gate

This standalone Rust CLI replaces `scripts/verify_http_fixture.py`.

```sh
cargo test --manifest-path tools/http-fixture-identity/Cargo.toml
cargo run --manifest-path tools/http-fixture-identity/Cargo.toml -- --root .
```

It checks the source file's exact Git SHA-1 **blob** (including the
`blob <length>\0` prefix), not just the SHA-1 of the raw bytes. It rejects
symlinked/nonregular fixtures and edits to the canonical guest fixture.
The expected blob SHA is pinned deliberately, and a changed fixture needs an
explicitly reviewed update.

**Passing this gate does not establish GraalVM/LLVM execution, parity, or
provenance**. Those require independently pinned compiler/runtime executions.
