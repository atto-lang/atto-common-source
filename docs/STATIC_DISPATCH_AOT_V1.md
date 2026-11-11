# AttoLang static dispatch and closed polymorphism — AOT v1

**Status:** proposed, executable **source-contract-only** policy. This is *not* proof of compiler integration, five-backend implementation, JIT-disabled native execution, or performance improvement.

This contract refines `AOT_LANGUAGE_CLOSURE_V1.md` and `METAPROGRAMMING_AOT_V1.md` without changing their existing guarantees. It defines admission information required from **the actual typed compiler** before backend code generation; a JSON plan or a passing reference policy test is **not** trusted compiler evidence.

## Dispatch categories

| Kind | Admission proof | Lowering |
| --- | --- | --- |
| `DIRECT` | Exact final method, sealed unique override, or whole-program uniqueness proof | Direct call to one precompiled symbol |
| `STATIC_WITNESS` | Named compile-time witness, verified ABI and finite reachable generic instantiations | Monomorphized or static witness-selected precompiled call |
| `CLOSED_INDIRECT` | Complete **ordered** finite target set, stable slot ABI, complete fallback, no implementation registry | Precompiled table/conditional selection (indirect execution is permissible) |
| `ACTOR_MESSAGE` | Closed **ordered** compiled handler slots, stable actor identity, generation fence, admission, isolation and nonreentrancy | Runtime mailbox routing to compiled handlers, **never direct actor-state mutation** |

**Do not** infer a unique virtual dispatch target solely from a declared base class. A direct call requires a proof that an override cannot change the selected callee. Inlining and speculative optimization must preserve override semantics and correct fallback.

The compiler's actual dispatch evidence must bind a call-site identity to a concrete target, receiver type, nominal owner, arity/ABI, effect set, visibility, capability, borrow mode and generated-code provenance. Where a call can pick multiple implementations, the evidence must include the complete ABI-compatible, precompiled target set. Avoid prescribing a single link-symbol encoding while the Java arity and .NET nominal ABI contracts are still evolving.

## Absolute invariants

1. JIT may optimize admitted closed behavior; **the same source semantics must have a fully AOT-compiled path with no runtime source compiler or JIT**.
2. Runtime method-name lookup, mutable implementation registries, source/macro compilation, unbounded specialization and runtime type generation are not legal correctness dependencies.
3. Re-run name/type/effect/ownership/borrow/visibility/capability/actor-isolation checks **after every hygienic macro expansion**. Macro-generated IR has no privileged bypass.
4. Reject unproven overrides, missing target implementations, duplicate slot identities, unsound ABI casts and unknown receiver authority **before emitting a runnable artifact**.
5. Runtime actor message routing remains nonreentrant and generation-checked, with explicit supervisor ownership and mailbox admission. A static method call must not bypass that boundary.
6. Finite generic closure is a hard requirement. Shape sharing and witness reuse are allowed only when ABI, effects, ownership and semantics are equivalent. Bounded specialization does not permit a hidden JIT.
7. No speedup assertion is valid without executed benchmarks on a matched toolchain and recorded AOT binary-size and compile-time regressions.

**Ordering invariant:** compiler-emitted indirect targets and actor-handler slots must preserve the exact index-to-target mapping of the verified plan. A permutation of a complete set is still an invalid dispatch mapping. Reordering is permissible only when every index/ABI mapping is correspondingly updated and reverified.

## Normative v1 validation surface

- `fixtures/static-dispatch-aot-v1.json`: four dispatch kinds, five positive controls and twenty negative cases, including reordering a complete vtable. Values such as `verified.type=true` are **illustrative expected evidence**, not cryptographic provenance.
- `tools/validate-static-dispatch-aot-v1.mjs`: strict source-plan validator; rejects unknown fields, unclosed sets, missing evidence, unsound dynamic fallback or malformed identities.
- `tests/static-dispatch-aot-v1.test.mjs`: positive, negative, and adversarial mutation checks. Runs locally with `node --test tests/static-dispatch-aot-v1.test.mjs`.
- `.github/workflows/static-dispatch-aot-v1.yml`: exact-head source-contract CI. **This is not compiler-backed guest verification**.

## Cross-backend acceptance matrix (not yet passed)

| Backend | Required next execution |
| --- | --- |
| Java/GraalVM | Exact-target/override/arity resolution, compiler-generated static witnesses, Graal Native Image with JIT-independent guest execution |
| LLVM | Integrate callsite proof and use existing class-method direct lowering; repeat actual O0/O2 and sanitizer guest tests on exact final branch |
| .NET NativeAOT | Lower supported method calls into closed CIL/IL with explicit receiver/slot checks, publish NativeAOT artifact and execute it |
| Wasm | Precompile finite function tables and verify indirect-call bounds; execute an actual Wasm module without guest runtime compilation |
| Forge/Cranelift | Direct typed callee and closed static witness/indirect paths; verify native AOT and actor isolation |

For every backend, **unsupported cases must reject**, not silently fall back to guest interpreter, reflection, runtime method-string lookup or unproven dispatch. Report unsupported features as `NOT_IMPLEMENTED`, source-only proofs as `SOURCE_CONTRACT_ONLY`, host-only controls as `HOST_ONLY`, zero-step CI as `NOT_EXECUTED`, and actual native guest execution only when verified.

## Immediate handoff

1. Run the source-contract tests and retain exact commit/tree and nonzero executed-step receipts.
2. Add a compiler-emitted post-verification dispatch-plan manifest, cryptographically or structurally tied to the exact compiled source identity; do **not** trust guest-authored plan JSON.
3. Add cross-backend `.atto` positives/negatives and mandatory strict AOT artifact checks; start with existing LLVM concrete class and Java arity/override probes.
4. Record direct-vs-indirect and specialization latency/code-size benchmarks separately from correctness tests.
5. Obtain independent reviewer approval before merging backend changes.
