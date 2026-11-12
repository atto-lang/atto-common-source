# AttoLang core classes, std-lib classes and base actors v1

**Status (2026-11-12): design/source-only.** This audit catalog does not make new
classes executable or certify any backend. Canonical source traits live in
`library/ores.core/protocols.atto` (19 traits). Java #2893 and common-source
#270 are the supporting, still-draft implementation branches.

## Native implementation and authority boundary

**Required implementation language:** all public core behavior, traits, actor
bases, and hosted actor policies must be native AttoLang `.atto` code.
Java/LLVM/Wasm/Forge/.NET may provide compiler lowering, schedulers, memory
isolation, trusted capability minting and nonblocking device adapters; their
host-side classes must **not** be represented as completed guest base classes.

The machine-readable `native_actor_policy` contract in
`contracts/v1/core-actor-foundation-v1.json` is validated by a separate
fail-closed test suite with adversarial authority and permission mutations.
That is a **source-only gate**, not a compiler/runtime enforcement mechanism.
A future compiled guest base must pass the same requirements independently.

A guest may declare an actor or use a checked base, but **neither a base class
name nor implementing any ordinary trait mints supervisor CONTROL, ActorRef,
Channel, mailbox identity, a reply capability, or process/network permission**.
Only the runtime may authenticate the actual supervisor relationship, actor
incarnation, code image, capabilities and priority CONTROL destination.
Private `init` and `receive` are compiler-bound runtime ingress, not public
or guest-reflectable members.

## Library boundary

- **ores.core:** freestanding values, pure traits, opaque runtime-minted
  handles, and compiler-owned actor identities. An ordinary class cannot mint
  mailbox, supervisor CONTROL, Drop, or Sendable authority.
- **ores.std:** OS, network, subprocess, storage, and hosted actor adapters.
  Importing a hosted base cannot grant permissions or bypass ownership.
- **Never expose:** raw actor state, mutable identity, reply ports, CONTROL
  queues, capability minting, or guest-callable lifecycle ingress.

## Core classes and runtime type roster

| Type | Contract |
| --- | --- |
| `Option<T>`, `Result<T,E>` | owned tagged values, map/and_then/map_err and ? |
| `Error` | typed root; no stack captured by default |
| `Future<T>` | single terminal settlement; resume on owning scheduler |
| `Iterator<T>` | safe owned iteration; no implied I/O |
| `ActorId`, `ActorMail<T>`, `ActorOutput<T>` | immutable identity and envelope views, not authority |
| `ActorRef<A>` | runtime-minted, incarnation-fenced send/request/ready/done |
| `Channel<T>`, `ReadChannel<T>`, `WriteChannel<T>` | bounded queues with non-escalating directional capabilities |

This is an **audit roster**, not proof each type exists or runs on all five
backends. After ownership/generics testing, additional pure classes may include
`Entry<K,V>`, `Pair<A,B>`, `Range<T>` and `Duration`. Collection implementations
(`HashMap`, `HashSet`), OS paths/files, network streams and subprocess handles
belong in appropriate `ores.std` modules rather than being mistaken for core
runtime capabilities. These are **candidates**, not verified definitions.

## Minimal base actor hierarchy

1. **Actor** (existing actor language intrinsic): implicit base of inline
   `define actor` and out-of-line `declare actor`, runtime-owned mailbox,
   heap and effective serialized turns. No explicit `extends Actor` needed.
2. **SupervisorActor** (proposed compiler/runtime-checked base): legitimate
   supervision identity and private CONTROL hooks, policy admission, restart
   ordering and escalation to parent supervisors. No actor may intercept its
   own panic; ordinary user traits cannot grant CONTROL.
3. **ServiceActor<Request,Reply>** (proposed checked base): statically
   typed request/reply actor dispatch. A class implementing the ordinary
   `Service<Request,Reply,E>` trait gains no mailbox authority.

Sealed state belongs to any actor, not a new `StatefulActor` kind. Event sourcing
is an optional storage capability, not a separate actor kind. `serial http
actor` maps to `requestConcurrency=1` and `messageConcurrency=1` rather than
introducing a new privileged `SerialHttpActor` base.

## Mailbox, CONTROL and sealed-state requirements

Actor mailboxes are channels with bounded admission. `send_async` may suspend
the **Atto task** on full capacity but cannot park an ActorRuntime carrier;
`try_send` is a nonblocking admission API that must distinguish committed,
backpressured and closed outcomes. A rejected or cancelled admission must not
retain message ownership or leak quota. Dispatch, close, restart, cancellation
and pending futures require exactly-once accounting and generation fencing.

