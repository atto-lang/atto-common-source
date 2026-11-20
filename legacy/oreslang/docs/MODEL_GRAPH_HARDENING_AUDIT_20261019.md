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


## Executable-v1 differential corpus and current-main integration — 2026-10-20

A single shared executable conformance corpus now lives at
`contracts/v1/model-graph/executable-v1-conformance.json`.
Its current revision is `model-core-i64-v1.2026-10-20.4`.

The portable profile is explicitly named `model-core-i64-v1` and is narrower than
the Java interpreter surface. Portable operation expressions are limited to i64
literal/parameter reads, unary negate, add, subtract and multiply in an ordered
linear model. Java-only float/bool/string/Symbol and stored model-instance behavior
are not silently advertised as LLVM-portable.

The corpus now pins:

- positive `delta=2` graph/configured identities;
- negative `delta=-2` graph/configured identities;
- the exact signed i64 minimum endpoint;
- negative static literals;
- symmetric signed overflow rejection around the one legal `-2^63` endpoint;
- unknown operation, disabled model composition and run arity rejection;
- unknown static formals as `MODEL_UNKNOWN_FORMAL`;
- duplicate model parameters as `MODEL_DUPLICATE_PARAMETER`;
- the deliberate stored-model-value capability split (Java execute, LLVM
  `MODEL_VALUE_STORAGE_UNSUPPORTED`).

Diagnostic hardening also found and removed a semantic class collision: LLVM had
used `MODEL_UNKNOWN_CONFIG` for undeclared source formals while Java used that
class for unexpected configured-instance keys. Source formals now use
`MODEL_UNKNOWN_FORMAL`; `MODEL_UNKNOWN_CONFIG` is reserved for configured
identity validation.

The shared diagnostic registry has been expanded to cover the active executable
backend surface. A source scan after the changes found all actual LLVM model
diagnostics registered; Java's only unmatched `MODEL_...` strings were
non-diagnostic constant identifiers plus the subsequently registered internal
`MODEL_INVALID_PROGRAM` guard.

### Signed-i64 hardening

Java now accepts unary minus only over a direct numeric literal at the model
constant boundary; it does not broaden static configuration to arbitrary constant
expressions. Model-local integer overflow is normalized to
`MODEL_CONST_OVERFLOW`.

LLVM now parses the exact magnitude `9223372036854775808` after unary minus as
`INT64_MIN`, while still rejecting positive `2^63` and values below
`INT64_MIN`. Model defaults/static arguments use model-specific overflow
diagnostics; generic non-model integer parsing remains unchanged.

Independent local component oracles (not full compiler tests) passed:

- SHA-256 recomputation for the shared +2, -2 and INT64_MIN graph/configured
  vectors;
- strict C++17 (`-Wall -Wextra -Wpedantic -Werror`) signed endpoint logic:
  max positive accepted, INT64_MIN accepted, positive 2^63 and below-min rejected.

### Current-main integration

The active executable routes have been brought onto their current main branches
without destructive rebases:

- LLVM #708: a two-parent merge commit preserves the feature history and current
  main, with the only overlapping file (`CMakeLists.txt`) integrated from the
  exact three model-test hunks. After the merge the PR is 0 commits behind main
  and mergeable.
- Java #1574: GitHub reported the PR conflict-free. Its synthetic merge tree
  against current main was reused to create a real two-parent feature-branch merge,
  preserving both the exact feature head and all current-main edits. After the
  merge the PR is 0 commits behind main and mergeable.

Fresh exact-head source-org workflows still fail before runner allocation with
`steps=null` on Java, LLVM and common-source. These are infrastructure results,
not compiler failures. The previously identified private funded repository cannot
be used for a private cross-organization source mirror through the available
connector because that transfer is blocked by the connector safety boundary.
No alternate-org compiler pass is claimed.


## Executable corpus revision .10 and alpha-stable operation identity — 2026-10-20

The portable executable contract is now mechanically consumed by both active
backends rather than copied case-by-case.

Normative source:

- `contracts/v1/model-graph/executable-v1-conformance.json`
- revision `model-core-i64-v1.2026-10-20.10`

Deterministic backend projection:

- `contracts/v1/model-graph/executable-v1-conformance.cases`
- vendored byte-for-byte into Java test resources and LLVM tests;
- current Git blob SHA in all three repositories:
  `5b91104d2c963f801a53ba60c31da54fef38b88f`.

