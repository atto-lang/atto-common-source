# Actor transfer traits and local-channel ownership (draft v1)

Status: **normative design proposal with partial Java fail-closed enforcement**, not shipped backend parity.

## Three independent contracts

- `Serializable`: protocol/wire encoding for HTTP/TCP/WebSocket, files, process
  I/O and remote transport. It specifies an explicit schema/codec and version.
  It does **not** grant an actor's heap identity, shared-memory access, a
  mailbox capability, or transferable ownership.
- `Sendable`: compiler-verified, *actor-boundary* move/copy eligibility with
  destination-owned state and no reachable mutable alias retained by sender.
  It is a marker/effect proof, **not** a serializer or a callable method
  `send()`. A type being `Serializable` is not sufficient.
- `Shareable`: compiler-verified, transitively immutable or explicitly
  synchronized actor-shareable state with a stable region/lifetime identity.
  No mutable alias or untracked host capability is admitted. Shareability is
  not inferred from a `const` binding alone.

A separate `Copy` / `Copyable` property proves ability to make a correct,
independently owned value. A type can be Sendable without being Copyable
(e.g. an affine unique buffer), Serializable without being Sendable
(e.g. a wire DTO whose in-process fields include unshareable authority), and
Shareable without a portable Serializable representation (e.g. process-local
interned identity). "Has no methods" is neither necessary nor sufficient:
functions/callbacks stored *as fields* are critical; ordinary methods in code
do not make an owned class non-Sendable.

**Proposed language surface**: built-in compiler-controlled `Sendable` and
`Shareable` marker traits and `Copyable` copy contract. Their implementations
are structural/derived for safe data types and explicitly opted-in with
compiler proof for classes. They cannot be forged by writing
`define trait Sendable`, a cast, `implements Serializable`, reflection, or
untrusted host code. Syntax for derives/trait bounds is intentionally pending:
no backend should accept an unverified declaration as proof.

## Distinct transport domains

| Surface | Requires | Transfer |
|---|---|---|
| Intra-actor `Channel<T>` / task-local channel | owned + valid lexical lifetime; local channel is not itself actor-sendable | `rt take` may transfer affine pointer identity; local callables allowed |
| ActorRef mailbox, shared actor | `Sendable` proof or narrowly scoped built-in capability; exact runtime generation | verified copy/move, or `Shareable` immutable handle |
| isoactor / private actor mailbox | `Sendable` plus **destination-private representation** | deep copy or owned allocation/arena relocation with exclusive detach proof |
| Other isolate / OS process | portable representation and authority-free import; if networked also `Serializable` | no raw pointer addresses or JVM object references |
| HTTP/TCP/WS | `Serializable` + protocol/capability policy | wire bytes; never implies Sendable |

An actor mailbox is not a local `Channel<T>` merely because both queue
values. No generic `Channel<Pointer<T>>` implies cross-actor admission.

## Transfer operations and proofs

- `rt take p`: move unique `Pointer<T>`. Sender loses p *at admission*.
  Zero-copy only for a same-domain transfer or a proven atomic
  allocator/arena handoff with no old aliases, outstanding loans,
  callbacks, pending I/O, FFI leases or stale generation. Otherwise move
  into a distinct destination allocation by cloning/marshalling or **reject**.
  On failed send, cancellation, timeouts, lost select arms and panic, return
  the owner or deterministically drop it once; no silent loss/double drop.
- `rt copy p`: create a distinct owning `Pointer<T>` with a recursively
  valid `Copyable<T>` copier; no alias to mutable children. Immutable
  strings and interned symbols may share immutable backing storage.
  Copy of a unique pointer is *not* bitwise-copying its handle, and will
  ordinarily allocate new pointee storage.
- `rt share p`: produce a `Shared<T>`/read-only capability only if
  `Shareable<T>`, all nested values are safe, the region's shared lifetime
  is pinned/epoch-fenced, and both actors have policy permission.
  No upgrade back into exclusive `Pointer<T>` or `borrow mut T`.
- `rt borrow` and `rt deref` yield non-owning loans. Never admit a loan
  through actor transport, even if `T: Serializable + Sendable`.
  `rt unref` remains a read-only alias of deref on Java PR #443 and is
  **not** an ownership-release operation.
- For the existing Java draft, `rt copy p` and `rt share p` remain
  rejected, and `Pointer<T>` through an actor mailbox remains rejected,
  until an actual proof-carrying runtime lowering exists. Do not remove
  its hardening or claim zero-copy yet.

## Derivation/conformance by type

