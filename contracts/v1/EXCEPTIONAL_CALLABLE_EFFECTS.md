# Exceptional callable effects v1 — proposal and admission gates

Status: **proposed syntax and analysis contract, not compiler/runtime admission**.
Java and LLVM must not silently accept annotations until typed effects are
preserved through parsing, HIR/MIR, callable signatures and lowering.

## Source spelling

Effect clauses are optional, after parameters and return type, before
the callable body or interface signature terminator:

~~~oreslang
import class Error from "std/error";

pub fnc fetch(id: int) -> User
  throws(NetworkError, DecodeError)
  raises(AuthorizationError)
  panics(InvariantError)
{
  // implementation
}

define class Worker as {
  method handle() -> void throws(Error) raises(Error) {
    // ...
  }
}
~~~

Apply to fnc, static fnc, instance methods, legacy fnc methods,
interface/contract methods and callable types. A bare clause word
(throws, raises, panics) indicates an unknown concrete canonical
std/error.Error subtype; it never permits non-Error operands.
A parenthesized comma-separated list declares finite nominal Error
subclasses. Empty parentheses or duplicated clauses are invalid.
Canonical clause order: throws, raises, panics.

The actual statement keywords remain singular: throw, raise, panic.
Omitted effects are legal for backwards compatibility; they DO NOT
imply no-throw. Unresolved callable effects are unknown, not proven
empty. An explicit audited no-effect contract can be designed later.

## Semantics

| Statement | try/catch | trap | direct defer/recover | actor terminal outcome |
| --- | --- | --- | --- | --- |
| throw Error | matching catch | ordinary throw to None | recoverable | escalated failure with throw origin |
| raise Error | bypasses | bypasses | recoverable in same invocation | escalated failure with raise origin |
| panic Error | bypasses | bypasses | NEVER recoverable | immediate supervisor CONTROL panic |
| cancellation/host fatal | bypasses | bypasses | NEVER recoverable | runtime policy |

A raise crosses nested try/catch/trap; registered defers run LIFO and
only direct recover() inside the currently executing deferred callback
in that logical invocation can consume a pending raise or throw.
Recover does not rewind execution after the failing statement.
Panic performs only bounded runtime cleanup and cannot be consumed by
the failed actor. No actor-local catch, trap or recover intercepts its
supervisor CONTROL event.

Failure precedence: host/process fatal > cancellation > panic > raise
> throw. Record lower-priority cleanup failures as bounded suppressed
metadata. An unhandled throw/raise is promoted to terminal Panic at
the actor boundary while retaining the original effect kind and Error
origin. A source panic goes directly to supervisor CONTROL, separately
from the user mailbox. Supervisor failure delivery is bounded, immutable
and exactly once. Await/carrier migration preserve the logical unwind.

## Effect analysis and tooling

- Preserve separate may-effect sets for throws, raises and panics in
  callable signatures, method dispatch, generics, exported ABI,
  function values, interface/contract implementations and overrides.
  An override must not widen a declared checked effect set.
- Join transitive call effects through overload resolution, dispatch
  alternatives, async continuations and dynamic receivers. Subtract
  only proven locally matched typed throws or proven direct recovery
  of throw/raise. Never subtract actor panic as locally recoverable.
- Warn for missing annotations; diagnose duplicates, empty lists,
  invalid non-Error operands and unsafe overrides. Formatter may
  canonicalize clause order but may not invent a source contract.
- Distinguish an observed local hint from a proven program effect.
  The first Python analyzer (oreslang-test.cli --effects) is advisory
  only: it does not resolve calls, arbitrary bare methods, or escapes.
  Inconclusive must not be reported as a success certificate.
- Keep --race and --fuzz independently executable. Future integration
  must generate exception-control traces and fuzz unwind/suppression/
  supervisor cases, including scheduler races and exactly-once CONTROL.

## Admission stages

1. Shared positive/negative grammar fixtures for all callable variants,
   generics, annotations, comments, duplicates and malformed cases.
2. Nominal Error-only AST/HIR/MIR and typed call-effect propagation.
3. Executed Java and LLVM throw/defer/typed-catch synchronous slice.
4. Raise bypass + direct defer/recover through nested calls and await.
5. Actor panic direct-to-supervisor CONTROL, never locally caught.
6. Identical guest source traces, race/fuzz, forced cancellation,
   nested cleanup, suppression, actor restart and adversarial tests.
7. Full CI, only then lift backend fail-closed gates.

Never coerce String or host Throwable to canonical Error; do not
cross actor ownership/capability boundaries via exceptional payloads.
