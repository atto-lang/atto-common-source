# Native Oreslang I/O naming and execution contract

**Status:** normative language/API, scheduler, and backend conformance rule.

This contract applies to every Oreslang standard-library I/O operation and to
every runtime adapter reachable from that stdlib surface. A backend may expose
less functionality by failing closed; it may not satisfy missing functionality
with blocking host I/O.

## Strict nonblocking host-I/O invariant

A strict profile must enforce both execution and naming boundaries:

- Bare synchronous I/O spellings are not compatibility aliases; they are compile-time/binding errors.
- A backend may reject a canonical `*_blocking` operation entirely until it has verified implicit continuation-suspension lowering over the same nonblocking provider used by its async form.
- Shipping `*_blocking` early by calling a blocking host API, or by offloading that call to a worker, is forbidden.
- Async operations may use `*_async` or another explicitly Future/awaitable API shape, but they must never expose a synchronous host operation behind an async-looking name.
- No stdlib operation may call a known blocking filesystem, socket, DNS, HTTP,
  terminal, pipe, or process-I/O data-plane API.
- Moving a blocking call onto a platform thread, virtual thread, bounded pool,
  or dedicated worker does **not** make it compliant.
- Blocking data-plane syscalls are forbidden on actor/root carriers and on every
  per-operation I/O worker.
- A single multiplexing reactor may sleep in a readiness/completion wait such
  as `epoll_wait`, `kevent`, or an IOCP wait. The reactor wait multiplexes
  operations; it is not a blocking implementation of an individual operation.
- Worker offload is not a compliant portability fallback.
- If a target lacks a compliant provider, the operation must fail closed as unsupported.

## Source naming rule

Every source-visible, logically synchronous I/O operation must end in
`_blocking`.

The suffix means that the **source continuation waits for the result**. It never
means that an OS thread may block. A valid `*_blocking` call is compiler/runtime
sugar for:

1. submit the operation to the same nonblocking readiness/completion provider
   used by the async form;
2. suspend the current Oreslang continuation;
3. release its actor/root carrier;
4. resume through the owning scheduler when completion arrives.

Async I/O may end in `_async`; the suffix is optional only when the
Future/awaitable contract is otherwise explicit and unambiguous.

Examples of target API shapes:

```ores
val Future<String> pending = fs.read_text_async(path);
val String first = await pending;

// Only on a backend that implements verified implicit suspension:
val String second = fs.read_text_blocking(path);
```

A backend that has async support but lacks implicit-suspension lowering must
admit the async form and reject the `*_blocking` form. It must not implement
`*_blocking` with `Future.get`, `join`, a spin loop, or a worker-blocking
shim.

## Provider requirements

### Filesystem

Regular-file and metadata I/O requires a target-specific asynchronous
completion provider. Ordinary blocking file operations on a worker are not a
fallback. A platform without a compliant provider reports the capability as
unsupported.

### TCP, UDP, sockets, and pipes

Descriptors must be nonblocking and integrated with readiness/completion.
Connect, accept, read, write, close/drain, and backpressure may not park one
thread per guest operation.

### DNS

Name resolution must use an asynchronous resolver integration. Blocking
`getaddrinfo` or equivalent worker offload is noncompliant.

### HTTP and TLS

HTTP/TLS must be built on compliant nonblocking network primitives and
state machines. A synchronous HTTP client/server moved to virtual threads or a
pool is not a stdlib backend.

### stdin, stdout, stderr, terminals

Terminal and pipe operations require nonblocking descriptor/reactor integration
or an explicitly nonblocking host sink. Targets that cannot prove this remain
unsupported.

## Compiler and binding requirements

The native builtin/FFI registry must record semantic effect and execution shape;
name-only inference is insufficient.

The compiler/binder must:

1. reject registered synchronous-looking I/O without `_blocking`;
2. reject aliases or methods that hide such an entry;
3. reject bare legacy compatibility names in strict stdlib;
4. type async entries as Future/awaitable operations;
5. treat implemented `*_blocking` entries as suspension points, including
   inside otherwise ordinary source routines;
6. reject `*_blocking` entirely when that lowering/provider is absent;
7. preserve the same capability/permission checks for both API shapes.

No released strict stdlib compatibility mode may silently or explicitly
re-enable blocking host I/O. If old blocking adapters are retained for migration
or reference tests, they must live outside the strict stdlib reachability graph.

## Runtime and scheduler requirements

- Guest callbacks never execute on the I/O reactor.
- No per-operation thread is held waiting for I/O completion.
- Admissions and buffers are bounded.
- Cancellation, timeout, shutdown, EOF, backpressure, and stale completion are
  explicit state-machine transitions.
- Completion resumes the owning Oreslang continuation through the scheduler.
- Actor cancellation or teardown cannot turn a pending I/O operation into an
  unbounded host wait.
- A reactor may block only in its multiplexed readiness/completion wait.

## Unsupported capabilities

Unsupported I/O must be deterministic and fail closed before host I/O occurs.
An async form returns/settles a failed Future as appropriate to the backend
contract. A synchronous-looking form is rejected unless proper
continuation-suspension lowering exists.

“Not implemented” is safer and more conformant than a hidden blocking fallback.

## Host tooling boundary

Compiler input reads, build artifact publication, launcher diagnostics, and
other host tooling are not guest stdlib APIs. They may have separate execution
contracts, but they must never be reused as a guest stdlib provider without
satisfying this document.

## Acceptance and release gates

A backend that claims functional strict I/O support must provide executable
evidence for all applicable cases:

| Scenario | Required result |
| --- | --- |
| Bare synchronous I/O name | Compiler/binding rejection |
| Async I/O name/signature | Future/awaitable type and completion-driven implementation |
| `*_blocking` | Admitted only with verified implicit continuation suspension over same provider |
| Unsupported target/provider | Fail closed before host I/O |
| Blocking worker fallback | Rejected |
| Single actor/root carrier with slow I/O | Another runnable continuation makes progress before I/O completes |
| Backpressure | Bounded admission; no unbounded queue/thread creation |
| Cancellation/timeout | No parked per-operation thread and no stale completion corruption |
| EOF/close/shutdown | Exactly-once terminal completion semantics |
| Capability denial | Fails before host I/O and without authority laundering |

Static source scans are required but are not sufficient. Exact-head executable
tests must prove progress and lifecycle behavior. A workflow that fails before
executing job steps is `NOT_EXECUTED`, not evidence for or against the code.

## Cross-backend responsibility

The common-source repository owns this semantic contract. Each backend owns its
provider implementation and executable conformance tests. A backend with no
guest stdlib I/O surface remains conformant by rejecting I/O rather than
introducing a blocking fallback.

Current implementation status is tracked separately in
`STRICT_NONBLOCKING_IO_BACKEND_AUDIT_2026-10-21.md`.
