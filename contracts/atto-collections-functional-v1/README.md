# Native Atto collection combinators v1

Status: Source authored; compiler and cross-backend execution **not yet verified**.
Canonical guest source: `library/ores.core/collections.atto`.

## Public API
Each collection has native functions `map_array`, `filter_array`, `reduce_array`
(also `_vector` and `_list`). Signatures:
`map_array<T,U>(Array<T>, Fnc<U(T)>): Array<U>`;
`filter_array<T>(Array<T>, Fnc<bool(T)>): Array<T>`;
`reduce_array<T,Acc>(Array<T>, Acc, Fnc<Acc(Acc,T)>): Acc`.
Corresponding Vector/List functions return their source collection kind.
The canonical algorithms are free native .atto functions. Java/Graal also has a
draft member-call adapter in oreslang-source.java PR #3052:
`values.map(callback)`, `values.filter(predicate)`, and
`values.reduce(seed, reducer)` for Array, Vector, and List. The receiver is
passed into the same native .atto functions; the host runtime must not
implement the algorithms itself. This is syntactic method sugar, **not** yet
a public extension-method/trait declaration in native .atto. LLVM and .NET
must implement equivalent source-to-native lowering independently.

## Semantics
- Traverse indexes 0..size-1; preserve order and do not mutate inputs.
- map invokes transform once per item, returns a fresh sequence.
- filter invokes predicate once per item, preserves order among kept values.
- reduce is a left fold with explicit seed, returns seed on empty input.
- Empty input invokes no callback. All callbacks execute synchronously.
- Callback failures propagate and partial output must not escape.
- No host-language collection helper, scheduling, hidden I/O or suspension.

## Release blockers
- Generic Copy/borrow/move bounds and effect tracking must be enforced
  by compilers, not comments. Current signatures do not prove Copy safety.
- The Java draft adds a nonparking read-loan admission guard for guest
  Array/List/Vector storage: writers during map/filter/reduce fail immediately
  and the read loan retires through finally, including callback failure.
  This is authored code and must still pass race/guest execution tests.
- Java resolves homogeneous Array, List and Vector to a common ListType at
  static typing time. The draft runtime uses a source-constructor kind marker
  and selects the matching native .atto implementation; this does not yet
  establish distinct physical layouts or fully nominal literal typing.
- LLVM embeds core source in C++; .NET still has legacy .ores core files.
  Both require independently registered .atto source and native guest proofs.
- Prove empty, singleton, callback order/counts, non-associative reduce,
  mutability, error cleanup, ownership negatives, cross-type map,
  allocation failure, and exact-tree Java/Graal/LLVM/.NET executions.
- Member syntax is authored for the Java compiler but is NOT CI/guest parity
  certified; method calls must be direct until higher-order generic method
  extraction is proven safe.
- Slice/FixedArray/FixedList/Tuple variants require shape-preserving semantics
  or explicit dynamic result types; do not treat these as generic List aliases.
- Callback reentrancy is allowed only for read-only nested reads. All
  source mutation must be denied while a read loan is active. Literal
  constructors and callback ownership across actor/tenant boundaries need
  independent review and backend-native proofs.
- The Java source registry and byte-identical .atto file do not constitute a
  signed exact-tree guest receipt. Private source mirroring must obey the
  target repository's CI transfer-authorization policy.

Source presence, static checks and host-only tests are not runtime parity.

## Empty input and left-fold regression (source-only)

`positive/member-methods-empty-fold-order.atto` exercises Array, Vector and List member adapters: empty map/filter, empty reduction with seed 7, ordered non-associative fold with seed 4 and input [1,2,3] (4123), all/none filters, retained order and input size preservation. Expected exit 42, no stdout; distinct failure exits identify kind and property. Blob `ae00212e1e09bf73d3a9b7bb7f1987f1ffeb8ea1`. This does not count callback invocations, verify cleanup, or prove ownership; those remain separate gates. No compiled guest receipt yet.

## Canonical library migration gate

The November 22 [core/alloc/std contract](https://github.com/atto-lang/atto-spec/blob/main/language/core-alloc-std-libraries-v1.md) supersedes the historical layer name: growable Array/List/Vector and their allocating combinators belong to alloc, not freestanding heap-free core. Treat `ores.core/collections` as a legacy migration adapter only. Before canonical publication, register an alloc-layer module with explicit allocator-provider dependency, reconcile #90 and #30/#150, preserve byte-identical source between backend registries where applicable, reject core-to-alloc transitive dependencies, and retain read-loan/cleanup guarantees. Do not silently reclassify the historical module or claim it is freestanding core. The new fixture intentionally targets the staged legacy member syntax, not the future canonical module selector.
