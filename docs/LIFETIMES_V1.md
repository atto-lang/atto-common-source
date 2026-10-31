# Lifetimes v1 — owner/borrow relationships and native zero-GC admission

**Status: normative proposed cross-backend safety contract, NOT compiler
implementation or a hard-real-time certificate.** Apply to Java/GraalVM,
LLVM, .NET Native AOT, WASM and Forge independently. This extends, rather
than replaces, [ownership boundaries](OWNERSHIP_BOUNDARY_AUDIT.md) and
[memory safety/performance](MEMORY_SAFETY_AND_PERFORMANCE.md).

## Language direction

Oreslang values own their storage by default; there is no public `owned`
keyword. A lifetime is a compiler-verified **outlives relation**, not a
wall-clock timeout or a reference count. Safe source must never rely on a
tracing collector to keep an otherwise dangling borrowed address alive.

- Local lifetimes are **inferred and nonlexical**: a loan ends after its last
  valid use or the compiler-issued release, subject to cleanup requirements.
- `borrow T` and `borrow mut T` distinguish shared and exclusive loans.
  Canonical operations remain `rt borrow`, `rt borrow mut`, `rt take`,
  `rt copy`, `rt share`. No public Rust `&T` or `'a` syntax is required.
- API signatures may need a named relation between an input owner and a
  borrowed output, and between several input borrows. Preserve named
  **lifetime variables and outlives constraints in typed HIR/MIR**, even when
  source lifetimes are inferred. Do not silently return a borrowed result when
  there are multiple possible origins; fail closed pending a verified signature
  contract or an explicitly reviewed annotation syntax.
- Lifetimes are independent from mutability, synchronization, actor ID,
  thread/carrier ID, and allocation strategy. A correct scope check alone
  is not a proof of data-race freedom.
- A move or `rt take` transfers unique ownership, invalidating the old
  place and any incompatible loans. Projected fields need field-sensitive
  initialization, partial-move, alias and destruction tracking.
- A borrowed value may not escape into a global, ordinary heap object,
  callback, `Future`, actor mailbox, network transport or longer-lived
  closure merely because the destination is managed by a runtime.

## Typed compiler proof

Each tracked place needs (at minimum): type, owner, allocation region,
generation/epoch when applicable, projection/alias identity, initialization
state, live shared/exclusive loans, and bounded cleanup obligations.
Each loan needs a unique compiler-issued provenance token and a relation to
its owner. At a CFG join, **different loan histories must not be merged into
a forged proof of release**. Loops and exceptional/cancellation edges are
part of the same verifier.

Required MIR events: `alloc`, `borrow_shared`, `borrow_exclusive`,
`reborrow`, `release`, `move`, `drop`, `region_exit`,
`task_admit`, `suspend`, `resume`, `cancel`, `actor_stop`,
`ffi_enter` and `ffi_complete`. Events are **internal typed IR**;
these spellings are not proposed Oreslang syntax.

At any `suspend`/blocking/select/yield/cooperate boundary, either:

1. No loan is live across the boundary, **or**
2. Trusted compiler lowering proves that owner and loan reside in the
   same pinned, generation-fenced continuation frame, cannot move or drop
   before the suspended operation physically retires, and have exact-once
   teardown on every terminal path.

Until option 2 is implemented and executable on a backend, reject the
operation; a boolean 'pinned' assertion or a logical Future completion is
not a proof. Inside a sealed `handle_state(critical-read/write)` callback,
the critical loan remains nonsuspending; no general pinned-frame exception
is silently allowed.

For scoped child Tasks that retain a borrow, the parent scope must drain
**physical** Task execution plus cancellation cleanup and any FFI callbacks
before releasing the borrowed owner. Actor resource reclamation must wait
for all descendant/task/loan epochs to retire, not just a STOP flag.

## LLVM native zero tracing collector profile

- Use registers/stack and inline `Copy` data first, then explicit scoped,
  task, actor or owned graph arenas; no default heap boxing per scalar.
- No tracing GC/runtime, managed-heap fallback, hidden collector safepoints
  or collector ABI in the linked native guest execution path.
- Cyclic graphs are allowed **inside one arena** when the arena owns
  reclamation and internal references are nonowning/generation checked.
- All exits deterministically run drop glue; actor arenas are zeroized and
  freed **after physical quiescence**. No leaked pin or stale generation may
  turn a destruction race into use-after-free.
- FFI and linked libraries must be audited transitively. Native `malloc`
  is not itself a tracing GC, but allocation/copy/synchronization and
  page-fault budgets are separate hard-real-time obligations.
- Java/Graal's host GC may remain enabled. The shared requirement is
  safe guest ownership and deterministic resource closure, **not** an
  untrue claim of zero JVM collection.

## Conformance scenarios (same source, backend-specific observations)

| ID | Scenario | Required result |
| --- | --- | --- |
| L01 | Two shared borrows, read-only use | Admit |
| L02 | Exclusive loan overlaps shared loan | Reject |
| L03 | Two exclusive loans to same place | Reject |
| L04 | Move/drop owner while any loan lives | Reject |
| L05 | Use source after `rt take` | Reject |
| L06 | Return a borrow into a local that will drop | Reject |
| L07 | Return borrow tied to input with proven outlives relation | Admit only with proof |
| L08 | Return a borrow ambiguously tied to two inputs | Reject until resolved |
| L09 | Borrow project field; mutate overlapping whole object | Reject |
| L10 | Disjoint proven field borrows with nonoverlap | Admit |
| L11 | Lexical borrow live across `await` without pin | Reject |
| L12 | Fully released borrow before `await` | Admit |
| L13 | Region-backed loan crosses `select` without pin | Reject |
| L14 | Pinned frame borrow across suspension | Admit only with physical proof |
| L15 | Scoped child task captures borrow, scope closes early | Reject |
| L16 | Scoped Task cancellation cleanup drains before owner drop | Admit only with physical proof |
| L17 | Critical actor-state loan suspends | Reject |
| L18 | Actor STOP with live loan or FFI callback | Defer physical reclaim |
| L19 | Malformed/stale generation, wrong actor, replayed loan | Reject |
| L20 | Internal cyclic graph inside owned arena, no escaping handles | Reclaim at arena retirement |
| L21 | Unbounded/unknown external allocation in strict hard-RT entry | Reject without trusted budget |
| L22 | LLVM linked guest binary requires tracing collector | Fail zero-GC profile |

Evidence must distinguish parser admission, typed-HIR/CFG proof, native
compiler emission, linked execution, runtime physical quiescence, sanitizer
results, allocation/latency measurements and cross-backend differential tests.
A host-only C/C++/Rust model or zero-step CI run cannot promote an unexecuted
source fixture. Each result needs exact source/commit identities.

First LLVM implementation slice: [stacked draft PR #1226](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1226)
adds a fail-closed suspension event and direct CFG loan-state hardening;
source `await/select` lowering and pinned-frame positive execution are still
missing. Do not count this as lifetime feature parity.
