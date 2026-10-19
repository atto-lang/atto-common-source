# ModelGraph hardening audit — 2026-10-19

Status: DRAFT / reference contract, not an implemented Oreslang compiler feature. This supplement covers PR #93 and the merged model proposal #76. Preserve the existing ML model spelling; do not claim parser, guest runtime, native-code, GPU, or cross-backend equivalence.

## Security findings and mitigations

| Priority | Finding | Reference hardening | Remaining production obligation |
| --- | --- | --- | --- |
| Critical | Guest nodes could assert they are pure, differentiable or cheap | HIR input admits only id/op/inputs; type, effect, VJP, scratch upper bound and ABI come from a compiler-owned signature registry. Prototypes and forged fields rejected. | Real Java and LLVM typed lowering and trusted operation registration |
| High | Short-circuit traversal misses gradient fan-in and duplicate operands | Deterministic iterative all-parent gradient reachability, path-aware VJP checks, nested targets | Compiled VJPs and independent finite-difference gradients |
| High | Graph, training state, parameter ownership and actor placement were conflated | Immutable graph definition vs independently owned instance vs explicit execution session | Compiler/runtime ownership, leases, hot reload and version fences |
| High | Unbounded shapes and scratch | Checked integer extents, rank, byte arithmetic, resource budget, node count, edge count and path depth | All runtime op scratch bounds enforced; zero-GC and hard real-time NOT proven |
| High | Silent conversions and effect changes | Strict port matching for dtype, physical units, layout and shape; effectful nodes denied on use | Typed ABI, symbol identity and signed/attested code-version contracts |
| Medium | Host reference could be mistaken for compiler proof | Both host summaries explicitly say executedGuest=false and executable=false | Exact-head real backend guest execution, CI runner steps |

## HIR admission boundary

Versioned schema: contracts/v1/model-graph/graph.schema.json. The graph contains name, ordered nodes of id/op/inputs, and output node IDs. A trusted compiler signature registry supplies operation input/output ports, effects, VJP availability, resource cost and ABI. The schema alone does NOT validate graph topology, authenticity, trust-domain provenance, memory safety or guest execution.

Current reference only covers numeric/bool finite primitive scalar and dense-shaped ports, plus optional unit and layout. Domain records, symbolic batch dimensions, strided storage, dynamic execution, serialized op code, and actual arithmetic are NOT implemented. This typed HIR is not automatically valid Oreslang source; v1 source syntax remains the ordered nominal operation sequence. Future named-port DAG syntax needs a separate language design and backend implementation.

Gradient request admission checks *every* live predecessor, including repeated operands and nested target cases, and rejects missing VJPs on required paths. Inference-only nondifferentiable models are legal. The host reference cannot validate a VJP implementation; it only asserts its trusted signature availability.

## Evidence and execution gate

- Old host reference suite: 12/12 passed.
- New v2 suite: 25/25 passed including a 512-case deterministic randomized chain test.
- Combined: 37/37 on the exact GitHub-fetched JS source in isolated V8 using Node test/assertion shims. **NOT** actual Node CLI execution or guest compiler proof.
- Source-org model contract Actions run 39342761073 failed without any executed job steps (steps=null). That is NOT proof of test failure or available billing minutes.
- New CI workflow requests both host suites under node --test with read-only permissions; its actual source-head execution remains unverified.
- No private Git tree copied outside the source organization. The existing Java main source-transfer destination policy remains empty. External runner capacity probes do not authorize source export.

## Before merge

1. Independent architecture/security review, in particular trusted op-registration provenance and resource admission.
2. Exact-head real Node CLI run with observed nonempty executed steps.
3. Java/Graal and LLVM contextual parser/HIR, type/effect/ownership lowering, and real guest positive/negative programs (at least non-ML pricing/signal, ML forward-only, differentiable fan-in).
4. Numerical independent oracle, saved activation/parameter version fences, allocator and sanitizer tests, AOT/freestanding evidence and cross-backend agreement.
5. Only then stage optional actors, Tasks, parallelism, GPU and distributed model execution under independent security and correctness gates.

Keep PR #93 in DRAFT until these gates are satisfied.

## Follow-up hardening (2026-10-19)

The source-free admission oracle now rejects own accessor properties, symbol/non-enumerable metadata, and sparse/accessor-backed HIR arrays before consulting their values. The regression suite adds two cases asserting that hostile getter functions are not invoked. This specifically closes a host-oracle validation trust-boundary weakness; it does not establish a tamper-proof compiler op registry or hardened execution of third-party operation code.

**Evidence:** Changes committed to PR #93, but exact-head Node CLI tests, compiler fixtures, native sanitizers and numerical runtime tests have not passed in this update. A new or retried workflow must report actual executed steps before any test-pass claim.

**Residual:** Proxies can intercept reflective operations and must never cross a real compiler trust boundary as arbitrary host JS values. A production frontend must validate a decoded plain-data representation, use immutable compiler-owned signatures, and impose decoding, memory and operation budgets before lowering. Budget accounting here is conservative and is not a lifetime-sensitive allocation proof.
