# Callable body and return-type syntax v1

Status: shared source-language contract for staged backend adoption. This document does not by itself establish executable parity.

## Goals

Oreslang supports a keyword-delimited body for ordinary free/module callables without making indentation semantic or silently broadening class/actor method syntax.

Canonical example:

```ores
fnc classify(int x) -> int
    if x > 0 then
        return 1
    else
        return 0
    fi
end
```

The closing delimiter for a conditional remains `fi`; the callable owns the outer `end`.

## Admission matrix

| Declaration domain | Braced implementation | `-> Type ... end` implementation | Signature `-> Type;` |
| --- | --- | --- | --- |
| file/root `fnc` / `routine` | yes | yes | n/a |
| module `fnc` / `routine` | yes | yes | n/a |
| class instance method | yes | no in v1 | n/a |
| class `static fnc` implementation | yes | no in v1 | n/a |
| actor callable/method | yes where otherwise supported | no in v1 | n/a |
| instance interface/trait requirement | n/a | n/a | no; keep type-level `=>` |
| module contract requirement | n/a | n/a | yes |
| static-class contract requirement | n/a | n/a | yes |

A backend must not infer permission from a shared AST shape. Declaration domain remains part of source admission.

## End-delimited callable header

The v1 form requires an explicit slim-arrow return type:

```ores
fnc log() -> void
    stdio.out.write("hello\n")
end
```

These are invalid v1 spellings:

```ores
fnc log()
    ...
end

fnc value(): int
    ...
end

fnc value(): int as
    ...
end

fnc value() -> int do
    ...
end
```

Without an explicit body separator, the first body token must begin on a later
source line than the completed return type. An optional semantics-free `as`
may instead appear immediately after the **complete** `-> ReturnType` **on the
same physical source line**; when present it provides the header/body boundary
and permits compact same-line bodies:

```ores
fnc identity(int x) -> int as return x; end
```

A next-line `as` is not a separator. The word `do` is deliberately **not**
a callable-header separator: header `do` is retired and rejected so every
`do` token remains ordinary executable body syntax. This makes both of these
unambiguous:

```ores
fnc consume(Channel<int> incoming) -> void
    do select {
        case readch incoming: val value {
            return;
        }
    }
end

fnc consume_explicit(Channel<int> incoming) -> void as
    do select {
        case readch incoming: val value {
            return;
        }
    }
end
```

The complete return type is resolved before optional `as`, including
higher-order returns:

```ores
fnc callback() -> () => void as
    return || -> { return; };
end
```

A colon-return callable does not gain this form: `: Type as ... end` remains
invalid. These rules provide a deterministic header/body boundary while
leaving indentation non-semantic.

The existing braced forms remain source-compatible:

```ores
fnc value(): int {
    return 1;
}

fnc value2() -> int {
    return 2;
}
```

An omitted return annotation on the legacy braced form may retain the existing
`void` behavior where the reference frontend permits it. The keyword-delimited
form never relies on that default.

## Frontend normalization

The body spelling and optional `as` separator are concrete syntax, not a semantic callable kind. After source
admission, an end-delimited free/module callable—with or without `as`—should normalize to the same
backend-neutral callable AST/HIR body as its equivalent braced declaration.
Likewise, `tuple (T1, T2, ...)` must normalize to the existing finite tuple
type representation. Optimizers and runtimes must not branch on which accepted
surface spelling the user wrote.

## Statements and layout

Indentation is presentation only. Structural delimiters are authoritative:

- `if ... then / elif ... then / else / fi`;
- `match ... end`, `switch ... end`, and other independently delimited constructs;
- outer callable `end`.

Newlines may terminate statements only according to the ordinary Oreslang lexical statement-boundary rules. The callable feature does not create an indentation-sensitive grammar.

A parser must recursively consume nested construct terminators before allowing the callable parser to consume its own `end`.

## Return completeness

For a declared non-`void` return type, every reachable normal completion path must execute an explicit return carrying a compatible value. Reaching the callable's closing `end` is a compile-time error.

```ores
fnc choose(bool flag) -> int
    if flag then
        return 1
    else
        return 2
    fi
end
```

For `void`, reaching the closing `end` is a valid normal return. An explicit bare `return` remains allowed.

Return completeness is a control-flow property, not a textual "last statement must be return" rule. A backend must account for exhaustive branches and other proven non-fallthrough control flow.

## Return type grammar

The token after `->` is parsed with the ordinary recursive `type_ref` grammar. There is no special return-type scanner.

Examples include:

```ores
fnc a() -> Result<Option<int>, Error>
    ...
end

fnc b() -> tuple (int, int, string)
    ...
end

fnc c() -> Result<Option<tuple (int, string)>, Error>
    ...
end
```

A backend must resolve the complete type before deciding where the body begins.

