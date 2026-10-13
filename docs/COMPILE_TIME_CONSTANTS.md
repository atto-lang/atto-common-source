# Compile-time constants and inert imports — proposed Oreslang contract

Status: **proposed; not implemented or proven on either Java/GraalVM or native LLVM**.
Tracking: [common-source #23](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/23), Java [#860](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/860), LLVM [#341](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/341).

## 1. Import safety invariant

Importing/linking a file, package, or module is **inert with respect to guest user code**.
Import resolution MUST NOT call `init()`, constructors, module initializer expressions,
actor lifecycle hooks, user functions, user-defined operators, host Java `<clinit>`,
foreign code or I/O. Merely accessing a public compile-time constant also MUST NOT
trigger initialization. Loading constant data/relocations and metadata is permitted,
provided those operations do not invoke user code. The entrypoint/explicit runtime
call path remains separate from import and constant lookup.

Circular file/module imports are allowed. The compiler resolves all exported signatures
and constant-dependency edges before publishing the linked program. Import cycles
do not imply constant-dependency cycles. A strongly connected component in the
**constant dependency** graph is rejected if it contains a cycle; diagnostic must
show the entire dependency path. A failed constant evaluation never publishes
partial exports.

The existing Java `docs/LANGUAGE.md` currently describes eager imported `init()`
execution; that prose and runtime behavior conflict with this contract.
A separate lazy-initialization effort (Java draft PR #857) must preserve first-use
startup semantics for executable code without making constant lookup a startup event.
Runtime `val`/`let` module storage is not implicitly upgraded to `const`.

## 2. Surface syntax

```ores
// File root, export optional. Accepted compatibility spelling: pub const ...;
define pub const String s = "foo";
define pub const int x = 42;

define pub module Z as
    pub const int a = 123;
    pub const String b = "bbb";
    pub const Symbol sym1 = #zzz;
    pub const Symbol sym2 = Symbol.for("abc");
end
```

`define` is optional on constant declarations. Where present, canonical order is
`define pub const`, even if `pub define const` is accepted by the parser.
Default is private. `define pub module` publicly exports the *module name*;
it does not implicitly export non-`pub` members. File-level declarations belong
to a file-root namespace with the normal package visibility rules.

`String` is the canonical existing Oreslang spelling; supporting lowercase
`string` is a separate alias/formatter decision, never a way to silently coerce
a String to int. `const int x = "bar"` is a compile-time type error.

## 2a. Symbol literals in match arms and switch cases

Source dispatch must be explicitly qualified: `return match`/`return switch`
for value-returning arms and `do match`/`do switch` for procedural
control flow. The same distinction applies to `return select` and
blocking `do select`; bare statement forms are not legal. An arm's
`return` in procedural `do` dispatch returns from the enclosing
function, never silently discards a value. Standalone dynamic select
results must be returned or bound to a variable.

Both equality-based `switch` and exhaustiveness-checked `match` must
understand first-class `Symbol` literals, including quoted hash symbols:

```ores
define pub const Symbol connected = Symbol.for("connected");

pub fnc describe(Symbol event): String {
    return match event over
        on #connected -> { return "connected"; }
        on #'needs attention' -> { return "attention"; }
        on _ -> { return "other"; }
    end
}

pub fnc code(Symbol event): int {
    return switch event
        case #connected -> { return 1; }
        case #'needs attention' -> { return 2; }
        default -> { return 0; }
    end
}
```

- `#connected` and statically folded global `Symbol.for("connected")`
  denote equal **global process Symbols**, irrespective of allocation/pooling.
  Symbol equality is canonical logical identity, not String comparison.
- A `#connected` pattern never matches `"connected"`, and no implicit
  `String`/Symbol conversion is permitted in `switch`.
- Literal `match` arms use the same Symbol identity/equality rules as
  `switch`. Duplicate or subsumed **unguarded** arms are rejected as
  unreachable; duplicate `switch` cases are rejected.
- `Symbol` is an open domain. A `match` limited to finitely many literal
  Symbols is not exhaustive without a guaranteed fallback or type proof.
  Guards do not establish exhaustiveness.
- Across actors, supervisors, isolates and code generations, Symbol values
  must transport canonical logical identity; never use process-local pointer
  or registry handle equality. Panic/control/error metadata remains separate
  from ordinary status Symbol messages.
- A future scoped `define symbol #name` is a distinct versioned identity
  contract and must not silently become equal to a global `#name` literal.

The Java lexer/parser already has first-stage `SYMBOL_LITERAL` support;
executable regression coverage is added on Java draft PR #892. Native LLVM
matching and wire-format parity are release gates, **not claimed complete**.

## 3. Const-evaluation admission

For a **file/module-level** `const`, accept only expressions in a deterministic,
closed, side-effect-free compile-time evaluator: typed numeric/bool/String/Symbol
literals, references to other proven compile-time constants, checked finite
arithmetic/boolean/string operations, conditionals with constant predicates,
and optionally finite, recursively immutable tuples/records/arrays whose
layout and contents have an explicitly supported constant ABI.

Do **not** evaluate arbitrary Oreslang `fnc` calls at compile time, even if marked
`pure`; do not call constructors, foreign functions, reflection, environment,
clocks, random, I/O, actor methods, async/await or custom operators. Disallow
unbounded recursion and enforce step, AST depth, aggregate-element and byte quotas.
Division by zero, overflow under the declared integer type, invalid Unicode,
unknown names and type mismatch are compile-time errors, not deferred traps.

`Symbol.for("abc")` with a compiler-proven constant String argument is a
**whitelisted intrinsic**, lowered to the canonical global process-Symbol
identity without invoking a runtime registry during import. It does not pick
up a private `#abc` shadowing binding. `Symbol.for(runtimeName)` is not a
permitted `const` initializer. Symbol identity/visibility and safe actor transport
must conform to the versioned Symbols contract (common-source PR #22); do not
implicitly convert Symbol and String.

The compiler may intern/fold constant values as an optimization, but observable
equality/identity must never depend on allocation address or process registry slot.
Native fast paths can inline scalar values, whereas String and aggregate access
must preserve immutable ownership and cannot promise universal zero allocation.

## 4. Linking, exports, and hot reload

All compile-time constants are resolved in a deterministic graph, independent
of file order and import traversal order. Non-private exports are included in
module/file ABI metadata with type, canonical serialized value and visibility.
Incremental builds must invalidate inlining clients on public constant **value**
changes even when the type does not change. Hot reload cannot mutate constants
in a live code generation in place: new generations receive new immutable
constant tables while existing actors retain their original snapshot.

Private members remain inaccessible outside their lexical visibility domain
even if the underlying constant bytes are present in the same executable.
Imports and circular resolution must not bypass module or package access checks.
An imported `const` is never secretly a runtime getter/initializer call.

## 5. Cross-backend release gates

1. Exact same source compiles under Java/GraalVM and native LLVM; import does
   not execute a sentinel `init()`/constructor/actor startup/host `<clinit>`.
2. Module and file-level exported/private constant syntax, format/parse/format
   idempotence, canonical `define pub` order, explicit type errors.
3. Symbol literal and constant intrinsic equality, safe global/scoped identity,
   no guest runtime function/registry call on constant lookup.
4. Constant reference DAG and cycles across legal circular imports; failed
   evaluation never publishes a half-initialized module.
5. Compound immutable values, quotas and adversarial inputs; explicit diagnostics.
6. ABI digest and hot-reload invalidation on changed *value*, not only type.
7. Full source execution tests, native AOT/sanitizers and Graal Native Image
   where applicable. Host-only model tests must never be reported as backend
   conformance.

This document is a proposed specification. Existing implementations must fail
closed on unsupported forms rather than interpreting them as runtime initialization.
