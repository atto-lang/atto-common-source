# Rust recovery-register integrity gate

Use `cargo test --offline --manifest-path tools/recovery-register/Cargo.toml`
and `cargo run --offline --manifest-path tools/recovery-register/Cargo.toml`
to validate the fifty-item local issue inventory. The Rust implementation
enforces the five expected ordered sections, ten unchecked rows per section,
exact issue URL syntax, unique case-insensitive repository/issue identities,
and nonempty next actions.

This is an **offline structure validator**. Issue URLs are not followed,
so a passing result must not be interpreted as evidence of currently open
issues, private-source export approvals, executable CI, or compiler parity.
