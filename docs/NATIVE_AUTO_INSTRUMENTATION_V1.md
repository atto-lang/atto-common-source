# AttoLang native automatic instrumentation v1 (proposal)

**Status: DESIGN/CONFORMANCE TARGET ONLY — no backend parity or working automatic instrumentation is claimed.**
Date: 2026-11-12. Target: Java/GraalVM, LLVM, Wasm, Forge and .NET Native AOT.

## Decision

Provide **zero-application-code tracing** for supported Atto-owned HTTP, network/I/O,
actor, scheduler, database and messaging libraries. No monkey patching, reflective
agents, bytecode rewriting, source-level wrappers, dynamic method replacement,
runtime generated code, or user-installed decorators. Instrumentation is an
independently switchable compiler/runtime capability, **disabled at runtime by
default**. The public implementation, formatting and exporter composition should
live in native `.atto` whenever the language can safely express it.

This is a **new application-instrumentation plane**. It does not change the
independent host-owned `CorePerf`, `CoreDebug`, `CoreLog` or `ores-core-log.v1`
diagnostic semantics in [CORE_LOGGING_AND_OTEL.md](CORE_LOGGING_AND_OTEL.md).
Core diagnostic recorders do not start spans, import `oreslang-otel`, read guest
objects, or export OTLP. `oreslang-otel` remains an explicit legacy/userland
library and is *not* silently initialized. Exporting auto spans requires an
explicit host-controlled tracing/export policy, not merely core diagnostic flags.

## Architecture and placement

1. **Semantic compiler pass**: register immutable, build-time descriptors for
   typed callable entry/exit, async suspend/resume and selected boundaries.
   The pass inserts probe calls before backend lowering or in equivalent verified
   typed IR. Static IDs map to symbol/source location/operation descriptions in
   cold-path metadata. AOT sees all probes, metadata and context slots in advance.
2. **Trusted runtime boundary probes**: actor spawn/admit/dequeue/dispatch/end,
   supervisor CONTROL, Future/continuation transitions, HTTP route handler,
   HTTP outbound attempt, TCP connect, nonblocking read/write completion,
   datastore driver command, and std messaging send/receive. Emit semantic
   spans for logical operations, **not a new span per socket byte/readiness event**.
   Low-level socket/readiness counters belong primarily to metrics/diagnostics.
3. **Context carrier**: immutable TraceContext travels with an actor/message
   envelope and continuation frame, not guest payload, mutable globals or a
   carrier-thread local. On cross-domain transport, explicitly validate
   propagation authority; attach no capabilities, pointers or private state.
4. **Native collection**: bounded per-actor/per-worker shards with a nonblocking
   offer, monotonic timing, drop accounting, capped attributes and memory,
   no synchronous exporter and no guest callbacks from probes. A separate
   stdlib collector/exporter drains asynchronously; never while holding an actor
   critical loan, mailbox lock, I/O reactor, or supervisor priority path.
5. **Interoperability**: W3C Trace Context `traceparent` / `tracestate` for
   trusted HTTP/network boundaries; OpenTelemetry-compatible spans/attributes
   and OTLP export via a hosted `ores.std.telemetry` adapter. OTLP is opt-in
   and independent of vendor-specific SDKs and the existing local JSONL format.

## Build and runtime policy (target CLI surface, NOT implemented)

| Policy | Default | Semantics |
| --- | --- | --- |
| Build `--instrument=none\|boundaries\|functions` | `boundaries` | `none` emits no probes; `boundaries` emits known std/runtime probes; `functions` also emits callable/continuation probes |
| Runtime `--trace=off\|on` | `off` | Off never records, reads a clock or exports; on enables sampling and collection only for probes compiled into this artifact |
| `--trace-sample-rate` | policy-set (e.g. 1%) | Bounded root sampling; honor remote sampling policy through an explicit trust decision |
| `--trace-exporter=none\|otlp\|file` | `none` | No network or file egress without distinct host permission |
| `--trace-max-buffer-events` | bounded (e.g. 8192) | Preallocated capacity; overflow increments drop metric, never stalls guest execution |

