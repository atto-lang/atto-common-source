# TCP shared-pool capabilities v1 — trusted actor transport boundary

Status: **proposed contract / not guest-implemented** (2026-11-01).
This document does **not** claim a production pool or backend parity. Applies to
Java/GraalVM, LLVM, Wasm, Cranelift, .NET and Forge. The Java HTTP/1.1 pinned transport
currently uses `Connection: close`; its shared connection **budget** is not a
physical socket pool. Java's request-local selector must not be concurrently
entered by actors. LLVM's per-manager FD watch exclusion is not a pool.

## Decisions

1. **One trusted physical socket owner.** A VM transport shard owns socket/FD,
   registered readiness, TLS engine and keys, protocol parser, outbound writer,
   response demultiplexer and physical retirement. Actor heaps and ActorRefs
   never own or dereference those objects. Sharing the *right to submit work*
   does not transfer physical ownership.

   **Completion ABA fence:** the v1 Java and .NET host ledgers admit a
   **single physical operation per v1 lease**, even if its first completion
   succeeded, because they currently complete by lease identity alone.
   Allowing another operation under the same lease would let a delayed
   duplicate callback falsely complete the newer operation. Multi-operation
   leases require a separate unforgeable, one-use, generation-scoped
   **operation completion receipt** and corresponding conformance tests,
   not simply resetting an `active` Boolean.

2. **No generic concurrent TCP reads.** Raw TCP is an ordered byte stream,
   not a multiplexer. The default pool issues exactly one **exclusive
   logical-session lease** per physical connection. Different actors may reuse
   that connection *sequentially*, not read arbitrary bytes concurrently.
   Responses cannot be identified by TCP itself. An explicit protocol codec
   (HTTP/2 streams, ordered bounded Redis/PG pipeline, framed RPC, QUIC
   streams) may admit multiple independent logical exchanges and must own
   complete matching, framing, flow control, ordering, and cancellation.
   PostgreSQL transactions, protocol upgrades, blocking or subscription
   connections always use an exclusive/dedicated lane. The codec must be
   registered and trusted: a guest cannot enable multiplexing by setting
   a Boolean on an unframed TCP byte stream.
3. **Direct submission, not actor mailbox serialization.** Trusted actors
   may enqueue fixed-size immutable **descriptors** into a bounded MPSC
   transport-shard command ring or reserve per-shard slots by CAS. Descriptors
   name opaque capabilities, frozen payload slices, operation IDs, deadlines
   and generation stamps. This is coordination/message passing at the
   transport boundary, but does not serialize and copy full payloads through
   a user actor's mailbox. Descriptor queue saturation is a nonparking
   `Busy`/backpressure result; do not block actor carrier threads.
   Asynchronous completion resumes an admitted continuation through the
   owning scheduler, never runs guest callbacks on reactor threads.
4. **Opaque, incarnation-fenced handles.** A host-only table validates
   `(pool_id, slot, nonwrapping_slot_generation, lease_nonce,
   actor_id, actor_incarnation, domain_id, rights, policy_epoch)` on every
   admission, completion claim, cancellation, and release. Rights are
   narrow and cannot be upgraded. No raw pointer, FD, Java host object,
   native memory address or TLS credential is guest-visible. Never derive
   authority from serialized/deserialized identifiers or caller-provided
   partition metadata. Cross-isolate/untrusted submissions must use copied,
   validated commands, not shared pointers.
5. **Strict pool partitioning and reauthorization.** The trusted key includes
   protocol, canonical authority and resolved address, destination port,
   authenticated principal, tenant/security domain, TLS profile, SNI, ALPN,
   credential identity, negotiated protocol scope, and resolved-policy/DNS
   generation. Revalidate egress permissions and endpoint at *every new
   physical dial*, as well as on borrow where a changed permission/policy,
   credential or DNS generation requires drain/reauthorization. Never
   leak an authenticated socket between tenants or origin authorities.
6. **Immutable zero-copy buffers where permitted.** A shared-domain payload
   is frozen before publication and is immutable until completion. It has
   an opaque generation-fenced handle, independent shared-region lifetime,
   bounds and rights checks, producer release/consumer acquire ordering,
   pinned-byte accounting and completion-owned unpin. **Every read**, not
   merely every pin, must verify a currently live, unforgeable, reader-scoped
   lease. A frozen buffer must not expose its backing array or permit an actor
   to read using some other actor's pin. Unpin invalidates that exact token;
   other reader pins continue independently until their own release. A read-only pointer
   alone is insufficient: it does not guarantee lifetime, revocation, bounds
   or cross-isolate safety. No mutable aliasing of socket input, TLS buffers,
   scatter/gather vectors, or parser state. For untrusted or remote isolates
   use bounded copies even if that costs more.
