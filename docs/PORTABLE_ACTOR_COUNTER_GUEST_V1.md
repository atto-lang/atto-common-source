# Portable sealed-state Counter actor: guest execution v1

Status: **TARGET LANGUAGE SOURCE / NOT EXECUTED on all five backends**.
A source fixture and a parser denial are NOT proof of actor runtime parity.

## Exact source identity

The single reviewed guest fixture is
`fixtures/actor-hierarchy-ml/v1/actor_counter.ores` (310 bytes),
Git blob SHA-1 `c49780b4b42251db20ae9ac864eb8606bf7da922`.
Its bytes are also present in the Java, LLVM, Wasm, Cranelift and .NET
backend test branches. This pins a common **target**, not implemented
functionality.

The existing scalar intersection uses a different fixture with Git blob
`5affedebfcc7bf6aab2bdd6451f80ea5a71a5624` and result 42.
Do not confuse scalar i64 arithmetic parity with actor execution.

## Required compiler semantics

1. `define actor Counter as ... end` creates an actor-special nominal
   class; it does not permit a user class to forge runtime `Actor`
   authority. At most one concrete actor parent and no ordinary class parent.
2. `state { int count = 0; }` is a sealed actor-owned heap schema.
   It must not become a public Java/.NET field, shared LLVM pointer, or
   externally writable Wasm/Cranelift allocation.
3. `handle_state(critical-read |s| -> ...)` only supplies a scoped,
   immutable loan. Concurrent readers may coexist. A reader may not mutate.
4. `handle_state(critical-write |s| -> ...)` supplies one scoped mutable
   loan with exclusive writer admission. No second writer or reader can
   overlap that loan. Capture, return, escape, store, or suspend-without-proof
   of the loan must be compile failures.
5. Actor refs are opaque mailbox capabilities, not raw pointers or
   bypasses of their owner's state or scheduler.
6. Throw/raise/panic must follow the supervisor CONTROL path contract.
   Panic must not be intercepted by the panicking actor.
7. Program input and retained activation tickets must be bounded. No
   dangerous fallback to a host's native object mutation or shared memory.

## Required executable guest scenario (future phase)

The `actor_counter.ores` fixture declares the actor but intentionally
has no `main`. A compiler-specific test harness must construct an
additional **identical shared-language main** (not host-side arithmetic)
that:

- spawns `Counter` into a real actor runtime;
- reads the initial count (expected 0);
- enqueues four increments with admitted mailbox results and awaits
  their completion, then reads count (expected 4);
- exercises concurrent readers and an exclusive writer, proving no
  lost update across scheduling interleavings;
- rejects duplicate mailbox completion, closed mailbox admission and
  out-of-turn direct `self.count` access;
- shuts down the actor and proves mailbox teardown and supervisor
  termination notification.

No backend gets credit for a compiler parse, host JS/Java/C# simulation,
or a successful *rejection* of this fixture.

## Backend-specific minimum execution proof

| Backend | Required implementation, not currently attested |
|---|---|
| Java/GraalVM | Actual Oreslang guest, actor execution lease and sealed-state loan runtime |
| LLVM | Native actor mailbox, ownership/borrow semantics, compiled exclusive state loan |
| Wasm | Guest worker/actor scheduler, bounded transport, versioned state/loan access |
| Cranelift | Native JIT actor lowering, runtime mailbox and scoped heap state access |
| .NET | Compiled guest actor semantics under Native AOT, not a managed host-only oracle |

The runtime proof must bind exact source blob, compiler SHA-256, guest
artifact SHA-256, exact source commit, positive stepful CI provenance and
a guest trace with actor state observation. Never infer these from a
structurally valid self-reported receipt. The parity certification gate
must remain false until independently authenticated evidence is available.

## Release ordering

**A:** preserve source bytes and reject unsupported constructs safely;
**B:** compile/execute identical scalar guest on all five;
**C:** compile/execute Counter guest on all five;
**D:** compile/execute bounded forward/backward/optimizer actor network on
all five. A failure in B or C cannot be relabeled as a successful D.

Private source must remain inside authorized repositories and runners.
The active cross-organization source-exposure security incident blocks
unapproved cross-org source mirroring.