A **runtime-off capable** build still pays a predictable branch/probe-site code
size cost. It cannot truthfully claim *zero CPU instruction overhead*. A build
with `--instrument=none` removes instrumentation entirely but **cannot turn
tracing on without recompilation**. Strict hard-real-time profiles should use
`none` or separately certify bounded probes and export isolation. Configuration
is parsed once using the project's approved CLI policy, not at every hook.

## Public API target (illustrative; not compiled)

- `ores.core.trace`: `TraceId` (128-bit), `SpanId` (64-bit),
  immutable `TraceContext`, `SpanKind`, `SpanStatus`, and no-op span interface.
  Freestanding: does not import `ores.std`, transport, clocks or exporters.
- `ores.core.instrumentation`: compiler/runtime-only fixed hook IDs,
  typed context handoff and a bounded, capability-controlled recording ABI.
  It is **not** a guest escape hatch for core diagnostics.
- `ores.std.telemetry`: `start_span`, `with_span`, `current_context`,
  `is_recording`, `add_event`, `set_attribute`, `record_error` and an
  idempotent, scope-bound `finish`, implemented in .atto where possible.
- `ores.std.telemetry.propagation`: validated `inject`/`extract`,
  header-byte/count caps and W3C IDs; no arbitrary header, cookie or baggage
  capture. Cross-service policy must distinguish incoming untrusted contexts
  from local application authority.
- `ores.std.telemetry.otlp`, `ores.std.metrics`, `ores.std.logging`:
  opt-in exporter, metrics and trace-correlated logs respectively. Exporters
  are never part of `ores.core` and require egress capabilities.

Function and method names are snake_case. No new language keyword is required.
Manual spans add **semantic business events**; automatic stdlib spans never
require manual API calls or attributes in userland.

## Span semantics

- HTTP inbound: a `SERVER` span at request admission, ending at defined
  response-completion/error boundary. Route template and method are low-
  cardinality names; do not use raw URLs, query strings or body content.
- HTTP outbound: a `CLIENT` span per actual send attempt and its failure/status;
  explicit retries and redirect attempts follow current OTel HTTP conventions.
- Database: a `CLIENT` span at a known std driver execute/transaction boundary.
  Vendor SQL parsers or arbitrary FFI calls are **not** magically instrumented.
  Do not capture query text, bind values or credentials by default.
- Actors: admission/enqueue/dequeue and handler execution correlate to the
  currently active context; immutable message metadata preserves causality
  through move/borrow-checked transports without serializing capabilities.
  For fan-out/batching/multi-parent messages, emit `SpanLink` relationships
  according to applicable OTel messaging conventions rather than inventing
  a single parent. Never block a supervisor CONTROL path.
- Futures/async: a continuation resumes with its captured trace context even
  on a different OS carrier; cancellation, `throw`, `raise`, `panic`, timeout,
  and restart/generation fencing conclude affected spans **exactly once** and
  cannot change failure propagation. Queue wait, execution and I/O time should
  be distinguishable.
- Functions: optional compiler-selected entry/exit spans using stable logical
  callable IDs (including error/defer paths). Inlining and tail calls may retain
  a logical probe only when stated by the profile; no exhaustive stack tracing
  in the default `boundaries` profile. Exclusion lists prevent recursion into
  collector, allocator, clock, sanitizer, scheduler and exporter internals.

## Safety and privacy

- Do not record raw HTTP bodies, cookies, tokens, Authorization, SQL bind data,
  guest objects, payload bytes, addresses/paths or arbitrary stack/local values
  by default. Use vetted low-cardinality attributes with length and count caps.
- Remote trace headers are untrusted identifiers, never security capabilities.
  Validate exact size/format, reject all-zero IDs, bound `tracestate`, and never
  let a remote sampling hint bypass local budgets or export permissions.
- Per-domain telemetry authority must forbid cross-tenant leaks. Hot reload,
  actor restarts and retired actor generations cannot publish stale contexts.
- Monotonic time for intervals; timestamp correlation uses a separately
  calibrated wall-clock origin. No elapsed-time arithmetic on wall-clock time.