7. **Cancellation and linearizable retirement.** Pool slots move
   `NEW -> CONNECTING -> IDLE -> LEASED -> DRAINING -> RETIRED`; protocol
   stream leases add independently tracked `ACTIVE -> COMPLETED/CANCELLED`.
   Returning a clean exclusive lease is permitted only after its physical
   operation has quiesced and protocol framing proves the connection reusable.
   Any timeout, ambiguous partial frame, asynchronous cancellation during
   write, invalid response ordering, TLS failure, peer half-close or
   authorization epoch change marks the connection `DRAINING` (never idle).
   Marking a guest Future failed or an actor stopped does not prove kernel
   I/O has stopped. Physical free, buffer unpin and slot reuse wait for
   readiness cancellation, all I/O callbacks and buffer/lease pins to retire.
   Generation increments on slot reuse and never silently wraps.
   **Pool shutdown is terminal**: draining outstanding I/O may complete,
   but a RETIRED socket must never be reopened by the stopped pool.
   Individual multiplexed stream cancellation may preserve unrelated
   streams only after the trusted codec has emitted and confirmed a safe
   stream-reset completion, all stream-specific writes have quiesced,
   and a one-use, unforgeable host receipt is consumed. Actor-supplied
   Boolean/string/reset tokens are not authority. Without that evidence,
   poison and drain the full physical connection.
8. **No blocking locks across suspension.** A shared metadata lock may
   protect brief bounded admission bookkeeping but must not cover network
   syscalls, TLS processing, guest callbacks, critical sections, or `await`.
   No `rt mut share` of a physical socket or actor-local heap. Do not
   equate `SharedMutex` around a socket with protocol-safe multiplexing.
   Bounded queues and per-connection serial writer ordering are required.
9. **Hard real-time and resource policy.** Charge sockets, buffered bytes,
   pinned bytes, active logical streams, pending command descriptors,
   completion records and per-tenant/per-origin credits *before* creating
   resources. No unbounded allocation, lock wait, DNS, TLS handshake, or
   reactor thread creation on hard-RT carriers. Use a fixed/admitted profile
   for native hard-RT operation; report unsupported capability explicitly.
10. **Fail-closed backend parity.** All supported backends share the semantic
    contract, not pointer or FD representation. Implement and execute native
    positive cases on each backend before feature-parity claims. A reference
    model or source-level conformance fixture alone is never native proof.

## Proposed guest surface (illustrative; not parsed/implemented)

```ores
const pool = tcp.pool(config)  // supervisor-issued shared pool capability
let lease = await pool.acquire_async(authority, #exclusive)
let response = await lease.exchange_async(rt share frozen_request)
await lease.release_async() // clean only if protocol reached a safe boundary

// Multiplex requires a registered protocol codec and per-stream identity:
let stream = await pool.open_stream_async(authority, #http2)
await stream.write_async(rt share frozen_chunk)
```

`rt share` conveys immutable/frozen data in an admitted shared domain; it
does not turn a socket into shared mutable memory. These examples express
intended behavior, not established language signatures.

## Mandatory negative-first test matrix

- Two actors competing for one raw-TCP exclusive lease: exactly one wins;
  the loser gets nonblocking backpressure. No parallel reads.
- Same actor trying to overlap two physical operations on one lease: reject.
  Two distinct HTTP/2 stream leases may coexist, but stream ID, frame/window
  and response routing are distinct.
- Cross-tenant, wrong principal, wrong TLS/SNI/ALPN, wrong actor incarnation,
  stale generation, forged token, revoked policy/DNS epoch: deny and never
  reveal or consume the wrong tenant's bytes.
- Cancellation/actor STOP while read or partial write is pending: revoke
  new commands; keep slot/pins until trusted completion; never recycle as
  clean or double-unpin.
- Concurrent cold dials on one slot must be single-flight: reserve the
  CONNECTING state *before* awaiting socket creation or dialing. A STOP
  racing connect must prevent late socket publication, close any eventually
  connected candidate and await physical-close completion before retirement.
  Neither a `destroyed` flag nor a cancelled Future proves OS close.
- Pool stop before dial, during multiple writes, and after quiescence is
  irreversible. Reject stale reopen attempts even after complete drain.
- Raw-TCP multiplex permission without a codec is rejected. Forged,
  duplicate, wrong-stream and cross-pool stream-reset receipts are rejected.
  A proven HTTP/2/QUIC stream reset may preserve another live stream.