Every effective actor turn is serialized. Checked `critical-read` and
`critical-write` lend state only inside their scoped callback; the loan may
not cross `await` or escape into a closure, mailbox payload or returned view.
A valid `ActorMail<T>` envelope is **not** a sender capability. `ActorId`
is an immutable identifier, not an `ActorRef`. Guest-visible `Service`
conformance cannot create a request/reply endpoint.

The supervisor's priority CONTROL is authenticated outside the user mailbox.
A forged guest CONTROL message, inherited method, user-defined `Supervisor`
trait, or structural match may never authorize supervision. Child panic must
reach the trusted parent supervisor; the panicking actor may not intercept it.
On retirement and hot-reload, stale references and pending callbacks cannot
admit messages into a new generation.

## Hosted actor adapters (candidate classes in ores.std)

| Base | Host capability | Constraint |
| --- | --- | --- |
| `HttpActor` | NETWORK | bounded HTTP requests and messages, independent concurrency limits |
| `TcpActor` | NETWORK | async reactor/NIO only, bounded connection and write queues |
| `WebSocketActor` | NETWORK | framed transport, backpressure and safe close |
| `ChildProcManager` | PROCESS | async child pipes, generation fencing and cancellation |
| `PersistenceActor` | verified storage | snapshot outside critical loan, receipt distinct from durable acknowledgment |

Existing `stdlib/otp/supervisor.ores` is **policy arithmetic**, not an OTP
supervisor implementation. Existing `stdlib/actor_persistence.ores` provides
version/cursor utilities, not a durability capability. Keep hosted libraries
separate from core and preserve the nonblocking-I/O requirement.

## Namespace actor sketch (design target, not compiled)

~~~atto
use namespace kv;

define contract KvContract for actor as
  mtd get(String key): Option<String>;
end

declare pub actor KvWorker implements KvContract;

define state on actor KvWorker as {
  let int revision : 0;
}

external mtd (KvWorker f) init(): void { return; }
external mtd (KvWorker f) receive(ActorMail<String> mail): void {
  return;
}

pub mtd (KvWorker f) get(String key): Option<String> {
  return None;
}
~~~

These private external ingress roles are *not* ordinary public methods. The
actor contract, namespace provenance, state schema and critical-read/write
scoped loans must be compiler-validated before execution. Java actor PR #2901
still rejects stateful declared actor code generation. No unchecked bypass is
an acceptable implementation.

## Implementation gate for native base actor classes

The next real compiler milestone is a *native* `Actor` contract exercising
`declare actor`, sealed state, private runtime `external mtd init/receive`,
checked `critical` turns, `spawn`, bounded channel sends and clean retirement
on an actual `.atto` guest. The existing Java source-level actor experiments
are intentionally closed-world and must not be generalized by a host-class
shortcut. `SupervisorActor` follows only after runtime-authenticated parent
CONTROL and restart receipts; `ServiceActor<Request,Reply>` follows only after
typed reply ownership and terminal settlement are compiler-checked. Hosted
`HttpActor`/`TcpActor`/`ChildProcManager` then compose verified native
policy with independently permission-gated nonblocking providers.

## Merge gates

1. **Traits:** exact generic argument substitution, inherited obligations,
   nominal identity, visibility and dynamic/static dispatch; negative tests
   for signature mismatch, structural impostors and forged runtime intrinsics.
2. **I/O:** no synchronous host I/O, Future.get/join, hidden blocking pool or
   spin wait. Read distinguishes EOF from empty chunks. Write/BatchWritable
   cannot admit partial writes as full success. Source and Sink have bounded
   backpressure. Cancellation/Close are once-only.
3. **Actors:** init before ready exactly once, non-guest-callable receive,
   protected state and borrow lifetimes, panic through trusted supervisor
   CONTROL, nested supervisor failure, mailbox closure, restart generation
   fences, bounded pending futures, exact-once quota release.
4. **Evidence:** immutable head SHA and blob provenance, real guest invocation
   and exit evidence on Java/JVM, GraalVM Native Image, LLVM, Wasm, Forge, .NET.
   Zero-step Actions, private selected-file JVM carrier tests, and source-only Node
   tests do not count as **full exact-head** compiler/backend parity runs.

**Implementation sequence:** finish Java trait guest execution and close
inherited generic/dispatch defects; prove ActorRef/Future/Channel invariants;
introduce runtime-validated SupervisorActor and typed ServiceActor; then
develop hosted HttpActor and ChildProcManager on async I/O.
