# Proposed typed network-actor language contract

Status: **proposal for independent Java/Graal and C++/LLVM compiler teams**.
Nothing in this repository is executable or currently mandatory. Companion
runtime hardening: [Graal HTTP request lifetimes PR #529](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/529).

## Source declaration shape

```ores
define http actor Handler as
  receive_http(HttpMessage m): void {
    val req = m.get_request();
    val res = m.get_response();
    await res.start(200, "text/plain");
    await res.write("first");
    await res.write("second");
    await res.finish();
  }
end

define tcp actor TcpWorker as
  receive_tcp(TcpMessage m): void {
    val conn = m.get_tcp_conn();
    if m.kind == TcpEvent.data; do
      await conn.write(m.bytes);
    fi
  }
end

define ws actor WsWorker as
  receive_ws(WsMessage m): void {
    val conn = m.get_ws_conn();
    if m.kind == WsEvent.text; do
      await conn.send_text(m.text);
    fi
  }
end
```

These spellings are **not yet supported by either compiler**.
They denote an actor's *ingress protocol*, not its isolation/trust level.
`actor` vs `isoactor`/policy, trusted vs untrusted execution,
and AOT vs JIT remain orthogonal. Standard
`receive(ActorMail<T>)` has no implicit request/connection capability.

## Normative semantics to implement before admission

1. `actor_execution_lease(actor_id)` is singular. Every ingress,
   continuation, timer, on-start, supervision event and cleanup routine
   enters through the mailbox-backed scheduler. No two worker/carrier
   threads execute guest instructions for the same actor simultaneously.
2. `max_active_requests`, `max_pending_events` and
   `max_parallel_guest_segments=1` are distinct quotas. A long-lived
   actor can own many live HTTP requests and WebSocket/TCP connections,
   even though only one guest code segment executes at once.
   A suspension relinquishes its carrier; interleaved continuations
   require an explicit actor-lease-safe scheduler implementation.
3. HTTP envelope identity is `(request_id, request_generation,
   actor_incarnation, event_sequence)`, not just a connection FD.
   TCP/WS envelope identity uses `(connection_id, generation,
   actor_incarnation, event_sequence)`. IDs cannot be reused inside the
   receiver's accepted incarnation; stale events are rejected.
4. Every `HttpMessage` refers to exactly one request.
   `get_request` exposes a bounded read-only request view;
   `get_response` exposes only that request's revocable response sink.
   Multiple messages may refer to the same request; they must never
   alias any *other* response sink. No global `current_request`/
   `current_response` field exists.
5. Response sinks have a terminal state and exactly one writer. Valid
   operations are `start(status,headers)`, ordered bounded
   `write(bytes)`, `finish()` or `abort(reason)`; all network I/O
   operations return futures that yield actors off their carriers.
   Header commit happens once. Backpressure and deadlines are enforced
   at the transport, not entrusted to guest code.
6. Each request has its own deadline, cancellation and completion.
   Killing request A must not kill long-lived actor B's other requests.
   An actor spawned solely for one request may have a dedicated
   actor-finalization barrier. Actor termination revokes all open sinks;
   already completed requests must not remain retained in an actor's
   lifetime callback list.
7. TCP messages are typed connection events: `open`, `data`,
   `peer_half_closed`, `closed`, `error`. Never dispatch user
   code through `conn.on("message", callback)` outside the actor
   ingress scheduler.
8. WebSocket messages are typed session events `open`, `text`,
   `binary`, `ping`, `pong`, `close`, `error`.
   `WsMessage` is not `TcpMessage`: framing, fragmentation, masking
   and close handshakes belong to the transport. Send commands are
   `send_text`, `send_binary`, `ping`, `close`.
9. A client connection FD is **not** an HTTP request. Keep-alive,
   HTTP/2 streams, TLS and HTTP/3/QUIC require broker-owned
   transport/protocol state. Do not move the client FD per HTTP request.
   If a trusted native actor explicitly receives an exclusive socket,
   require a quiescent connection and separate explicit OS-level transfer.
10. For untrusted actors, the broker copies/serializes bounded request
    metadata, body chunks, and transport events. It accepts validated
    response commands, verifies actor incarnation, request generation
    and event ordering, enforces time/size/backpressure limits, and never
    exposes pointers, Java objects, raw FDs, TLS keys or host callbacks.
    Serialization alone does not sandbox malicious guest code.
11. No implicit authority on deserialization. A response command may be
    accepted only if the broker independently proves current ownership
    and stream state. Reject duplicated/out-of-order terminal commands,
    wrong actors, revoked epochs, invalid headers, oversized buffers and
    unauthorized protocol upgrades.
12. The default one-guest-segment rule must include async continuations.
    Increasing ingress event concurrency above 1 in the future requires
    an explicit opt-in concurrency mode plus isolation/borrowing rules;
    concurrency is never inferred from connection or request count.

## Future HIR / MIR contract

A future HIR `ActorDecl` should preserve:
`ingress_protocol = generic | http | tcp | ws`,
`entry_method`, `envelope_type`, `actor_kind`,
`trust_policy`, source span, declared capabilities and compilation mode.

MIR must express `AcquireActorLease` / `ReleaseActorLease`,
`IngressDequeue`, `SuspendIo`, `ResumeContinuation`,
`CheckExchangeGeneration`, `RespondStart/Chunk/Finish/Abort`,
and `RevokeExchange` as *conceptual operations*, **not** defined
instruction opcodes yet. A backend must prove these semantics without
sharing a heap or an OS descriptor representation.

## Minimum shared conformance gates

- Parser accepts correctly qualified declarations, rejects duplicate/
  conflicting `receive*`, mismatched message types, ordinary actor
  methods masquerading as transport ingress and invalid callback escapes.
- Two simultaneously admitted HTTP requests on one actor produce distinct
  responses, IDs and completion events. Two messages per same request
  retain one correlation ID; A/B/A event interleaving never swaps sinks.
- Wrong-owner, duplicate-claim, stale generation, actor reincarnation,
  failed dispatch and response-after-terminal are rejected.
- Request A timeout/abort leaves request B alive; actor termination
  closes all outstanding requests and does not retain completed ones.
- Slow-read/write adversarial tests validate buffers, deadlines and no
  blocking carrier; TLS/HTTP2 sessions cannot leak other streams.
- TCP half-close and WS ping/pong/fragmentation/close are serialized
  as scheduler messages; no guest callback runs on an I/O thread.
- Untrusted worker tests verify copied payload immutability, malformed
  frame rejection, bounded command queues, forced crash cleanup and
  complete absence of raw memory/FD capabilities.

The teams must keep frontend and backend tests independent until a
common HIR/MIR implementation actually exists. Do not advertise the
syntax as implemented because a contract document was merged.
