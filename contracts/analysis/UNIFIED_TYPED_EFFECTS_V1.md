# Unified typed effect summaries v1

**Status: versioned candidate for compiler-owned typed IR exchange. Not guest or hard-real-time certification.**

This envelope describes a *closed-world, typed* call graph with per-function effects, optional declared upper bounds, call activation phases, and work classification. The JSON Schema restricts structure; `unified_typed_effects_v1.py` provides additional fail-closed semantic validation and transitive fixed-point inference over the **caller-supplied** graph. This is additive to the existing v1 exceptional-effect contracts and [atto-platform-conformance unified-effects v2](https://github.com/atto-lang/atto-platform-conformance/pull/560).

The binary producer must derive the report **after** parsing, type checking, ownership/binding, macro expansion, and resolution of dynamic targets. Import/FFI/callback/destructor/continuation effects may be summarized only using authenticated, pinned link/ABI metadata. Unresolved targets, unverified cost proofs and unknown cleanup must not be presented as an empty row. This reference tool **cannot authenticate** that the producer told the truth: all source and revision hashes are untrusted identity **claims**, not signatures or certificates.

## Model fields

- `kind: attolang.typed-effects/v1` and `assurance: COMPILER_TYPED_IR_OBSERVATION_NOT_RUNTIME_CERTIFICATION` are mandatory.
- `direct_effects` are local *may*-effects; `declared_bound: null` means infer, `[]` means a checked explicit empty upper bound. A coarse `io` bound accepts `io.*` but still provides **no resource permission**.
- `calls` contains `kind: direct | sealed_dynamic | unknown`, an exhaustive and already-resolved target list, and an execution phase. Latent/cleanup effects are conservatively included unless a verified independent call-activation proof proves otherwise; this model cannot certify inactivity.
- `closure: complete` is a producer claim, not a trusted provenance bit. `unknown` and an unresolved target reject the source-free model. External library, FFI, generator, actor lifecycle and destructor graph coverage is required before strict admission.
- `work: bounded_claim` is *not* WCET or stack proof. `hard_rt_screen` is a conservative source-free compatibility screen, not a hard-RT certified profile. Bounded recursion or OS/interrupt/allocator behavior requires independent target-specific evidence.
- `io.clock`, `io.entropy`, `io.env`, `io.file.read` imply `nondet` by default. Pinned external immutable resources may eventually have a separately reviewed declassification proof but must not evade this initial contract.
- `pure`, `deterministic`, `no_alloc`, and `hard_rt_screen` are distinct reference checks. The native compiler must enforce authority/ownership independently and preserve **full guest AOT**: no runtime guest interpreter/JIT/reflection or fallback.

## Source-free validation

```sh
python3 -m unittest discover -s contracts/analysis/tests -p 'test_unified_typed_effects_v1.py' -v
python3 contracts/analysis/unified_typed_effects_v1.py contracts/analysis/fixtures/unified-typed-effects-v1-pure.json --profile pure --profile no_alloc
```

Exit `0` means compatible **only with supplied untrusted graph claims**, `2` a profile incompatibility, `3` malformed/incomplete source-free input. A successful result is not a static compiler guarantee and never authorizes permissions, sandbox escape, runtime deployment, hard-RT admission or release.

## Compiler integration in progress

- [AttoLang grammar/spec target](https://github.com/atto-lang/atto-spec/pull/205)
- [Reference conformance v2](https://github.com/atto-lang/atto-platform-conformance/pull/560)
- Java: `OresCompiler.analyzeEffectProfileV1` uses the real parser, TypeChecker and OwnershipChecker, then narrow checked-AST closed-scalar inference; unsupported class/FFI/actor shapes fail closed.
- LLVM: `atto-llvm ... --effect-check=pure|deterministic|no-alloc` uses a compiler-checked typed IR, traverses the call graph, then optionally emits native LLVM IR. It currently does not expose/export this interchange schema and neither compiler provides a full `io.clock` typed provider.
- **Remaining:** emit this contract from both compilers, match source/typed-IR digests, add feature-specific .atto guest fixture success/reject evidence, prove backend/runtime closure, execute independent JDK25/Cargo/LLVM/AOT tests on exact source heads and all additional backends.

Never report host-only tests, a zero-step Action, an unverified alternate-org mirror, or a generic unsupported-parser rejection as successful backend parity.
