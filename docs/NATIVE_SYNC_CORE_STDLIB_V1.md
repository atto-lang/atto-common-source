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

```ores
val Mutex<int> counter = Mutex.new(0);
using counter.with_lock(|rt borrow mut value| -> {
    value += 1;
});

val RwLock<Config> config = RwLock.new(initial);
using config.with_read(|rt borrow value| -> {
    inspect(value);
});
using config.with_write(|rt borrow mut value| -> {
    update(value);
});
```

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