Common-source regenerates the line-oriented projection from the normative JSON
and requires exact byte equality. The format carries case ID, backend mode,
diagnostic, graph/configured digests, semantic result, explicit configured i64
value, and hex-encoded ASCII source. Identity differential records carry both
baseline and variant source.

The corpus currently contains 28 executable/admission cases plus four identity
differential pairs. It covers signed boundaries, configuration arity/default
ordering, nonconstant configuration, effectful operations, empty and recursive
models, identifier/model/node/config/static-argument budgets, unknown operations
and formals, duplicate model/operation parameters, disabled composition, run
arity, Java-only stored model values, and positive/negative/INT64_MIN execution.

### Alpha-stable operation implementation identity

The previous implementation digest encoded source parameter names
(`name:input`, `name:delta`). That made alpha-renaming a verified operation
invalidate the graph despite unchanged behavior.

Portable v1 now canonicalizes operation parameter references by declared ordinal:

- `Identity(int input) { return input; }` -> `return=arg:0`
- `AddDelta(int delta, int input) { return input + delta; }` ->
  `return=binary:+(arg:1,arg:0)`

Parameter spelling, comments, formatting and source locations therefore do not
change operation identity. Operand order, literal values and static-argument
order remain deliberately identity-sensitive; v1 performs structural semantic
identity, not algebraic equivalence normalization.

Current canonical vectors:

- Identity implementation:
  `962f6b4865f7d64c5dfea914b09abdac61af4f1a41679e8f6b3adaa2bfabc9fe`
- AddDelta implementation:
  `75370f10ccb547c3a559258c0ced1fa07cdf603b4e612702b8204250d3c4f71a`
- PriceAdjust(delta=2) graph:
  `6c5e66eb67149e59c7d4d2d962b5671850ee3298f729214127d1452cb8d5ca21`
- configured delta=2:
  `3975a5571cb2fddcc6206ee0b3f0f893dcb3fa9bfbe591b8c5b9f5ab8ff539e1`
- PriceAdjust(delta=-2) graph:
  `f5b7956076ea5bc9696f4cd23d68c3e4c67d7ec90023a64c834d14d304249c1d`
- configured delta=-2:
  `15ca34acbdc5478bc2971ae7895d708aca2d324be418819a2e60b3c04bc20a5c`
- PriceAdjust(INT64_MIN) graph:
  `cb008cb043de50f1663ba8faa77de94c50d92514fa2b95cbd72de5225cf5cb80`
- configured INT64_MIN:
  `27ed4d26451fa960a8271495ee8ac96bbb67bc3369ca45cf2205222a962de5a3`
- explicit delta=-3 configured on the -2 blueprint:
  `ecf89f781f51b8f9cd71539e84b308c953ef55c85a52e716ce885b83fa3c20c6`.

LLVM now rejects duplicate operation parameter names before ordinal identity
encoding. Java already required distinct immutable operation parameters.

### Derived portable profile

Portable eligibility is a compiler-derived fact, never guest metadata.

Java exposes `model-core-i64-v1` only when all model configuration, ports,
static arguments and verified operation expressions are in the shared i64
subset. Java models using float/string/Symbol or operators such as integer
division may still execute on Java but do not acquire the portable profile.

The current LLVM executable model slice is exactly the admitted
`model-core-i64-v1` subset and records that profile on the compiler-owned model
descriptor after successful admission.

### Shared execution

Java's `FirstClassModelGraphTest` parses the vendored projection and:

- runs all rejection cases through the real parser/type/ModelGraph admission path;
- validates graph/configured identities;
- executes result-bearing Java cases through Polyglot and compares the returned
  i64 result;
- executes all shared identity differential pairs.

LLVM's C++ ModelGraph contract parses the same vendored projection for
admission/identity checks. `native_model_source_execution.py` now also reads
that projection and drives the real source -> oreslang-llvmc -> LLVM IR -> Clang
-> native-process gate for result-bearing cases, with INT64_MIN compile-only
until a lossless native i64 result transport replaces process exit status.

The shared corpus itself found an additional Java bug during this wiring:
explicit negative constructor arguments such as `PriceAdjust(-3)` were still
rejected because construction typing admitted only `LiteralExpr`. Java now
admits exactly a direct numeric unary-minus literal, matching defaults/static
arguments, while `-(1 + 1)` remains `MODEL_NONCONSTANT_CONFIG`.

These tests are committed but source-org Actions are still required to execute
them. No zero-step workflow is evidence of backend conformance.
