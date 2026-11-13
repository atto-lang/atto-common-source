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
These are free functions today, not `values.map(...)` member methods.

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
- Do not claim member-style map/filter/reduce until separately implemented.

Source presence, static checks and host-only tests are not runtime parity.