- Off means no event allocation, formatting, timestamp reads, locks, I/O,
  guest callbacks or changes to observable results. A saturated collector must
  drop records, never wait.
- In native AOT/Wasm no dynamic code generation, reflection search, JS patching,
  host agent or unapproved import is allowed. A no-import Wasm profile must fail
  closed rather than gain network/clock imports from tracing configuration.

## Coverage limits

Automatic visibility is guaranteed only at **compiler-instrumented functions and
Atto-owned/registered runtime or stdlib boundaries**. Arbitrary third-party
native libraries, embedded DB engines, syscalls bypassing the trusted provider,
and external services cannot be traced without a verified adapter. Those gaps
must appear explicitly in capability reports; do not claim 'all calls' coverage.

## Conformance gates

The machine-readable companion is
[`contracts/v1/native-auto-instrumentation-v1.json`](../contracts/v1/native-auto-instrumentation-v1.json).
Required backend evidence includes:

1. Source-only contract validation **separately** from actual .atto compilation,
   function lowering, generated artifact inspection and guest execution.
2. Off/none/capable/on matrix: off has no events, no timing or per-event
   allocation; none has no inserted probes; on generates correctly nested spans.
3. HTTP server/client and actor/Future parent/links across suspend/resume,
   cancellation, panic, restart, retries and multiple concurrent workers.
4. Strict W3C IDs, header limits, untrusted provenance, HTTP route-cardinality
   limits, redaction and permission denial without behavior changes.
5. Backpressure: bounded memory, nonblocking hot path, counted drops and
   exactly-once teardown; exporter failure cannot affect guest outcomes.
6. Target-specific real guest execution: GraalVM JIT and native image, LLVM O0/O2
   plus sanitizers, actual Wasm worker, Forge, and .NET Native AOT. Include
   compiler/source SHAs, artifact digest, exact commands and stepful test logs.
   Host-only tests and synthetic traces are NOT EXECUTED backend evidence.

## Upstream references

