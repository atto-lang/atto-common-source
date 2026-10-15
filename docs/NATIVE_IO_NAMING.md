# Mandatory native asynchronous I/O contract

Status: normative for **all five backends**: Java/Graal, .NET, LLVM, Forge and
WASM, and every supporting library, launcher, target profile and adapter.
This supersedes the former opt-in naming/compatibility proposal. Implementation
support must be reported separately from this mandatory language invariant.

## Execution rule

All guest filesystem, HTTP, networking and stdio I/O must use genuine native
asynchronous/nonblocking submission and completion. There is no legacy,
blocking, off or compatibility policy, even for trusted code or explicit grants.
A compiler that cannot implement an operation rejects it before publishing an
artifact. A runtime without an implementation refuses dispatch. A Promise,
Future, Task or `_async` spelling around a blocking call or a worker-thread
fallback does not satisfy this contract. File APIs using host thread pools do
not become native asynchronous filesystem I/O merely by returning an awaitable.

Async submission cannot wait for readiness, completion, DNS, connection setup,
TLS, a worker queue slot or a lock held across I/O. Completion is delivered to
the owning actor through bounded, generation-checked messages/continuations.
Kernel event-loop readiness waiting is permitted on the dedicated poller;
it must not block an actor carrier or execute guest callbacks on the poller.

`_async` is optional naming, not evidence of an implementation. A source-level
`_blocking` spelling is admissible only if it describes actor suspension lowered
into exactly the same native asynchronous path; it must never block a carrier.
Until such continuation lowering exists the operation rejects. Bare legacy
aliases, method references, first-class aliases, unreachable statements,
interop and host/WASI imports cannot bypass admission. Names do not grant
filesystem/network authority or weaken ownership/cancellation constraints.

## Admission and runtime acceptance

The versioned corpus is `fixtures/mandatory-async-io.json`. It contains pure
positive programs and negative fs/HTTP/TCP/stdio operations, falsely async names,
aliases and dead-code cases. Narrow scalar backends reject unsupported syntax;
that proves denial for those cases, not complete effect checking or async I/O
implementation. Backend copies must retain identical bytes and SHA-256.

For each implemented async operation, execute real kernel I/O and verify:

- A stalled peer cannot prevent an independent actor on the same carrier from progressing.
- Submission, readiness and completion obey quotas and backpressure without waiting.
- Cancellation, timeout, teardown and late completion are exactly-once and generation checked.
- Resource/buffer ownership survives suspension without live conflicting loans.
- Partial reads/writes, errors, EOF and denied capabilities have explicit outcomes.
- No blocking compatibility flag, environment setting, binding override or worker fallback exists.

The current Graal hardening snapshot uses Java NIO for the kernel adapter and
Oreslang for HTTP/library policy. Async filesystem and stdio are unsupported.
LLVM, .NET and Forge currently reject general guest I/O. WASM's scalar profile
denies all host imports, including WASI; its workers isolate CPU execution and
must not be repurposed as blocking I/O workers. These are scope limits, not
claims that native asynchronous operations exist on every backend.

## Supporting tools and evidence

Compiler source/artifact loading and trusted command-line diagnostics are host
tooling, outside guest I/O. They must never be exposed as a guest fallback.
Returning a guest's scalar result is separate from a trusted CLI displaying it;
embedded runtime execution returns data without ambient console writes.

Profile metadata always declares `coreIoPolicy: native-async-only`. Capability
grants permit authority only; they cannot change scheduling or implement an
unsupported operation. Conformance must identify exact source/tree/binary
hashes, executed tests and unsupported surfaces. Missing tools, crashes,
timeouts and usage errors never count as successful I/O rejection. Focused
checks do not replace full suites, origin checks or production/AOT evidence.
