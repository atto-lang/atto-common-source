# IPC actor delivery and receipt semantics — proposed v1

Status: **draft normative proposal** for issue #79. This is a protocol
specification, not evidence of an implemented transport.

## Distinct acknowledgements

An IPC `ActorRef<T>` send must not collapse these states:

| Stage | Evidence | What may be claimed |
| --- | --- | --- |
| `LOCAL_ADMITTED` | Local bounded sender/queue accepted immutable Sendable payload | Local enqueue only; no remote delivery promise |
| `REMOTE_ACCEPTED` | Authenticated peer incarnation durably/explicitly admitted an identified envelope to its bounded incoming queue | Remote admission only; handler may never run |
| `HANDLER_COMMITTED` | Destination handler committed its specified idempotent effect and reply/receipt atomically according to its contract | Application-level commit only |
| `FAILED` | Proven rejection **before** remote admission (invalid capability, full capacity, timeout before send) | Definitive no-admission |
| `UNKNOWN` | Disconnect/crash/timeout after bytes may have crossed boundary | Neither success nor failure may be asserted |

A timeout, future cancellation, or transport close MUST NOT retroactively
claim an already transmitted message was not delivered.

## Envelope and replay defense

Require a bounded canonical envelope with `protocolVersion`,
`senderDomain`, `senderActorId`, `senderIncarnation`,
`destinationActorId`, `destinationIncarnation`, `messageId`,
`capabilityGeneration`, `deadline`, and typed payload hash.
Message IDs are unique within the sender-incarnation scope; identity
includes destination and tenant trust domain. Authenticate peer, bind
authorization to the exact envelope and reject cross-tenant replay,
capability rotation and stale destination incarnations **before**
payload admission. Reject oversized frames before allocation.

A receipt binds the envelope identity, stage, remote incarnation and
canonical payload hash. It is not enough to correlate only on a channel
sequence number. Invalid, expired or mismatched receipts fail closed.

## Delivery guarantees

- V1 baseline is **at-most-once handler admission within one live receiver
  incarnation** only when the receiver maintains an atomic bounded
  deduplication window. Do not promise exactly-once durable effects.
- Reconnecting after `UNKNOWN` cannot automatically replay by default.
  An explicit retry policy must require an application idempotency key,
  a receiver replay ledger with specified retention, and a deadline.
- A volatile deduplication cache does not survive process restart. Persistent
  delivery guarantees require durable receive/commit journals and replay
  recovery evidence; never infer them from an ACK.
- A reply future may be cancelled locally without cancelling a remote
  handler. If remote cancellation is offered, it is a separate authenticated
  request with a race-aware response and no rollback promise.

## Bounded resources and ordering

Charge ingress, egress, in-flight acknowledgements, retry buffers,
fragment/reassembly bytes and dedup entries against per-tenant budgets.
No unbounded queues or detached retry loops. Preserve FIFO only per
documented sender/destination stream; no total order across peers or
independent senders. CONTROL and supervisor operations must not bypass
UNTRUSTED outbound quotas.

## Mandatory negative vectors

1. Drop connection before write, during write, after remote admission,
   during handler commit, and before receipt — observe distinct FAILED /
   UNKNOWN / committed outcomes without false certainty.
2. Duplicate/reordered receipt; tampered hash; wrong destination or
   incarnation; expired capability; cross-tenant replay; reused messageId.
3. Crash and restart with volatile replay cache; prove no exactly-once
   claim. Restart with durable ledger only if the ledger is implemented.
4. Capacity-zero rendezvous, saturated ingress, cancellation during
   write/ACK, bounded timeout and restart fanout.
5. Reject non-Sendable/private arena pointers and unexpected schema
   versions before allocating an actor message.

## Verification gate

An implementation must publish executable tests against actual peer
processes, exact source tree/compiler artifact hashes, transport fault
injection, and proof of budget enforcement. JSON examples and mock
receipts are **reference-only**. Java/LLVM and cross-platform conformance
must be independently admitted.
