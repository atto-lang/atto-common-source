# ModelGraph hardening audit — 2026-10-19

Status: DRAFT / reference contract, not an implemented Oreslang compiler feature. This supplement covers PR #93 and the merged model proposal #76. Preserve the existing ML model spelling; do not claim parser, guest runtime, native-code, GPU, or cross-backend equivalence.

## Security findings and mitigations

| Priority | Finding | Reference hardening | Remaining production obligation |
| --- | --- | --- | --- |
| Critical | Guest nodes could assert they are pure, differentiable, allocation-free, deterministic or cheap | HIR carries structural IDs/dependencies plus canonical static constants only; type/effect/VJP/resource/profile/ABI/implementation provenance come from a compiler/linker-owned registry. Prototypes, accessors and forged fields rejected. | Real Java and LLVM typed lowering, trusted operation registration and implementation-digest provenance |
| High | Short-circuit traversal misses gradient fan-in and duplicate operands | Deterministic iterative all-parent gradient reachability, path-aware VJP checks, nested targets | Compiled VJPs and independent finite-difference gradients |
| High | Graph, training state, parameter ownership and actor placement were conflated | Immutable graph definition vs independently owned instance vs explicit execution session | Compiler/runtime ownership, leases, hot reload and version fences |
| High | Unbounded shapes and scratch | Checked integer extents, rank, byte arithmetic, resource budget, node count, edge count and path depth | All runtime op scratch bounds enforced; zero-GC and hard real-time NOT proven |
| High | Silent conversions and effect changes | Strict port matching for dense numeric/bool buffers and compiler-owned nominal value ABIs; unit/layout/shape mismatches and effectful nodes denied | Typed ABI, symbol identity and signed/attested code-version contracts |
| High | General-purpose claim still encoded every port as a tensor-like shape | Added nominal value/record/domain ports with exact type ABI and conservative fixed storage bound | Backend representation and ordinary Oreslang nominal type integration |
| High | Static layer/config arguments could execute code or destabilize graph identity | Canonical tagged constants with bounded kinds; nonfinite f64, i64 overflow, accessors and forged metadata rejected | Frontend constant evaluation, defaults, graph digest and ABI parity |
| High | Freestanding/allocation/determinism could be guest-forged or confused with hard real time | Execution capabilities derive from trusted op profiles; strict callers can require freestanding/no-dynamic-allocation/determinism; no hard-real-time bit exists | Target-specific AOT/allocation/WCET/scheduler evidence |
| Medium | Host reference could be mistaken for compiler proof | Both host summaries explicitly say executedGuest=false and executable=false | Exact-head real backend guest execution, CI runner steps |

## HIR admission boundary

Versioned schema: contracts/v1/model-graph/graph.schema.json. The graph contains name, ordered nodes of id/op/inputs, optional canonical constArgs, and output node IDs. A trusted compiler signature registry supplies operation input/output ports, effects, VJP availability, resource cost, allocation/freestanding/determinism profile, ABI and implementation provenance. The schema alone does NOT validate graph topology, authenticity, trust-domain provenance, memory safety or guest execution.

The reference now supports two port families: fixed dense numeric/bool buffers (optional unit/layout) and exact compiler-owned nominal values/records/domain types with a conservative fixed storage bound. It deliberately does **not** implement symbolic dimensions, arbitrary strided storage, dynamic execution, serialized executable op code, generic record layout reflection or actual arithmetic. Static op configuration is inert canonical data, not a callback/expression evaluator. This HIR is not automatically valid Oreslang source; v1 source syntax remains the ordered nominal operation sequence. Future named-port DAG syntax still needs a separately versioned language design and backend implementation.

Gradient request admission checks *every* live predecessor, including repeated operands and nested target cases, and rejects missing VJPs on required paths. Inference-only nondifferentiable models are legal. The host reference cannot validate a VJP implementation; it only asserts its trusted signature availability.

## Evidence and execution gate

- Exact current-branch source was re-evaluated in an isolated V8 harness with Node-compatible test/assert shims after the nominal-port/static-argument/profile hardening:
  - general-purpose contract: **12/12 PASS**;
  - hardened ModelGraph admission: **36/36 PASS**, including the seeded 512-chain mutation case;
  - ModelRunStamp fencing: **10/10 PASS**;
  - total independently re-executed in this harness: **58/58 PASS**.