- On native Linux, multiple numeric FDs can alias one socket via dup/dup2.
  Fence physical-transport aliases within the authoritative reactor manager;
  preserve independent socketpair peers and pipe read/write endpoints.
  Host code must not prematurely close/reuse a registered FD, and separate
  manager instances require a shared authority boundary.
- Double release, release by a different actor, slow consumer, bounded queue
  full, expired deadline, connection reset, TLS renegotiation/error, half
  close, pool shutdown, slot generation exhaustion: fail closed with exact
  physical retirement/accounting assertions.
- Frozen slice can be consumed by two trusted readers without a copy if both
  retain valid pinned leases; writer mutation, forged/foreign/replayed pin
  receipts and read after *that reader's* unpin are forbidden, even when
  another reader still holds its own pin. Cross-isolate ingress performs bounded copy.
- Validate against real loopback servers, fragmentation, ALPN/HTTP2,
  PostgreSQL/Redis sessions and ASan/UBSan (native), GraalVM Native Image,
  Wasm worker isolation, .NET Native AOT, and actor STOP/deadline stress.

## Promotion order

1. Adopt shared contract and negative-first reference tests.
2. Integrate trusted host slot and pin/loan registry into Java VM selector
   and LLVM native epoll with exclusive TCP sessions; no guest socket aliases.
3. Wire typed guest `Future<Result<...>>` operations and actor-incarnation
   capability checks; prove clean-release vs drain under cancellation.
4. Only then enable protocol-aware multiplexing, immutable zero-copy slabs,
   and native conformance across all supported backends.
5. Benchmark descriptor submission vs mailbox serialization with payload
   sizes 64 B, 4 KiB, 64 KiB and 1 MiB, 1/8/64 actors, and p50/p99 latency,
   copy count, allocations, throughput and cancellation cost. Require
   identical protocol/keep-alive behavior and a safe untrusted baseline.

Related: `docs/SHARED_ACTOR_ARENAS_V1.md`,
`docs/TRANSPORT-ACTOR-CONTRACT.md`, Java `PinnedHttpTransport`,
`SelectorTransportConnection`, LLVM `NativeEpollReactorManager`.

## Bounded immutable-slab admission (source-only testable contract)

New reference oracle: `tests/tcp_shared_slab_registry_v1.test.mjs`.
The 54 local deterministic **source-only** scenarios (22 targeted, 32 seeded
retirement orders) passed with Node 22.16.0 on 2026-11-01; the exact file
content was read back from GitHub and its Git blob SHA matched the locally
executed file. This is **not** a thread-race, native IO or guest-compiler proof.

- **Precharge** fixed slab slots, per-slab byte size, aggregate live slab
  bytes, max active pin count and aggregate pin-slice bytes before publication
  or pin admission. Invalid, sparse, oversized and unbounded input fails
  without granting a handle or reservation. Total bytes stay charged while
  the slab is retiring and any reader or I/O pin remains live.
- Each opaque host-issued pin is scoped to an exact slab incarnation, actor ID
  and incarnation, tenant, trust domain, offset and length. Verify the pin
  again on *every* read and release. Exact-once release rejects forged,
  cross-pool, cross-actor, replayed and stale-generation receipts. Pinning
  does **not** imply permission to mutate a slab.
- Publication must either take exclusive ownership of a provably frozen
  immutable backing allocation or copy into a private region. A read-only
  Java ByteBuffer view, .NET ReadOnlyMemory, Rust shared reference, Wasm
  memory view or C/C++ const pointer alone does **not** prove absence of a
  mutable alias. The reference oracle **copies on publish**; it does not
  model production zero-copy. A same-domain zero-copy implementation must
  separately prove producer freeze/ownership transfer and memory ordering.
- Retiring prevents fresh pins, preserves already admitted reads, and frees
  storage only when every pin has been released. The trusted host must
  invoke retirement only **after** real outbound I/O callbacks, kernel
  accesses, DMA, TLS writes and completion handoff have physically quiesced.
  The reference registry does **not** attest that quiescence; a Future's
  cancellation is insufficient.
- The identity values in this test are *trusted host inputs*. A real guest
  must not be able to supply its own actor incarnation, tenant, domain or
  slot owner. The implementation must derive them from the OresVM scheduler
  and capability registry. Shared slabs are disallowed across untrusted
  isolates without an explicit bounded copy and reauthorization.

### Runtime implementation and proof status

