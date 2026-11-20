# Macro and optional JIT audit: AOT is the semantic floor

Status: SOURCE-ONLY contract and unauthenticated evidence-shape validator. No compiler-backed results asserted.

- Canonical syntax: typed `define macro` / `name!(...)`; no runtime `macro_rules!` engine or `@expand(jit)`.
- All expansions and bounded comptime conclude before backend emission. Generated typed AST reenters ordinary type/effect/borrow/actor/capability checks, with exact hygiene identities.
- JIT may optimize *closed* executable code but cannot be required for an AOT build, generate type/trait identities, expand macros or mint authority.
- A strict AOT binary must execute generated guest application code with guest source compiler, macro expander, interpreter fallback and JIT absent. Native Image of an interpreter is not guest AOT.
- WebAssembly emitted from guest source is different evidence from Wasmtime host machine-code precompilation; label both separately.
- Hybrid must run from independent precompiled AOT baseline when JIT is disabled. Hot reload accepts a separately compiled and validated AOT generation; it does not compile macros inside actors.

## Smallest candidate execution matrix

MA001/MA002: compile const quotation and syntax passthrough to guest artifact and execute (42).
MA003-MA006: compiler-admission failures for unclosed const, macro meta-type ABI leak, private macro lookup and runtime eval fallback; require nonzero exit and no partial artifact.
MA007: scalar no-macro control (42), plus JIT/AOT differential for any implementation exposing JIT.
Each compiler must classify an unimplemented positive as UNSUPPORTED rather than treat rejection as implementation parity.

## Verified distinction

The Node tests validate manifest shape and adversarial classification logic only. The validator reports
`AOT_STRUCTURAL_UNAUTHENTICATED`, not PASS, for self-claimed complete evidence.
Independent GitHub job/run-attempt/readback, exact source tree, executed steps, native binary bytes
and real compiled-guest receipts are necessary. Empty steps remain NOT_EXECUTED.
No cross-org private-source mirroring is authorized by this patch.

## Drift identified in available branches

- Java macro PR #2049 has the typed front end, evaluator and provenance coverage, but no stepful source-org native guest verification.
- Earlier Java #473 implements experimental token `macro_rules!` and must be reconciled, not silently counted as the canonical grammar.
- LLVM #1026 produces `NATIVE_MACRO_EXPANDER_REQUIRED` rejection; this is admission only.
- Cranelift stage-0 currently exposes `run|ir` scalar native JIT, not a complete AOT executable emitter.
- .NET and Wasm should reject unsupported macros before codegen until their actual typed macro lowering exists.

To check source-free tests: `node --test tests/macro-aot-jit-evidence-v1.test.mjs`.
To validate *reported shape only*: `node tools/verify-macro-aot-jit-evidence.mjs receipt.json`.

**Fail-closed CLI behavior:** because supplied receipt JSON is not authenticated against
GitHub or artifact bytes, the command always exits nonzero, even for
`AOT_STRUCTURAL_UNAUTHENTICATED`. It can inspect shape and report
reasons, but never act as a release PASS gate. A future authenticated runner
adapter must independently verify job steps/attempt, checkout commit/tree,
compiler-produced guest receipts, target binary hashes and source digests.

The verifier also distinguishes `JIT_ONLY_STRUCTURAL_UNAUTHENTICATED` and
`HYBRID_STRUCTURAL_UNAUTHENTICATED` from AOT shape. All three remain
`release_qualified=false` and exit nonzero: optional JIT cannot be silently
credited to the full-AOT release gate.

## AOT link-closure hardening

A native Cranelift `.o` / LLVM object file is useful **guest AOT object**
evidence, but does not qualify the full AOT release gate. The stricter
validator demands `artifact_kind=standalone_guest_executable` and a linked
guest entrypoint execution receipt for ELF/Mach-O/PE targets; the Wasm backend
must instead report `closed_guest_wasm_module`. Both paths still require
independent verification and do not obtain a release PASS from JSON alone.
Cranelift #83 currently implements the scalar object step only.
