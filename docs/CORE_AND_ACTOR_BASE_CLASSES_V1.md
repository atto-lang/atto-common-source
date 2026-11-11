# AttoLang core classes, std-lib classes and base actors v1

**Status (2026-11-11): design/source-only.** This audit catalog does not make new
classes executable or certify any backend. Canonical source traits live in
`library/ores.core/protocols.atto` (19 traits). Java #2893 and common-source
#270 are the supporting, still-draft implementation branches.

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
`Entry<K,V>`, `Pair<A,B>`, `Range<T>` and `Duration`.

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
namespace kv;

define contract KvContract for actor as
  mtd get(String key): Option<String>;
end

declare pub actor KvWorker implements KvContract;

define state on actor KvWorker as {
  let int revision : 0;
}

define external mtd (KvWorker f) init(): void { return; }
define external mtd (KvWorker f) receive(ActorMail<String> mail): void {
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
   Zero-step Actions and source-only Node tests do not count as compiler runs.

**Implementation sequence:** finish Java trait guest execution and close
inherited generic/dispatch defects; prove ActorRef/Future/Channel invariants;
introduce runtime-validated SupervisorActor and typed ServiceActor; then
develop hosted HttpActor and ChildProcManager on async I/O.