## Contextual finite tuple type

The explicit type spelling

```ores
tuple (int, int, string)
```

denotes the same finite positional tuple type as the backend's existing finite tuple TypeRef. It does not create a nominal `tuple` class, a second tuple runtime representation, or a dynamically sized product.

Tuple values remain ordinary tuple expressions, for example:

```ores
return (1, x, "positive")
```

The contextual spelling does not introduce a new tuple-specific arity limit. It preserves the existing finite-tuple arity policy of the canonical TypeRef representation; both accepted spellings must behave identically for the same element list.

The word `tuple` is contextual: an ordinary value/function identifier named `tuple` remains legal outside the exact type-position shape `tuple (`.


Interface/trait signature compatibility is intentionally asymmetric: `=> Type` is canonical, legacy `: Type` remains accepted and normalizes identically, while executable `-> Type` remains rejected for instance requirements.

## Contracts and static namespaces

Module contracts and static-class contracts describe namespace/static members rather than instance dispatch. Their callable requirements may therefore use the executable-style return separator:

```ores
define contract ModuleApi as
    coordinates: tuple (int, int, string);
    fnc classify(int x) -> tuple (int, int, string);
end
```

A static-class contract may use the same callable signature/type surface when that contract feature is enabled by the frontend:

```ores
define static contract Factory<T> as
    fnc make(T value) -> T;
end

define class IntFactory implements static Factory<int> as
    pub static fnc make(int value) -> int {
        return value;
    }
end
```

The Java v1 admission is deliberately compile-time-only and callable-only:
public local `static fnc` members satisfy static contracts. Instance methods,
private static functions and inherited static functions do not. Generic
contracts may be specialized by a non-generic class; generic-class static-side
conformance remains fail-closed until its substitution rules are explicit.

Static-class contract conformance is same-source-unit-only in Java v1. The
linked-unit checker does not yet transport interface/contract declarations, so
a static contract must not be made to appear cross-file merely because
`import contract` can name ordinary module contracts. Cross-unit static
contracts require linked contract ABI metadata first.

Instance interfaces and traits continue to use the type-level callable signature separator `=>`. This v1 contract does not change instance method declaration syntax.

**Module contract fields remain supported** and use the same recursive
`type_ref` grammar, including finite tuple types. **Static-class contract
fields are not part of v1**: a frontend must reject them until class static
storage, initialization, ownership and reload semantics are implemented.

## Safety and backend requirements

Before claiming support, a backend must prove:

1. the declaration domain is checked before body-form admission;
2. nested `fi`/`end` ownership is deterministic, optional callable `as` cannot steal body syntax, and `do` remains exclusively executable body syntax;
3. complex return types are parsed through the ordinary type system;
4. non-`void` fallthrough is rejected by CFG analysis;
5. tuple arity/types are checked using the same canonical finite-tuple representation for every spelling, including aggregate return values;
6. unsupported class/actor end bodies fail closed;
7. optimizer/HIR reconstruction cannot erase the declaration-domain restriction;
8. malformed or unsupported syntax emits no partial executable artifact.

A backend without typed tuple/body parity should reject the new source form explicitly before code generation. Rejection parity is preferable to accepting a scalar or braced approximation.

## Machine-readable conformance vectors

`fixtures/callable-syntax-v1.json` pins the finite v1 declaration-domain,
return-flow, and tuple-bound decisions. `tests/test_callable_syntax_v1.py`
is a zero-dependency reference consistency check. It is intentionally not an
Oreslang parser; backend suites should consume the fixture and prove their real
parser/typechecker/codegen behavior against the same decisions.

## Current staged implementation status

- Java/Graal current-main reconciliation: free/module end-delimited bodies, optional same-line semantics-free callable `as`, retired-header-`do` rejection, contextual tuple return type, module-contract arrow signature, and focused type/parser regressions are staged in `oreslang-source.java` PR #1776. It supersedes stale #1634/#1611 for verification purposes.
- Static class callable-contract integration is restacked as the narrow child `oreslang-source.java` PR #1778 on top of #1776; stale #1642/#1612 are not current-parent evidence. V1 remains callable-only and does not imply class-static-field runtime storage.
- Canonical formatter support from `oreslang-format` PR #81 is on formatter `main`; its round-trip fixture is byte-identical to the Java corpus Git blob `c91a244cb99c1aaa74b3abadf9b99d8e1f3aea86`.
- LLVM/native rejection parity is restacked on current native main in `oreslang-source.llvm` PR #786. It carries the same `c91a244cb99c1aaa74b3abadf9b99d8e1f3aea86` corpus as an explicit no-partial-IR rejection fixture and does not claim executable parity.

These references describe staged work, not a release guarantee. Exact-head executable tests remain required before promotion.