- [OTel tracing API](https://opentelemetry.io/docs/specs/otel/trace/api/)
- [OTel tracing SDK and sampling](https://opentelemetry.io/docs/specs/otel/trace/sdk/)
- [OTel HTTP semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/http-spans/)
- [OTel messaging spans](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/)

## v1 reconciliation: three native producers, one trace plane

This section refines the initial proposal with the 2026-11-12 automatic-
instrumentation design. Its detailed requirements take priority over vague
examples above; it does **not** certify implementation. In particular
`using telemetry.span(...) as span { ... }` is a **normative proposed
scoped-resource construct**, reusing AttoLang's existing `using` keyword;
it MUST NOT be deferred as optional pseudo-syntax. The compiler and language
spec must specify this spelling and its cleanup, ownership, suspension and
failure behavior before executable support is claimed.

**Three independent producers share one versioned span/event ABI:**

| Producer | Source of semantic identity | Emissions |
| --- | --- | --- |
| Compiler | verified, typed callable/async MIR and static source descriptor | selected function entry/exit, suspend/resume, guaranteed terminal cleanup |
| Runtime | actor, task, mailbox, supervisor, continuation, channel and critical-state transition | context handoff, processing spans, bounded scheduling/wait/lock metrics |
| Atto stdlib | `ores.std.http`, `ores.std.net`, `ores.std.fs`, registered database and messaging drivers | server/client span, I/O outcome, producer/consumer process spans |

The compiler and runtime MUST **deduplicate** overlapping semantic boundaries:
a compiler probe around a built-in HTTP handler does not produce a second
HTTP server span. Function-level child spans are optionally independent but
must be distinguishable from semantic boundary spans. No dynamic hooks,
monkey patching, method wrappers, Java agents, reflection or JIT-only paths.

### Instrumentation lowering and effect safety

Conceptual typed-MIR operation:
`probe_enter(descriptor_id, context_slot) -> scope_token`;
`probe_leave(scope_token, outcome)`. An `invalid` token means no recording.
The compiler inserts terminal cleanup on **all paths**: normal return,
`?` early return, `trap`, `throw`, `raise`, `panic`, cancellation,
cooperative preemption, and exceptional unwinding. The scope token is opaque,
owned by one logical execution, and generation-fenced on actor restart or
hot reload. An aborted or duplicated terminal path cannot publish twice.

The probe ABI is a privileged, non-throwing, non-allocating-if-disabled,
non-suspending side-channel. It MUST NOT evaluate lazy user expressions,
change borrowed data, invoke guest callbacks, introduce an observable
`throws`/`raises`/`panics` effect or cause an actor carrier to park.
Clock reads and numeric buffering occur only after enabled/sampled checks.
The emitted code can retain a cheap branch when disabled. Only
`--instrument=none` removes all probe sites and their instruction cost.

**Descriptor identity:** stable within a compiled artifact by canonical
module, qualified callable, semantic signature, compiler source position and
manifest version; deterministic across identical inputs. Static descriptors
are cold-path data, not formatted on the hot path. Instrumented inlined
functions need an explicit profile policy for logical spans; never silently
advertise complete call coverage.

### Logical context, not carrier thread state

Each active continuation/task stores immutable trace context and an owned
span-scope token. The actor-message **envelope** carries immutable correlation
metadata; neither actor-private memory nor raw pointers are transferred.
Capture/restore occurs at `await`, task spawn, select, actor enqueue/receive,
cross-carrier migration, supervision and restart. On batch/fan-in, create
OTel **links** when there are multiple causal inputs; do not fabricate one
parent. For messaging operations, choose OTel `PRODUCER`, `CLIENT` and
`CONSUMER` kinds by operation type (`create`, `send`, `receive`,
`process`, `settle`), not by whether the code uses an actor.

Recording and propagation are independent state:
a non-recording span can keep a valid trace/span ID, flags and tracestate.
`is_recording` suppresses expensive attributes, but the sampling decision
belongs to a sampler, not to the instrumentation check alone. Root, local-
parent and remote-parent policies must be separately handled. A remote sampled
bit is **untrusted advice**, not permission to escape a local sample/memory/
egress budget. Use an OTel-compatible parent-based sampler, not an ad-hoc
per-span Bernoulli sampler that fragments whole traces.

### Runtime modes, configuration precedence and privacy

Separate **compile availability** (`none`, `boundaries`,
`functions`, optionally a future diagnostic profile) from runtime
**collection** (`off`/`on`) and **propagation** (`off`/`on`).
The Atto package config is a proposed non-normative TOML surface, not a
guaranteed parser. Default: runtime off, exporter none, no unexpected
outbound trace headers when tracing is off. Explicit propagation-only
operation MAY be enabled independently in a compatible build, but never
creates spans, touches a clock or exports data.

The canonical proposed package fields are `telemetry.enabled`,
`telemetry.instrumentation`, `telemetry.sampling_rate`,
`telemetry.auto.{functions,http,network,database,actors,tasks,channels,filesystem}`
and `telemetry.export.protocol`. Do not equate this package configuration
with a compiler feature already present.

Hosted SDK adapters SHOULD accept the standard OpenTelemetry environment
variables `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`,
`OTEL_SDK_DISABLED`, `OTEL_TRACES_SAMPLER`,
`OTEL_TRACES_SAMPLER_ARG`, `OTEL_PROPAGATORS`,
`OTEL_TRACES_EXPORTER`, `OTEL_EXPORTER_OTLP_ENDPOINT` and
`OTEL_EXPORTER_OTLP_PROTOCOL`. Parse once at startup and follow OpenTelemetry
value semantics. Proposed precedence:
(1) explicit capability/security denies always win, including egress deny;
(2) `OTEL_SDK_DISABLED=true` disables SDK recording/exports, **not**
independently enabled propagation (OTel requirement);
(3) explicit CLI instrumentation/runtime flags override Atto package defaults;
(4) explicit OTEL SDK settings configure the opted-in SDK, but an OTEL
endpoint by itself **does not turn Atto tracing on**.
Invalid conflicting policy must fail closed before application execution.

`--trace=off` means no automatic span collection/export. Unless
propagation was separately opted in, it also means no injected trace headers.
Enabled propagation mutates HTTP wire headers by design and therefore MUST
be distinguished from the "application results unchanged" tracing-disabled
test. Trace headers are permitted *only* on admitted network operations
using a trusted stdlib transport. Incoming trace identifiers do not confer
authority and can be dropped at untrusted boundaries.

Use W3C Trace Context IDs (128-bit trace and 64-bit span IDs, nonzero,
lowercase hex encoding), validate version and lengths, cap `tracestate`,
and never auto-capture baggage, secrets, arbitrary headers, query text,
bind parameters, request bodies, filenames or userland object graphs.
OTLP export requires a separately granted egress capability, endpoint
allowlist, timeout, byte budget and bounded retry policy. If permissions or
strict nonblocking transport support are unavailable, fail closed without
host-worker I/O fallback. Start with OTLP/HTTP protobuf; add gRPC only on
verified async transport implementations.

### Span duration and signal choices

- Server HTTP spans begin at request admission and end on response completion
  or terminal failure; record method, **route template**, status and bounded
  error type. Avoid per-request unique path/URL attributes.
- HTTP client spans cover individual attempted sends; correctly model
  redirects/retries and cancellation. No required user code.
- Database client spans begin at recognized driver operations and do not
  introspect arbitrary native FFI or serialize SQL bind values.
- Actor processing spans attach to the message's causal context. Mailbox
  queue latency, runnable delay, admission drops and CONTROL priority are
  primarily low-cardinality numeric metrics/events; do not emit a span for
  every scheduler tick or raw socket read.
- Filesystem operations may use a bounded I/O span where one logical call
  justifies it; network socket readiness is usually a metric/event.
- Critical-read/write contention and hold duration are bounded
  metrics/events. No trace recording may acquire the guarded state or await
  while a critical borrow is held.

Collect into preallocated per-worker/actor shards, hand off via
nonblocking `try_send` to a dedicated native Atto collector actor, and
export through an **independent** async exporter actor. Instrumentation
**must exclude the collector/exporter and their low-level transport**
to avoid infinite recursive spans. On pressure, drop and count; limits
cover span count, per-span attribute count/bytes, event count, sampler
CPU, queue bytes, export retries and collector shutdown work.
Crash delivery is best-effort, not guaranteed.

### Cross-backend admission priority

P0: lock immutable context/event ABI, source descriptor registry, typed
compiler probes, actor/continuation context and terminal exact-once
contracts for Java/Graal and LLVM.
P1: Atto-owned HTTP/network hooks, native bounded collector actor,
W3C context propagation, OTLP export and real end-to-end trace checks.
P2: independent `.net` Native AOT, Wasm workers, Forge and
JavaScript lowering; registered DB/messaging adapters; call filtering,
sampling performance and hot-reload generation fences.

Each backend must separately publish exact source/toolchain hashes,
real `.atto` compiler invocation, output artifact digest, positive and
negative guest execution, sanitizer/ownership cases where supported,
nonblocking and backpressure proof, and overhead measurements for
`none`, `off`, and `on`. Source-only schema or host-model tests are
not proof of executable instrumentation parity.

See also:
[OTel SDK tracing](https://opentelemetry.io/docs/specs/otel/trace/sdk/),
[OTel environment variables](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/),
[OTel messaging conventions](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/),
[OTLP exporter](https://opentelemetry.io/docs/specs/otel/protocol/exporter/)
and [W3C Trace Context](https://www.w3.org/TR/trace-context/).


## v1 amendment: first-class `using` scopes and live JIT instrumentation

**Decision (2026-11-12):** `using` is already an AttoLang keyword. Make the
scoped resource form **normative source grammar** rather than an illustrative
host-style pseudo-language. It is a general resource construct; instrumentation
uses it, but does not own the keyword. Canonical illustrative Atto:

```atto
use namespace ores.std.telemetry;

pub fnc checkout(Order order): Result<Receipt, Error> {
    using telemetry.span("checkout") as span {
        span.set_attribute("order.type", order.kind);
        return process_order(order)?;
    }
}
```

### Grammar and lifecycle

Target EBNF (subject to alignment with the existing `using` grammar):
`using_stmt := "using" expression "as" identifier block`.
`block` is the existing Atto brace-form lexical block. There is **no new
keyword**, decorator, macro, or implicit import. Evaluate the resource
expression exactly once, respecting ordinary typing/ownership/effects; bind
the resource to `span` only in the body. Acquiring an invalid or failing
resource obeys the ordinary expression's error semantics and does not run
the body or a cleanup for an unacquired resource.

`using` checks a nominal/trait-like **ScopedResource** protocol with
compiler-verifiable deterministic `close_scope` behavior. Exact trait syntax
and implementation naming are a language-spec gate; do not claim they are
accepted now. Its `close_scope` runs **exactly once on each acquired
resource** after the body's normal fallthrough, `return`, `?`, `trap`,
`throw`, `raise`, `panic`, cancellation, and task unwinding.
`using` is a cleanup barrier for tail calls. Lexical exit closes the span;
**suspension is not exit**. The scope token and parent trace context survive
`await`, `select`, continuation migration, and permitted async operations
without leaving a mutable cross-thread global. The binding cannot escape its
scope, be copied as an owner, or cross actor boundaries; a child may inherit
only permitted immutable trace context.

Unlike a general resource finalizer that may itself have specified fallible
effects, a telemetry `SpanScope.close_scope` is **non-throwing and
non-suspending**. Trace recording failures are swallowed and accounted by
bounded telemetry diagnostics. Cancellation and panic cleanup MUST NOT
intercept or convert the actor's CONTROL/panic notice or other guest errors.
If no recording is enabled, `telemetry.span` provides an allocation-free,
clock-free no-op scope. User expressions passed as arguments or attributes
still evaluate normally; the compiler cannot drop their side effects merely
because telemetry is off. Expensive dynamic attributes can be guarded with
`span.is_recording()`.

Manual `using` spans integrate with the same active context and native
collector as automatic probes; a manual span must not cause automatic
HTTP semantic spans to duplicate. A parent span should remain valid when
sampling yields non-recording context.

### Live instrumentation: distinguish **enable** from **add**

**Mode A — runtime enable of precompiled probe sites:** in
`--instrument=boundaries` or `functions` builds, enable the existing
fixed-ID probes from an authorized runtime control endpoint, without process
restart, new code or runtime executable-memory write. `none` has **no
precompiled optional probe sites**. Even with telemetry off, trace-capable
binaries carry small branch/metadata costs. Full AOT should prefer this path.

**Mode B — JIT/Truffle dynamic probe attachment:** if an Atto guest is running
under a truly JIT-capable Truffle language implementation, the Atto host can
use the native `Instrumenter` execution-event API or a dynamically
configurable Truffle Bytecode DSL instrumentation table. Enable tags and
per-call-site native instrumentation from an **authorized control-plane
operation**, deoptimize/invalidate affected optimized code safely, and
recompile/tier it with the new probes. This is language/runtime-managed
instrumentation, **not** Java agent attachment, monkey patching or
application object mutation. It requires retained instrumentable AST or
bytecode, stable source/tag mappings, and preinstalled trusted runtime
instrumentation support. JIT availability alone does not prove that Atto's
current compiler has the required tags and control plane.

**Mode C — dynamic hot-loading of a validated precompiled code generation:**
for governed module-hot-load profiles, a signed/preauthorized replacement
module may be compiled *outside* the process with probe sites and hot-loaded
using the existing generation-safe module switching model. This may avoid a
**process** restart but is a **code generation deployment**, not magically
injecting probes into previously stripped AOT functions. In-flight calls
complete on their original code generation unless an explicitly verified
safepoint migration is supported. Full, sealed, closed-world AOT must reject
arbitrary new guest JIT code and unauthorized runtime executable modification.

**Unsupported case:** a `--instrument=none` fully-AOT closed binary with
no instrumentation slots, no allowed dynamic-loader surface and no code
generation capability cannot start function tracing purely by flipping a
runtime flag. External eBPF/system profiling may reveal OS/network/system
behaviors but cannot guarantee Atto semantic function/actor spans, or replace
Atto's immutable continuation trace context.

### Backend capability targets (NOT IMPLEMENTED)

| Backend/profile | Runtime enable built-in probes | Late add **new** call probes | Constraint |
| --- | --- | --- | --- |
| Java/Graal Truffle JIT | Target yes | **Possible** via Truffle instrumentation/tagged nodes + invalidation/recompile | Must implement, register and verify Atto tags, deoptimization and control-plane authorization |
| Java/Graal full guest AOT | Target yes if compiled in | No arbitrary JIT | Use precompiled probes or separately governed signed hot-loading if allowed |
| LLVM native full AOT | Target yes if compiled in | No spontaneous new function probes | Precompiled sites / validated module replacement only; compiler needs explicit patch-point or indirection design |
| Forge JIT-capable profile | Target yes | Conditional on its implemented IR/tiering and retention | Separate engine proof; do not presume Java Truffle behavior |
| Forge sealed AOT | Target yes if compiled in | No arbitrary JIT | Same full-AOT rules as LLVM |
| .NET Native AOT | Target yes if compiled in | No arbitrary managed JIT | Must not rely on CLR runtime codegen/reflection |
| Wasm precompiled module | Target yes if built in | No generic arbitrary module mutation | New verified module instance/generation where host permits; no JS monkey patching |

**Control plane contract:** privileged `telemetry.enable`,
`telemetry.disable`, `telemetry.set_filter`, and
`telemetry.snapshot_status` operations are proposed, not presently
implemented Atto APIs. Reconfiguration MUST be authorized, budgeted,
audited, rate-limited, generation-fenced and coordinated at safe points.
It cannot widen the program's filesystem/network authorities, acquire actor
state, delay supervisor CONTROL, or induce unbounded JIT churn. A dynamic
activation reports whether it enabled existing probes, attached new JIT
probes, or required a new code generation. Avoid claiming coverage of
**already executed frames**: start spans on subsequent function entries;
never fabricate timestamps or replay operations. Handle in-flight spans
during disable/enable by retained generation tokens and idempotent cleanup;
an off transition stops new recording and may drain or discard outstanding
spans under explicit bounded policy.

### Test gates (source-only proposal)

- Parser/typechecker: valid existing `using` with `as` and braces, wrong
  resource type, malformed binder, duplicate/shadowed names, escaping scope
  token and illegal borrow/actor transfer.
- Runtime: exactly-once `close_scope` on fallthrough, early `?`, normal
  `return`, trap/throw/raise/panic/cancel, `await`/select and hot-reload
  actor generation transitions. Confirm only one cleanup on duplicate
  cancellation notifications; span collector failure changes no guest result.
- Truffle JIT: same artifact, tracing off => attach event filter while
  application runs => real function calls generate spans => detach =>
  subsequent calls stop; prove source tags/IDs and deopt/recompilation,
  logical parentage and overhead, and enforce backpressure with a small
  sample/filter budget. Must not be scored from an unexecuted host example.
- AOT: compile `none` and `boundaries`; enabling tracing on `none`
  must report `instrumentation_unavailable` (no fabricated spans);
  enabling probes on `boundaries` works without JIT. Signed hot-loaded
  module tests require explicit permission and generation fencing.
- Security: denial of control plane access, unsupported runtime type,
  invalid filter, nested telemetry recursion, exporter egress denial and
  remote untrusted traceparent cannot bypass budget/capability gates.

Implementation is independently gated per backend and compilation profile.
Java/Truffle's documented runtime instrumentation support demonstrates
feasibility, **not that AttoLang already exposes it**.

References:
[Truffle Instrumenter](https://www.graalvm.org/truffle/javadoc/com/oracle/truffle/api/instrumentation/Instrumenter.html),
[Truffle Bytecode DSL Instrumentation](https://www.graalvm.org/truffle/javadoc/com/oracle/truffle/api/bytecode/Instrumentation.html).
