# Perf probes v1: backend-owned .atto libraries, AOT-first instrumentation

**Status:** Build-time contract and generator only. No compiler guest-execution or AOT/JIT parity credit.

The pure offline generator accepts an explicit, bounded registry and produces a stable
`PerfIds.atto` module plus a deterministic JSON probe plan:

```sh
node tools/generate-perf-probes.mjs contracts/perf-probes-aot-v1.json /tmp/PerfIds.atto /tmp/perf-plan.json
node --test tests/perf-probes-aot-v1.test.mjs
```

A probe ID is a compile-time integer, never derived from filenames, enumeration
position, addresses, process time, or a secret-bearing label. Changing names,
kinds, or sampling policy changes the plan digest; callers must reject a plan
mismatch with its recorded build artifact. The digest is *not* authentication.

In the frontend, select instrumentable typed function/actor/async boundaries
after effect and ownership checking; record exact statement/return/throw/cancel
exit edges. Generate a bounded plan and give it to all backend lowerers. Static
AOT lowering inserts guarded calls to the backend's own `.atto` Perf module.
JIT may inline/hoist or optimize **those same closed sites** only; it must not
synthesize new guest code, effects, permissions, or probe identities at runtime.

Required lowering semantics:

- `OFF` at compile time: omit calls, clock reads and buffers completely.
- Dynamic `enabled=false`: branch before the first clock read or allocation.
- `begin_ns` measures a *monotonic* clock; `duration_ns` clamps rollback.
- Carry actor/task context explicitly; no automatic reading of payloads,
  private state, actor identity, request headers, or tenant strings.
- Instrument all exits once, including exceptions, cancellation and async
  continuations, without turning suspension time into CPU execution time.
- No owner-shared mutable buffer; a trace buffer belongs to one actor/collector.
  Bounded drop-on-full; telemetry failures cannot change guest outcomes.
- Export only from a separate consumer phase, with explicit telemetry/I/O
  permission; no stdout, network or locks on the producer's hot path.
- Do not claim hard real-time bounded worst-case latency without measurement.
- When snapshots move across owners, use immutable values with checked
  transfer/lifetime rules; no borrowed mutable events across suspension.

Backend targets may implement distinct storage and clock adapters. Java's
existing `Trace`/`CorePerf` and `atto-otel` are not replaced by this initial
contract. LLVM may later reuse XRay-style precompiled instrumentation sites,
but no such native guest integration is claimed here.

**Evidence levels:** a generated source file or passing Node test is only
build-time validation. For `PASS` on a backend require current-head guest
compilation, normal return/throw/cancel guest execution, disabled-path behavior,
bounded overflow, fixed plan identity, JIT on/off differential when supported,
and a *program-specific* strict AOT executable or closed Wasm module. Zero-step
CI is `NOT_EXECUTED`, not a pass.


## Deterministic typed-site planning (additional stage)

The offline `tools/plan-perf-sites.mjs` validates concrete instrumentable
sites **after** the compiler has produced typed, effect/ownership-checked IR.
This utility never runs guest code and never claims the supplied IR SHA-256
has been authenticated. An external trusted compiler is still responsible for
passing the correct IR and lowering all declared edges.

```sh
node tools/plan-perf-sites.mjs \
  contracts/perf-sites-v1.example.json \
  contracts/perf-probes-aot-v1.json \
  /tmp/perf-sites-plan.json
node --test tests/perf-site-plan.test.mjs
```

Each site has an explicit bounded `site_id`, `module_id`, `function_id`,
known `probe_id`, fixed sample divisor and named exit edges. A site may
instrument normal return, throw, raise, panic, cancellation and paired
suspension/resumption. `span_time=active` stops timing while suspended,
whereas `wall` includes queue/suspension time. These two semantics must
never be reported as interchangeable.

- `off` only permits an empty site plan, so disabled builds produce no
  instrumentation sites.
- `aot` emits a deterministic sorted plan with a SHA-256 fingerprint.
- `jit` requires a pinned AOT baseline plan digest and identical typed IR
  digest; adding/removing sites or changing exit edges/timing/sampling fails.
- Unexpected fields, duplicate IDs/edges, unsupported probe IDs,
  unpaired suspension, missing terminal paths, excessive site counts and
  nonliteral names fail closed.
- The planner returns **metadata only**; it cannot itself insert typed IR
  hooks or emit any executable code. AOT instrumentation/codegen and true
  JIT specialization are **not yet proven** by this contract.

Backend-specific `.atto` modules include `core/perf_policy.atto` with
pure numeric sampling, monotonic elapsed arithmetic, admission and overflow
rules. Each compiler owns its implementation independently. The JavaScript
backend has a proposed compiled guest-execution test and Rust has a proposed
compiled Wasm guest test using exact `.atto` policy functions; neither
receives guest execution credit without stepful exact-source evidence.
