# Ownership boundaries: audit and admission contract

Status (2026-10-12): required safety checks with backend-specific admission.
This is not a claim of complete lifetime analysis or cross-backend parity.

## Borrow and suspension boundaries

A synchronous call's temporary receiver and argument loans remain live until
all arguments have evaluated and the call completes. Nested evaluation of a
later argument cannot move, mutate incompatibly, or suspend with an earlier
loan active. Check a suspending callee at invocation, after argument loans have
been acquired, as well as checking any pre-existing loans before evaluation.
Apply this rule to direct, qualified, static, instance and first-class calls.

An `async`/generator activation must own its retained values, or have a proven
outlives/continuation contract. A call-site lexical borrow is insufficient.
A newly constructed borrowed yield/result is subject to the same no-escape
rules as a stored borrowed local. Runtime-managed reachability does not grant
ownership or mutable access.

Blocking `await`, channel operations and select without a default are
suspension boundaries. Immediate select and blocking select with a default do
not inherently suspend; operands and arm bodies can still contain independent
suspending operations. Deferred nonblocking callbacks must own/copy/share their
captures; registering a callback does not extend an ordinary lexical borrow.

A sealed critical `handle_state` callback retains its actor-state loan until
callback exit. It cannot cooperate, await, or block on channel/select operations
while the loan is live. Releasing a carrier does not prove the state loan safe.
This synchronous restriction applies to explicit critical callbacks and any
serial-actor implicit critical admission. More general logical-ticket critical
scopes require separate continuation, cancellation and ownership proofs.

## Runtime ownership operations

| Operation | Required admission |
| --- | --- |
| `rt borrow` / `rt borrow mut` | Rooted shared/exclusive loan; no ownership upgrade, untracked escape or suspension |
| `rt take` | Transfer a live owner; reject borrowed inputs and conflicting loans; projected move-only extraction needs place/partial-move/drop tracking |
| `rt copy` | Primitive/Copy behavior or a verified copy protocol; no shallow mutable alias disguised as a new owner |
| `rt share` | Existing safe Copy handle or a verified owning shared capability; no manufacturing of shared mutable aliases |

Java/Graal main currently fails closed for move-only `rt copy` and `rt share`.
This audit does not invent their missing protocol/shared-handle implementations.
LLVM's admitted native scalar and bounded class subset has separate place/drop
tracking. Unsupported forms must fail without emitting executable IR.

## `owned`, `using` and `critical`

Ownership is implicit for by-value source bindings. `owned` remains an ordinary
identifier; it is not a public storage/type keyword. LLVM's experimental
`owned int` qualifier requires its explicit test flag and is not public parity.
See [ownership syntax](OWNERSHIP_SYNTAX.md).

`using` is an upper bound on observable effects. `requires no_alloc/no_block`
is an independent guarantee and must be verified even without a `using`
clause. Aggregate and escaping closure construction contribute allocation;
constructing a closure does not execute its body. Unknown calls cannot establish
these guarantees without trusted summaries. Source-level effect admission does
not certify physical allocation rates or worst-case execution time.

`critical` grants only its specified scoped state/scheduler authority. It does
not grant copyability, escape permission, or suspension-safe lifetimes.

## Release evidence

Require positive and negative tests for loans spanning later arguments,
suspending call invocation, yielded borrows, selected/deferred captures,
projected takes, and requirements without an effect clause. Record exact backend
commits and fixture identities. Separate unsupported admission, executed guest
behavior, host-only tests and toolchain failures. Pending feature branches must
not be described as behavior already shipped on main.

The organization currently has independent Java/Graal and LLVM checkers; the
common-source and platform-conformance repositories define contracts and harnesses.
A pass in one implementation does not establish the other's safety.
