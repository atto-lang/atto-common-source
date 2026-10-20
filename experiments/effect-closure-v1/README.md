# Effect-closure reference checker, version 1 (experimental)

This is an executable **reference model**, not a production Oreslang compiler, static proof engine, or certification authority. It accepts a caller-supplied, *already resolved* call graph and transitive effect facts. It **does not** parse `.ores` source, discover missing callees, authenticate Git SHA claims, attest compiler provenance, validate C/Java runtime closure, prove real-time deadlines, or emit a trusted release certificate. A malicious/buggy producer can lie or omit reachable code. Its output **must not** be used to authorize unsafe, untrusted, hard-real-time, collector-free or full-AOT deployments without separate trusted frontend and runtime verification.

The experiment implements bounded, fail-closed **shape validation** and fixed-point effect propagation, with deterministic witness paths to local violating declarations. It models the first shared HIR/MIR effect contract while the Java and LLVM compilers remain independent. It does not change the shared HIR/MIR schema or either production compiler.

## Run

```sh
python3 -m unittest discover -s experiments/effect-closure-v1/tests -v
python3 experiments/effect-closure-v1/effect_closure.py experiments/effect-closure-v1/fixtures/pure.json --profile hard_rt --profile zero_gc --profile full_aot
python3 experiments/effect-closure-v1/effect_closure.py experiments/effect-closure-v1/fixtures/impure.json --profile hard_rt
```

Exit codes: `0` = compatible **only with supplied, unverified effect facts**; `2` = declared effect incompatible with the selected profile; `3` = invalid input or I/O error. The report status is always `UNVERIFIED_DECLARED_FACTS_NOT_COMPILER_OR_TIMING_PROOF` and all Git identities are explicitly labeled claims. Failures produce no successful report. The engine does not use source text or execute guest/native code.

## Strict v1 input contract

UTF-8 JSON, at most 1 MiB, exact fields only, no duplicate object keys. `schema_version:1`, `kind:"ores-effect-graph"`, lowercase 40-hex `source_tree`, `producer:{backend:"java"|"llvm"|"reference",revision:<lowercase 40-hex>}`, nonempty `entries`, and nonempty `functions`. Functions have exactly `id`, `calls`, and `effects`; all call targets must be declared and function IDs unique. The eight **required** effects are:

`blocking_io`, `dynamic_dispatch`, `ffi`, `gc`, `heap_alloc`, `runtime_codegen`, `suspension`, `unbounded_work`.

For each effect use exactly one of `never`, `bounded`, `unbounded`, or `unknown`. `bounded` is a **declaration**, not a WCET proof. Effect aggregation uses `never < bounded < unbounded < unknown`, computing the conservative maximum over every reachable call, including cycles; this is an effect *may* analysis, not resource consumption arithmetic. Each call graph must be exhaustive and come from a trusted, independently verified producer before any production admission. Function count <= 4096, call edges <= 65536, entries <= 64, calls/function <= 256. IDs are limited to ASCII symbol-like forms; no ad-hoc per-function annotations are accepted.

The deliberately narrow v1 `hard_rt` policy rejects any heap allocation, blocking I/O, FFI, GC, runtime code generation or dynamic dispatch, plus unknown/unbounded suspension and work. Reachable recursive call cycles also reject in `hard_rt` unless a separate termination proof is supplied; a cycle by itself does not prove bounded work. Future profiles may allow verified bounded allocations, FFI and dynamic dispatch with separate evidence. `zero_gc` rejects non-`never` GC declarations; `full_aot` rejects runtime codegen, dynamic dispatch and FFI. Neither policy detects omitted calls or a collector hidden in a linked native library. These are **compatibility screens, not whole-program certifications**.

A complete design must eventually include typed MIR, linked native/Java ABI closure, alloc-site/arena bounds, tail-call/recursion contracts, exception edges, dispatch soundness, imported platform/FFI contracts, scheduler and WCET evidence, and cryptographically attested producer identities. See [real-time architecture PR #94](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/94) and the existing [memory safety design](../../docs/MEMORY_SAFETY_AND_PERFORMANCE.md).

## Test evidence

The portable suite covers positive/rejected profiles, indirect call witnesses, SCC cycles, deep graphs, an independent seeded reachability/effect oracle, input size/unknown field/duplicate key/call/entry validation, truncated diagnostic paths, malformed Git identities, and CLI exit codes. The tests validate this **model** only; separate exact-tree LLVM/Java executable proof and source-to-IR integration are required.
