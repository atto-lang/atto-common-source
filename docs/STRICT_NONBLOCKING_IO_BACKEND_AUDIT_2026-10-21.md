# Strict nonblocking stdlib I/O backend audit — 2026-10-21

This is an implementation-status snapshot under the normative rules in
`NATIVE_IO_NAMING.md`. It is not permission to weaken those rules.

| Backend | Guest stdlib I/O state | Strict status |
| --- | --- | --- |
| Java/Graal | Strict branch exposes async signatures only; bare sync names are type errors; admitted I/O fails closed until real providers land. Legacy `NativeIo`, `AsyncNativeIo`, and JDK `NativeHttp` remain quarantined and unreachable from strict guest dispatch. | **Fail closed / compliant boundary; functionality pending** |
| LLVM/native | Source-level stdlib I/O is not admitted yet. Linux TCP substrate uses nonblocking descriptors, `MSG_DONTWAIT`, nonblocking `accept4`, eventfd, and epoll readiness. | **Fail closed at source; nonblocking substrate present** |
| WASM | Guest module admission rejects host imports entirely. The AOT host's bounded artifact-file reader is build/host tooling, not a guest stdlib I/O backend. | **No guest I/O surface** |
| JavaScript | Current backend has no guest stdlib I/O transport implementation. | **No guest I/O surface** |
| Rust | Current backend has no guest stdlib I/O transport implementation. | **No guest I/O surface** |
| .NET | Current guest/runtime surface has no stdlib I/O transport. `RuntimeHost` console diagnostics are launcher/host behavior, not a guest stdlib API. | **No guest I/O surface** |
| Forge | Current backend has no guest stdlib I/O transport implementation. | **No guest I/O surface** |
| HDL | No guest stdlib I/O surface. | **No guest I/O surface** |

## Non-negotiable rules

1. No backend may add a blocking syscall and call it nonblocking merely because
   it runs on a platform worker, pool, or virtual thread.
2. One multiplexing reactor may wait in epoll/kqueue/IOCP-style readiness or
   completion; a thread may not be parked per guest operation.
3. Bare synchronous I/O names are not compatibility aliases.
4. `*_blocking` may be implemented only as implicit continuation suspension
   over the exact same nonblocking provider used by the asynchronous operation.
5. If a target has no compliant provider, the operation remains unsupported.
6. Host build, compiler, launcher, or diagnostic I/O must not be reused as a
   guest stdlib implementation without passing the full strict contract.

## Release evidence

A backend becomes functionally complete only after both static and executable
evidence exists:

- no stdlib-reachable blocking adapter or host API;
- compiler/binding rejection of forbidden sync aliases;
- exact Future/await or implicit-suspension typing;
- progress with a single actor/root carrier;
- cancellation, timeout, close, EOF, backpressure, and stale-completion races;
- target-specific proof that unsupported platforms fail closed.

Static source inspection or a source-free synthetic audit is useful hardening
evidence but is not a substitute for exact-head executable backend CI.
