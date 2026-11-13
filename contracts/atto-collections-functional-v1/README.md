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
- No reentrant mutation of source while callbacks run is proven safe yet.
- Java currently lowers Array, List and homogeneous Vector to list-like type.
  Java evaluator allocates Array and List; Vector outputs use Array backing.
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
- Callback reentrancy can invalidate read bounds or iteration assumptions.
  The source captures entry-time size, but a compiler/runtime guard against
  concurrent/reentrant input mutation still needs ownership proof.

Source presence, static checks and host-only tests are not runtime parity.
