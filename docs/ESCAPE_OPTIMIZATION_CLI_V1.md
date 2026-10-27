# Optional escape optimization and JIT CLI contract v1

**Status (2026-10-27): proposed cross-backend policy contract, not executable optimization parity.** The common-source repository has no shared HIR/MIR optimizer yet. Forge has only an interpreter-backed JIT tier policy. Do not advertise heap-to-stack promotion, scalar replacement, or true JIT based on an accepted flag alone.

## Public policy surface

- `--opt-escape=off|safe|verify|speculative` maps via **flags-2-env** to `ORES_OPT_ESCAPE`. `off` is the rollout default; at a future proven `-O2/-O3` milestone, `safe` may become default separately per backend.
- `--jit=on|off` maps to `ORES_JIT`. It defaults to `off`, remains independent of non-speculative allocation optimization, and must reject when no executable JIT exists.
- `--opt-escape-report` maps to `ORES_OPT_ESCAPE_REPORT`; default false. A true value requires an implemented evidence provider and verified decisions.
- Direct flag spellings, where supported, override mapped environment variables; invalid or duplicate direct flags reject. Backends must reject unrecognized modes. A no-op acceptance path is not a supported optimization implementation.

`safe` means proof-based transformations only: scalar replacement, stack promotion, or true elimination when identity, ownership, allocation failure behavior, destructor effects, and all exceptional exits are preserved. Some values should remain heap/actor-arena backed; some should be registers rather than stack slots. No heap-to-stack transformation is required merely because a flag was selected.

`verify` runs only when safe compilation *and* evidence/replay exist; it must fail if the evidence pipeline is unavailable. `speculative` requires a real JIT, guards, validated recovery, and materialization at deoptimization; it cannot mean interpreter-only tier bookkeeping. A speculative mode with `--jit=off` is intrinsically invalid.

Memory safety (ownership, borrow checking, bounds, correct drop, actor isolation) **does not depend on these optimization flags**.

## Storage and lifetime gates

Candidate allocation IR must conservatively mark observation and escape through:
1. return/capture/retained handles, identity comparisons and allocator failure;
2. actor message transport, channel send, actor-group cross-thread handles and shared graphs;
3. `await`, `select`, implicit `*_blocking` suspension, cancellation and continuation/pinned frame lifetimes;
4. FFI and callbacks, `unsafe` pointer provenance and external side effects;
5. error exits, `defer`, unwind, destructor/drop obligations, and hot reload generation retirement.

Any unproven or oversized candidate stays within its existing safe storage discipline or is rejected at compilation when even the fallback is not safe. Never dynamically spill an unbounded value onto a native stack. A stack slot is not safe merely because its allocation site is lexically inside the caller.

## Initial typed allocation MIR classification slice

The additional `contracts/v1/escape-allocation-mir-v1.json` introduces an
explicit *candidate* vocabulary (`scalar-candidate`,
`stack-candidate`, `preserve-allocation`) plus negative vectors for
escaping values and lifetime hazards. Forge's
`compiler/escape_analysis.hpp` is a standalone C++ implementation and
`verification/escape_analysis_tests.cpp` exercises its decisions.
The CTest name is `oresforge_escape_candidate_analysis`.

The standalone typed classifier is not in the general Forge source parser.
A separate closed-world `Point` x86-64 experiment now parses a very small
source grammar into typed fields and emits either an actual `malloc/free`
baseline or scalar-replaced arithmetic with no allocator call. It admits
`--opt-escape=safe` exclusively for `emit-alloc-asm x86_64`; normal
compiler commands still reject the flag. The Forge CTests
`oresforge_native_allocation_elision` and
`oresforge_allocation_native_elision` assemble/link and execute the native
variants using wrapped malloc/free counters and checked arithmetic.
These executed tests are pending exact-head GitHub Actions verification; code
and test registration must not be confused with a confirmed passing run. The model's `complete_effect_graph` marker is untrusted until a
real MIR verifier proves it, including alias/capture graphs and
exceptional/cancellation paths. Inter-object stores and cyclic reference
graphs are excluded from promotion until explicitly modeled. The current
value is a reproducible, fail-closed representation and regression substrate.

### Field-initialization checks (Forge classifier)

Forge's standalone candidate analyzer now checks ordered field-store and
field-load uses. A read before its modeled write is rejected; a verified
local borrow of a partially initialized aggregate cannot qualify for stack
promotion. Field writes to one allocation cannot initialize another.

**Limit:** this is a single ordered use stream. It is not a control-flow,
definite-assignment, exceptional-edge, alias, or lifetime proof for arbitrary
Oreslang source. The tiny Point parser initializes both fields before reads
by construction; general MIR must introduce CFG-aware dominance and
initialization proofs before exposing these optimizations.

## Evidence gate

The JSON contract in `contracts/v1/escape-optimization-cli-v1.json` defines policy vectors and future acceptance requirements. Reference-model tests establish **contract consistency only**. Promotion from unsupported to safe/verify/speculative requires real compiler tests, sanitizer execution, exact-revision build evidence, allocation measurements, stack budget tests, guards/deoptimization, and 5-backend differential cases. A backend lacking a requested tier must fail closed rather than silently downgrade and report success.

Current Forge draft: `off` works for general scalar compilation;
`safe` is restricted to the closed allocation-ASM experiment. `verify`,
`speculative`, `--jit=on`, and enabled reports are rejected.
The isolated language subset excludes allocator identity/hooks and catchable
allocation failures, FFI, actors, async, custom drops, and returned pointers.
The baseline can trap on host allocation failure while the scalar path has no
heap call; therefore no general-language allocation failure equivalence has
been proven. Broader `safe` must keep an allocation when failure or identity
is semantically observable, unless the language explicitly allows its
elision with a proven effect contract. Java/Graal, LLVM, .NET, and Wasm remain unverified for this specific policy; their existing native optimizers are not an implementation claim for the new common flags.
