# Core collection `Type.of` and `~kind` contract v1

**Status: TARGET CONTRACT / NOT FIVE-BACKEND EXECUTED.** This does not
certify parser, type-checker, ownership, guest runtime, Native AOT, or
cross-backend behavior. It extends rather than replaces the tilde-map/record
contract in common-source draft #254.

## Factory registry

| Canonical | Shorthand | Result and identity |
| --- | --- | --- |
| `Map.of(k => v, ...)` | `~map(k => v, ...)` | canonical typed Map<K,V> |
| `Entry.of(k, v)` | `~entry(k, v)` | Entry<K,V>; no implicit structural record |
| `Pair.of(a,b)` | `~pair(a,b)` | declared Pair<A,B> or explicitly declared transparent alias |
| `Tuple.of(a,...)` | `~tuple(a,...)` | exact positional Tuple[A,...] |
| `Array.of(a,...)` | `~array(a,...)` | owning Array[T] |
| `List.of(a,...)` | `~list(a,...)` | List[T], not an unreviewed Array alias |
| `Vector.of(a,...)` | `~vector(a,...)` | Vector[T], preserving sequence shape |
| `Set.of(a,...)` | `~set(a,...)` | Set[T], unique under its reviewed equality domain |
| `Record.of(a: x,...)` | `~record(a: x,...)` | closed readonly record |

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
* `~<T>()` is the explicit typed empty aggregate channel wherever
  independently implemented. Unqualified `~()` is always ambiguous.
* `Map.of` and `~map` use `=>` between evaluated keys and values,
  while `Record.of` and `~record` use `:` with static field names.
  Do not conflate `Map<Symbol,...>` and `Map<String,...>`, or
  automatically coerce a Symbol into a String.
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
`tuple{a,b}`, and existing `~tuple`, `~map`, `~record`,
`Array[T]`, `List[T]`, `Vector[T]`, `Tuple[A,B]`,
`FixedArray[N of T]`, `Vector[...(T,U)]`, shaped/repeating
bracket forms, and generic metadata channels. Tilde-prefixed
type-position aliases such as `~tuple<A,B>` are additive and must
preserve these existing forms.

## Backend admission checklist

For Java/GraalVM, LLVM, Wasm, Forge, .NET NativeAOT, Cranelift, JS,
Rust and HDL profiles: (1) check actual source capability, (2) implement
real Type.of factory lowering or fail closed, (3) type and ownership
positive/negative compile, (4) compile and execute guest fixture,
(5) prove AOT/actor/symbol/duplicate domain where applicable and
preserve prior grammar, (6) independently record exact source commit,
carrier/source tree identity, stepful runner evidence and test counts.

The companion manifest is a list of **candidate source expectations**,
not a compiler invocation or an execution receipt. Its source-only
validator cannot promote any backend to verified.