- This isolated V8 execution is **not** a real `node --test` process, compiler/parser, Java/GraalVM, LLVM, Native Image, numerical kernel or Oreslang guest result. The filesystem-dependent model-autodiff suite was not re-executed by this isolated harness.
- Latest exact-head source-org model workflow observed during this audit: run **39345353370**, job `host-contract`, completed failure with **steps=null**. Therefore zero workflow steps executed; this is neither a code assertion failure nor passing CI evidence.
- The read-only workflow now syntax-checks the admission module, parses the JSON schema, and requests all model host suites when a runner is actually allocated.
- No private Git tree was copied outside the source organization. External runner capacity does not authorize private-source export.

## Before merge

1. Independent architecture/security review, in particular trusted op-registration provenance and resource admission.
2. Exact-head real Node CLI run with observed nonempty executed steps.
3. Java/Graal and LLVM contextual parser/HIR, nominal model type/value semantics, canonical static constants, type/effect/ownership lowering, and real guest positive/negative programs using the cross-domain fixture manifest (pricing, signal/DSP, forward-only no-VJP, nonconstant config, effect and recursive-composition rejection).
4. Cross-backend canonical graph/op-identity/run-fence agreement, including implementation digests, graph generation, instance/parameter versions and execution-profile digest.
5. Numerical independent oracle, saved activation/parameter version fences, allocator and sanitizer tests, plus a full-AOT freestanding/preallocated execution path with measured no runtime allocator calls. Hard real time remains a separate qualification.
6. Only then stage optional actors, Tasks, parallelism, GPU and distributed model execution under independent security and correctness gates.

Keep PR #93 in DRAFT until these gates are satisfied.

## Follow-up hardening (2026-10-19)

The source-free admission oracle now rejects own accessor properties, symbol/non-enumerable metadata, and sparse/accessor-backed HIR arrays before consulting their values. The regression suite adds two cases asserting that hostile getter functions are not invoked. This specifically closes a host-oracle validation trust-boundary weakness; it does not establish a tamper-proof compiler op registry or hardened execution of third-party operation code.

**Evidence:** Changes committed to PR #93, but exact-head Node CLI tests, compiler fixtures, native sanitizers and numerical runtime tests have not passed in this update. A new or retried workflow must report actual executed steps before any test-pass claim.

**Residual:** Proxies can intercept reflective operations and must never cross a real compiler trust boundary as arbitrary host JS values. A production frontend must validate a decoded plain-data representation, use immutable compiler-owned signatures, and impose decoding, memory and operation budgets before lowering. Budget accounting here is conservative and is not a lifetime-sensitive allocation proof.


## Cross-domain and execution-profile hardening (2026-10-19)

The general-purpose contract now explicitly separates model **type**, immutable graph blueprint, owned model **value/instance**, compiled execution plan and long-lived session/run state. Static models may lower entirely to AOT code plus read-only descriptors; `core::model` does not require a heap, OS, threads, JIT, Tensor or autograd. `alloc::model` and hosted `std::model` are optional layers.

The source-free HIR now carries canonical static operation arguments because real cross-domain models need configuration such as layer widths, filter cutoffs, solver constants and tax rates. The guest HIR still cannot provide purity, VJP, resource bounds, allocation class, ABI or implementation digest. Canonical f64 configuration is represented by finite IEEE-754 bits to avoid locale/text-rounding ambiguity.

A model can be freestanding, preallocated and deterministic without being hard-real-time-qualified. The reference intentionally emits no `hardRealtime` capability. Production hard-real-time admission must add target-specific WCET/bounded-loop evidence, scheduler/preemption/interrupt constraints, memory residency and backend code-generation proof.

Proposed source fixtures now cover non-ML pricing/business and signal-processing models plus forward-only nondifferentiable inference, nonconstant static configuration rejection, effect rejection and recursive composition rejection. They remain **NOT_EXECUTED** until real Java and LLVM compilers consume them.


## Compiler parser/HIR gate and portable identity update (2026-10-19)

