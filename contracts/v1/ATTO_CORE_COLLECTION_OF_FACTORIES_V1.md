# Core collection `Type.of` contract v1

**Status: TARGET CONTRACT / NOT FIVE-BACKEND EXECUTED.** This does not
certify parser, type-checker, ownership, guest runtime, Native AOT, or
cross-backend behavior. **Updated 2026-11-15:** `~` is exclusively
structural shorthand; it is not an aggregate constructor. The
authoritative design change is atto-lang/atto-spec#38.

## Factory registry

| Canonical constructor | Result and identity |
| --- | --- |
| `Map.of(k => v, ...)` | canonical typed Map<K,V> |
| `Entry.of(k, v)` | Entry<K,V>; no implicit structural record |
| `Pair.of(a,b)` | declared Pair<A,B> or explicitly declared transparent alias |
| `Tuple.of(a,...)` | exact positional Tuple[A,...] |
| `Array.of(a,...)` | owning Array[T] |
| `List.of(a,...)` | List[T], not an unreviewed Array alias |
| `Vector.of(a,...)` | Vector[T], preserving sequence shape |
| `Set.of(a,...)` | Set[T], unique under its reviewed equality domain |
| `Record.of(a: x,...)` | closed readonly record |

All of `~map(...)`, `~entry(...)`, `~pair(...)`,
`~tuple(...)`, `~array(...)`, `~list(...)`,
`~vector(...)`, `~set(...)`, and `~record(...)` MUST be rejected
as collection constructors. No compatibility alias, implicit
desugaring, or auto-rewrite during evaluation is allowed.
This also applies to generic forms such as `~map<K,V>(...)`,
to `~<T>()` and `~()`, and to other collection aliases such as
`~slice(...)`, `~fixed_array(...)`, and `~fixed_list(...)`.
The old type-position `~tuple<A,B>` / `~map<K,V>` nominal aliases
are also withdrawn. `~Point` still denotes `structural Point`
in type, parameter, constraint, and pattern contexts; any `~`
type syntax is structural, never shorthand for nominal Map/Tuple.

No implicit `Map.of`/host Java `java.util.Map.of` bridge or dynamic
runtime member dispatch. Name resolution must bind the compiler-known
factory and type identity before constructing the result. A backend
without that implementation must reject the guest program with a clear
compile-time unsupported diagnostic.

## Type witnesses, ambiguity, evaluation

* `Type.of<T,...>(values...)` may specialize only declared type formals;
  TypeChecker and OwnershipChecker must independently validate the
  same canonical witness. `Map.of<K,V>()` is an explicit typed empty
  Map; `Map.of()` requires a direct, fully proved expected Map<K,V>
  binding, never an inferred dynamic `Any`.
* `Map.of` uses `=>` between evaluated keys and values;
  `Record.of` uses `:` with static field names. Do not conflate
  `Map<Symbol,...>` and `Map<String,...>`, or automatically coerce
  a Symbol into a String.
* Constructed Map entries are evaluated exactly once left-to-right,
  preflight domain/quota/ownership before publishing storage, and
  atomically reject duplicate *logical keys*. Effects of guest
  expressions are not rolled back. Set uniqueness must use its
  type-approved equality contract, not host JavaScript object keys.
* `Entry` is not automatically a readonly `record{key,value}` nor
  a two-slot Tuple. `Pair` uses whichever declared nominal type or
  transparent alias is actually resolved; no implicit Pair=Entry
  or Pair=Tuple identity. All actor transport, ownership, borrow,
  move-only and readonly projections are inherited from the real type.
* Empty, mixed-type, nested and generic forms are allowed only when
  the canonical target type has a proven representation and constraints;
  no allocator-dependent collection may be placed in freestanding
  allocator-free core by a mere `of` spelling.

## No syntax regression

Keep `[a,b]` as an array expression, `(a,b)` as a tuple,
`tuple{a,b}`, and the existing `Array[T]`, `List[T]`,
`Vector[T]`, `Tuple[A,B]`, `FixedArray[N of T]`,
`Vector[...(T,U)]`, shaped/repeating bracket forms, and generic
metadata channels. Preserve structural `~T` type checks and
`on is ~Point` patterns as well as pre-existing independent
unary `~` where supported.

## Backend admission checklist

For Java/GraalVM, LLVM, Wasm, Forge, .NET NativeAOT, Cranelift, JS,
Rust and HDL profiles: (1) check actual source capability, (2) implement
real Type.of factory lowering or fail closed, (3) reject old tilde
constructor aliases without breaking structural typing, (4) type and
ownership positive/negative compile, (5) compile and execute guest
fixture, (6) prove AOT/actor/symbol/duplicate domain where applicable,
(7) independently record exact source commit, carrier/source tree
identity, stepful runner evidence and test counts.

The companion manifest is a list of **candidate source expectations**,
not a compiler invocation or an execution receipt. Its source-only
validator cannot promote any backend to verified.