| Type | Sendable | Copyable | Shareable |
|---|---|---|---|
| int, bool, primitive numeric | yes | yes | yes (value semantics) |
| String, bytes (immutable) | yes | yes | yes if immutable backing |
| public/core Symbol | yes | yes | yes with canonical intern lifetime |
| module-private Symbol | only with visibility/capability proof | yes in owning namespace | never leak private symbol identity |
| enum/ADT | recursively all payloads | recursively all payloads | recursively immutable |
| record/struct | recursively all fields | independently copied children | recursively immutable |
| Array/list/map | yes if elements safe and owned | deep copy mutable contents | snapshot/freeze before share |
| ordinary class | explicit compiler-verified opt-in, no actor/state/raw handle | explicit deep-copy contract | explicit frozen immutable contract |
| Pointer<T> | not automatic; requires mode-specific proof | not a bitwise pointer copy | not automatic; safe Shared<T> conversion only |
| function/closure | local-channel only by default | no generic copy | no general actor share |
| actor reference | dedicated scoped capability, runtime-affine | not an ordinary data clone | runtime-authorized capability only |
| Future, MutexGuard, Channel, raw pointer, FFI/FD | no general admission | no | no |

Symbols are not raw shared addresses: within one intern domain a symbol can
retain its canonical identity without pointee copying, but across isolates or
processes only canonical namespace+symbol identity may cross when policy
permits, followed by destination-side lookup. Private module symbols cannot
be transported by leaking their interning slot. Global symbols may be
long-lived, but lifetime/generation still has to be verified.

## HIR/MIR proof obligation

On actor sends, actor-callable parameters and returns, select and
`writech` boundaries, the compiler must preserve: `type_id`,
`transfer_mode` (move/copy/share), recursively proven
`Sendable/Copyable/Shareable` bounds, sender and receiver allocation
domain IDs, generation, borrow/loan set, graph size/depth budget,
copy/freeze/drop plan, actor policy, cancellation/failed-admission result.
Transport authority must be checked *again* at the broker/runtime boundary.
Passing only a `Serializable` trait object or codec result proves none of
these. Generic bounds cannot be erased by casts, `Option`, `Result`,
structural typing, enum variants, closures or compiler specialization.

## Minimum conformance

### Implementation checkpoint, 2026-10-15

Java #443 now distinguishes owning `Pointer<T>` from a borrowed view at local
Channel admission. A local `rt take` consumes the source binding; runtime
dereference checks original execution-domain identity. Actor mailboxes still
reject Pointer recursively, including copy/share/take attempts. No runtime
domain reassignment, deep pointer copy or shared immutable pointer conversion
has been implemented. Host-created enums and numeric subclasses are not
implicitly immutable or Sendable: they can conceal owning capabilities.

The Java branch predates the current symbol runtime and does not define an
OresSymbol class. String/Symbol/enum **value** semantics in this proposal must
not be read as current support for `Pointer<String>`, `Pointer<Symbol>` or
payload-carrying enum pointers. Those pointer targets remain unsupported.

For local channel failure/cancellation, compiler consumption is conservative:
the sender binding is not restored after an unsuccessful probe. This is not
the proposed recoverable affine-send protocol. Do not claim deterministic
destruction or a complete transport implementation from local take support.

LLVM #415 is a rejection gate only. Its compiler-executed Rust matrix tests
all ref/unref/deref operations nested under copy/take/share and requires empty
stdout on rejection, with a successful scalar program as a positive control.
Wasm/Forge/.NET support remains unverified; no backend parity claim follows.

Positive: primitive, String, public symbol, immutable record/struct, enum,
deep-copy array/record, same-domain moved unique pointer, shared immutable
pointer with valid policy. Negative: Serializable-only class with live
channel/closure state; private symbols leaking namespaces; shallow copy of
mutable nested lists; mutable borrow crossing actor send; double-send of a
moved pointer; wrong actor/tenant/epoch; ABA/reloaded actor; queued and
cancelled `nb select`; cyclic graph, quota/depth overflow; actor-local
Channel/Future/MutexGuard/raw FFI; stale or revoked Shared<T> generation.
Every failed admission must have a deterministic ownership/drop result.
Test no IR emission on unsupported native forms; instrument pointee copies,
wrapper allocations, arena handoffs and source SHA before any zero-copy
performance claim.

See `POINTER_AND_ZERO_COPY_CONTRACT.md`, `OWNERSHIP_SYNTAX.md`,
`TRANSPORT-ACTOR-CONTRACT.md` and `MEMORY_SAFETY_AND_PERFORMANCE.md`.