Real frontend work now exists, still behind deliberate non-executable gates:

- Java/Graal draft PR **oreslang-source.java#1554** parses contextual `define model` into dedicated inert model AST nodes at top level/modules and then raises `MODEL_LOWERING_NOT_IMPLEMENTED` before ordinary type/runtime lowering.
- LLVM/native draft PR **oreslang-source.llvm#690** mirrors that posture with parser-level model HIR and raises the same gate before ownership/codegen; its parser CTest target intentionally excludes LLVM codegen.
- Shared `contracts/v1/model-graph/compiler-cases.json` now contains finance/pricing, DSP/signal, forward-only no-VJP and parser-negative cases so both compilers converge on non-ML behavior.
- `MODEL_GRAPH_DIGEST_V1.md` plus `digest-v1-vectors.json` pins portable SHA-256 identity independently of temporary node labels while binding static constants, exact op ABI/implementation/provenance, ports and portable op profile.
- `diagnostics-v1.json` pins diagnostic classes to syntax/lowering/admission/gradient/identity/implementation phases. Backend-specific wording/locations may vary; shared fixture classes may not.

Source-organization Actions for Java #1554, LLVM #690 and common-source continue to show failed jobs with `steps=null`; no backend test pass is claimed. A source-free probe in `ores-stack/.github#3` also produced `steps=null` on push and pull-request events, so no private compiler source was mirrored there and the probe PR was closed.

The next release gate is a compiler-owned resolved ModelGraph descriptor on both backends that passes the portable digest vectors and diagnostic registry before any model execution path is enabled.


## Cross-backend identity/fencing milestone follow-up — 2026-10-19

The Java and LLVM compiler prototype branches now carry the v1 portable graph digest, execution-profile digest, resolved ordered-model lowering and run/version fencing surfaces. This audit found and corrected several parity blockers before guest execution:

- **Unary external input boundary:** the shared digest contract permits a first ordered operation with one signature input and zero graph-parent edges to represent `run(input)`. Both digest validators incorrectly required dependency count to equal signature-input count, making the external-input golden vector impossible. Java and LLVM now allow exactly this first-node unary case and still reject multi-input implicit boundaries.
- **Java digest compilation:** the Java digest used a negated pattern variable across an `||` guard and did not compile under JDK 21 because the pattern variable was out of scope after the guard. The guard now performs an explicit checked cast.
- **Fence diagnostics:** Java stale graph-generation rejection now uses the shared/native `MODEL_GRAPH_GENERATION_MISMATCH` diagnostic.
- **Nominal identity grammar:** model/run IDs now align with portable nominal IDs such as `finance.PriceEstimate@v1`; malformed/whitespace IDs fail closed.
- **Stateless instances:** `parameterVersion = null` is now an explicit valid run-fence state in the shared contract, Java and LLVM. A stateless run cannot silently match a stateful parameter version.
- **Replay/cache/version separation:** graph generation, parameter version, run ID, graph digest and execution-profile digest remain independently fenced; compiled-plan cache identity continues to require graph + execution-profile digests.

### Local isolated evidence

Because current source-org Actions still report failed jobs with `steps=null`, no source-org CI pass is claimed. Additional isolated execution was performed without exporting private source:

- JDK 21: the Java `ModelRunFencing` class logic compiled and executed a stateless/`@v1` identity harness successfully.
- JDK 21: the Java portable graph-digest class logic compiled after the pattern-scope fix and matched the shared pricing golden digest `e4b3337b...833c`, canonical byte length 544, admitted the unary external-input boundary, and rejected an implicit binary external boundary.
- JDK 21: the execution-profile digest logic matched shared reference digest `8440c7b5...9695` and canonical byte length 127.
- Node 22: the run-fence reference logic executed canonical `@v1` and stateless cases successfully in an isolated direct test harness.

These are component-level execution receipts, **not** full Maven/Gradle, Graal Context.eval, CMake/CTest, LLVM IR/native guest, Native Image, or end-to-end Oreslang model execution. The next promotion gate remains real source-to-resolved-graph-to-guest CPU execution using ordinary verified Oreslang operations, followed by cross-backend numerical/output parity.
