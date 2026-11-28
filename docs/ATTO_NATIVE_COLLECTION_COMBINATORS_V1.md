# AttoLang native collection combinators v1 — staged, not parity-certified

Canonical implementation: \`library/ores.core/collections.atto\`.
Git blob (all staged backend copies): \`c5d6659dda078736cb170d5c1d59fc04e700d023\`.

## Scope

Nine type-preserving/native guest-source operations are defined: \`map_array\`,
\`filter_array\`, \`reduce_array\`, and corresponding \`_vector\` / \`_list\`
operations. The core layer contains only native \`.atto\` code. No Java,
C++, C#, reflection, host collection helper or FFI implements the operations.

- \`map_<kind><T,U>(Kind<T>, Fnc<U(T)>) -> Kind<U>\` returns a new container.
- \`filter_<kind><T>(Kind<T>, Fnc<bool(T)>) -> Kind<T>\` returns a new
  container whose retained elements preserve their original order.
- \`reduce_<kind><T,Acc>(Kind<T>, Acc, Fnc<Acc(Acc,T)>) -> Acc\` performs a
  strict *left* reduction, with an explicit initial value. Empty input returns
  that value without invoking the callback.

All operations capture input size before the loop, traverse from index 0
through \`size - 1\`, and invoke callbacks synchronously, once per visited
element (including dropped elements for \`filter\`). They are eager and
do not mutate the input. \`map\` and \`filter\` allocate fresh output storage.

## Safety and compiler obligations

The source is **not** a proof of generic runtime ownership. A backend MUST
admit only element/accumulator types with a verified copy or single-owner
transfer policy. Mutable aliases, cross-actor pointers, illicit loan escape,
duplicate moves, closures that retain live borrows and callbacks that suspend
or await must fail compilation. A callback's effects are transitive; callbacks
are not automatically pure. Source mutation, including mutation during callback
invocation, requires an explicit approved semantic policy; v1 must reject it.

The collection representation is actor-arena-owned with checked bounds,
capacity arithmetic, allocation failure cleanup, 32-bit offset/generation
validation and deterministic dropping. Never fall back to global GC sharing or
foreign runtime collections in a production backend. The \`ores.core\`
namespace has no OS dependency, but \`map\` and \`filter\` require an admitted
allocator provider: freestanding does not mean allocation-free.

## Cross-backend status (source audit, 2026-11-13)

| Backend | Native \`.atto\` bytes | Trust/registration | Compiled guest parity |
|---|---|---|---|
| Shared core | Canonical | n/a | Requires backends |
| Java/Graal | Staged in core package | Closed \`.atto\` module registry | Authored JUnit execution tests; not yet proven green |
| LLVM | Exact source staged | **Not registered** until generic callable/ownership lowering is safe | Not verified |
| .NET | Exact source staged as snapshot | **Not registered**; existing compiler rejects collections | Not verified |

Source-only hashes, unit tests of host components, and parser-only acceptance
are not substitutes for real native guest execution.

## Required parity matrix

For each of Array, Vector and List on Java/Graal, LLVM and .NET, execute:
identity/change-type \`map\`, all/none/mixed \`filter\`, empty/single/multiple
\`reduce\` with nonzero seed, callback order and count, wrong return type,
wrong argument arity, callback exception, callback suspension rejection,
bounds/overflow, non-Copy ownership and captured mutable loan rejection.
Run the same \`.atto\` fixtures, pin exact compiler tree and source blob,
record emitted artifact SHA and guest exit/stdout, and test LLVM with
ASan/UBSan and .NET with *real* NativeAOT publishing. Source-only stages
may not produce a passing parity badge. Preserve separate runtime and
freestanding allocator-provider capability gates.
