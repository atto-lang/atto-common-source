# Oreslang native synchronization v1: core vs stdlib

Status: language/backend conformance contract; **not full compiled guest API parity**.
Java/Graal host locks, pthreads and JVM monitors are implementation details
of optional hosted adapters, never the semantic definition of Oreslang locks.

## Freestanding core (no host OS required)

`core::atomic` provides target-proven acquire/release atomics and bounded,
nonparking `MutexGate`/`RwGate` admission over explicitly owned memory.
`core` must require no Linux, pthreads, JVM, clock, threads, heap allocation,
I/O, scheduler, or libc. Where 32-bit atomics are not always lock-free, the
target must provide an explicitly verified atomic provider or reject this
profile at compile time; never secretly link a spin-based libc shim.

Lock gates are distinct from user-facing `Mutex<T>`:
- `try_acquire`: acquire, busy, invalid or permanently exhausted
- Successful acquisition produces a fresh nonzero generation.
- Release compares the exact active generation, performs release ordering,
  and rejects duplicate/foreign/stale generations.
- Any token ID/writer-wait registration lives behind compiler/runtime
  authority; exposing raw C release functions to untrusted guest source
  bypasses the borrow checker and is forbidden.
- `RwGate` uses a bounded reader count and a writer reservation. Pending
  writers exclude new readers (reader admission must recheck after increment).
  An open reader is paired with exactly one linear read loan at the compiled
  source boundary; core does not expose raw arbitrary reader decrement.
- Once an epoch reaches its maximum, no reset or wraparound is permitted.
  Permanent exhaustion is a deterministic error; destroying a gate requires
  quiescence and invalidation of all capabilities.
- All protected memory accesses must happen between acquire and release.
  Atomics alone do not make unsynchronized payload mutation safe.

## Native stdlib: scheduler-integrated locks

`stdlib::sync` supplies `Mutex<T>`, `RwLock<T>`, `MutexGuard<T>`,
`ReadGuard<T>` and `WriteGuard<T>` as sealed Oreslang types that use the
core gate plus bounded scheduler queues and linear borrows. They must never
use blocking host mutex acquisition on an actor carrier.

Illustrative *target* source API (not currently LLVM source-executable):
the `with_lock` API is a proposed sealed scoped-borrow operation, not an
intrinsic that a guest can implement by calling the raw C release ABI.
`using` belongs on function effect declarations, not as a lock statement.

```ores
val Mutex<int> counter = Mutex.new(0);
counter.with_lock(|value| -> {
    value += 1;
});

val RwLock<Config> config = RwLock.new(initial);
config.with_read(|value| -> {
    inspect(value);
});
config.with_write(|value| -> {
    update(value);
});
```

The source compiler must distinguish immutable and mutable callback loan
types; the sketch does not establish acceptance of these calls. Effects
under a future standard-library `sync` module require separate explicit
declarations and verification before source execution.

For actor-owned persistent state, keep **one** `state { ... }` aggregate.
Sealed `handle_state(critical |s| -> ...)`, `using state.read` and
`using state.write` must select the same RW admission policy. Do not
introduce arbitrary instance mutex fields as an alternate actor state store.
A supervisor also needs host-owned lifecycle/CONTROL synchronization and
must use short metadata transactions, not borrowed guest mutex guards.

### Actor execution semantics

- Default actor physical min=1/max=1. Explicit max=3 must gate every
  read/write loan using actual physical concurrency-aware admissions.
- Actor domain grants *access*; logical continuation/actor incarnation +
  generation proves lock *ownership*. Physical carrier may migrate.
- A continuation cannot suspend with a live mutable data borrow; preemption
  must either preserve a verified pinned loan or retire/fence it before
  another actor turn can access it. A source `await` must not park the carrier.
- Writer registration and cancellation race on a linear wait handle. Queue
  admission is bounded and FIFO at scheduler level, preventing starvation
  between writer tickets. Core alone does not promise FIFO or scheduling
  fairness.
- Actor cancellation, panic and STOP do not release a lock before physical
  callback quiescence. Cleanup is exactly once; no user callbacks run under
  supervisor metadata locks.
- Deadlock detection requires a trusted continuation wait-for graph;
  an actor-wide ID cannot represent several independent concurrent turns.

## Release gates

1. Native C11 unit tests with GCC/Clang, -O2 and NDEBUG, ASan/UBSan,
   race-oriented stress and publication/order assertions.
2. Real LLVM guest-source lowering to core intrinsic/ABI (currently absent);
   compile-negative tests rejecting forged/released/read-across-await guards.
3. Scheduler FIFO/nonparking queue, cancellation/timeout/restart races and
   actor `state` RW effect-checker proof across max=1 and max=3.
4. Freestanding cross-compile and link proof for target profiles, including
   unsupported atomic targets failing closed.
5. Cross-backend Java/Graal execution of *the same Oreslang source behavior*;
   Java-backed locks may be used as host mechanisms, not as exported semantics.

Source host tests or compiler syntax admission alone do not satisfy 2-5.

## Native implementation progress (2026-10-18)

The LLVM draft PR #633 now includes three distinct native **host/compiler
substrates**, not an Oreslang source implementation:

- `OresCoreSync.h`: freestanding C11 atomic core mutex and RW gates.
- `OresStdSyncAdmission.h`: bounded 64-ticket FIFO logical scheduler gate,
  nonparking metadata try-admission, reader cohorts, STOP sealing, cancellation,
  physical callback start/end, quiescence and wake/failure ticket lists.
- `OresActorStateRwAdmission.h`: verifies runtime-authenticated actor ID and
  incarnation, compiler-verified critical callbacks, declared versus inferred
  `using state.read/state.write` effects, and suspension/retirement fences.

Every stdlib ticket carries its scope pointer, a **trusted nonzero lock-instance
generation** and a monotonically increasing per-instance sequence. New lock
incarnations at the same address must use a fresh generation, and teardown
must wait for all physical callbacks to quiesce before recycling storage.
The C interface is **trusted native ABI only**, not an Oreslang module or
public guest FFI. Actor identity inputs and critical/effect proof flags must
be derived by verified compiler/runtime code, never user arguments.

Native tests cover FIFO handoff, read cohorts, writer exclusion, concurrent
read/write payload access, invalid effects and wrong-incarnation requests,
queued/granted cancellation, physical callback STOP races, and same-address
lock recreation. Final exact-source-blob private CI evidence uses GCC/Clang
with Release/NDEBUG, ASan/UBSan, and GCC TSan. These focused native tests
must not be misreported as end-to-end Oreslang source lowering or as a
complete copied Git tree.

Remaining P0: source AST/HIR/MIR mapping to sealed linear guard operations;
scheduler-minted continuation ownership; transitive `using` effects; actual
source `handle_state` RW lowering; supervisor CONTROL-to-state lifecycle
integration; and full backend source conformance under max=1 and max=3.