| Backend | Minimum host proof required before actor-shared pool can be enabled |
| --- | --- |
| Java/GraalVM | Connect VM selector to opaque exclusive leases, ownership/pin registry, real loopback framing, JDK 25/JUnit and Native Image. PR #2404's selector gate is only a prerequisite. |
| LLVM | Connect epoll owner table to leases, no-GC preallocated slabs and physical drain; run GCC/Clang ASan/UBSan plus compiled guest. Dup-alias exclusion in PR #1255 is only a prerequisite. |
| Wasm | Typed capability broker for browser/Node/Wasmtime worker, bounded copy across untrusted isolates, detached/transferred buffer handling and worker-stop tests. No naked guest linear-memory pointer may escape. |
| Cranelift | Until actor, async and socket runtime exist, reject TCP-pool operations **before native IR** with nonzero exit, no guest IR and a diagnostic. PRs #26/#30 provide negative-first candidate tests only. |
| .NET Native AOT | Trusted socket owner, single-flight exclusive lease, immutable-owner memory region/pins and cancellation drain; test Native AOT on Windows and Linux. A ReadOnlyMemory view is insufficient. |
| Forge | Preserve fail-closed capability I/O and bring up native reactor/host-owned slab pin receipts; run GCC/Clang sanitizer, AOT and guest actor evidence separately. |

**Release blocker:** no backend is certified for guest actor-shared TCP
pooling/zero-copy readonly slabs by this document. Backend implementation
must consume the same negative-first corpus and produce executed, exact-head
native results, not just copied contracts or zero-step GitHub Actions runs.


## Five-backend source integration status (2026-11-01)

| Backend | Draft change | Admission and lifetime evidence | Not yet proven |
| --- | --- | --- | --- |
| Java | [#2404](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2404) | Selector/TLS I/O exclusive gate, trusted host generational ledger, quarantine until physical-close attestation; JUnit tests authored | JDK 25 JIT/AOT actual socket pool and guest actor routing |
| LLVM | [#1255](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1255) | Linux epoll FD/dup-alias admission fence and native tests authored; isolated Linux inode assumption checked with ASan/UBSan | exact-head C++ sanitizer suite, manager-crossing aliases and hard-RT proof |
| WASM | [#229](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/229) | 15 unsupported TCP pool options rejected before source/byte admission in a source-only JS check | physical reactor, bounded worker bridge, guest TCP |
| Cranelift | [#39](https://github.com/ores-truffle-oreslang/oreslang-source.cranelift/pull/39) | Stage-0 scalar JIT rejects guest actor/TCP-pool/ownership forms; CLI tests authored | Cargo test execution and **all** network/actor functionality |
| .NET | [#291](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/291) | Trusted host generational ledger, nonparking acquisition, policy-epoch and idle-socket quarantine, 1,024-cycle tests authored | .NET 10 compilation, NativeAOT guest and physical TCP connections |

This table is an **evidence taxonomy, not a parity certificate**. Unsupported features must remain compiler/runtime admission failures until verified. The Java and .NET ledgers are **host-authority prerequisites**, not transport socket managers; they lack protocol framing, physical close acknowledgements wired to real sockets, bounded MPSC descriptors, fair scheduling and actual zero-copy pinned buffers.

The critical cross-backend invariant is:
`actor release/cancel -> revoke lease -> finish I/O -> physical-close acknowledgement -> rearm quarantined slot`.
Neither cancelling a future nor removing an actor mailbox grants permission to recycle a physical TCP socket. Policy-epoch changes must quarantine even idle, pre-connected sockets.

The reference-model and seed-interleaving tests are independent source-only evidence. Runner jobs with zero steps or no runner allocation are not compile/test failures and cannot be credited as native passes.


### Source-model, live I/O and promotion distinctions (2026-11-01)
- Guest-owned JavaScript arrays are not immutable transport-region authority.
  The source model reads each own **data descriptor once**, validates octets
  and snapshots those same values. Accessor getters and inherited sparse
  indexes are rejected, preventing a validation-to-copy mismatch. Production
  backends still need independent physical shared-memory publication proof.
- An empty userspace frame queue does **not** guarantee a peer cannot deliver
  a delayed response from an earlier actor's lease. Only a registered trusted
  protocol codec with validated response correlation may release cleanly.
  Unknown or mismatched late frames poison the socket.
- Node.js framed TCP loopback is a HOST reference oracle. Java and .NET real
  loopback tests cover their HOST ledgers and physical-close acknowledgements;
  LLVM AF_INET epoll readiness covers HOST descriptor identity. None is
  compiled guest pool, asynchronous language lowering, zero-copy or AOT proof.
  LLVM actor-owned watch/completion ACK remains a separate integration gate.
- Require exact source HEAD, allocated runner and **nonempty executed steps**,
  compiler/runtime version, and named positive/negative tests before promotion.
