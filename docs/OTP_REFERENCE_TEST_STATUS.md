# GenServer G0 reply protocol oracle

These source-free Python fixtures are a **reference model**, not an executable
Oreslang \`GenServer\`. They characterize nine acceptance invariants:

- typed admission, bounded queue and FIFO processing;
- self-call refusal and single-use reply capabilities;
- timeout does not retract admitted work; late replies are discarded;
- generation fencing after restart, replay/double-reply refusal.

The test's opaque \`object()\` token is **not a proof of security**: real
OresVM must runtime-mint authentic actor/generation/correlation-bound reply
capabilities, enforce reserved CONTROL privileges and reject forged tokens
from compiled guest code. Nor does this test validate Java/Truffle, LLVM,
actor continuation, or freestanding \`core\` behaviour.

To run: \`python3 -m unittest discover -s tests -p 'test_gen_server_reply_oracle.py'\`.
Passage is **G0 model conformance only**, never G1 acceptance. The G1
gate remains real guest-source actor tests per Java issue #1205.

## Resource-bound oracle audit (2026-10-17)

The original Python oracle admitted new calls whenever *queue depth* dropped,
even when already-dequeued handlers had not replied. It also retained consumed
reply tokens and all pre-restart generations forever. That was an unbounded
ledger-memory leak and made the model insufficient as a GenServer capacity
reference. The revised oracle instead:

- charges **all unsettled** queued/in-flight calls to one capacity;
- keeps timed-out accepted work charged until a terminal reply or restart;
- retires settled records immediately, with replay markers on client-held
  ticket objects rather than an ever-growing server tombstone map;
- clears old-generation records on restart and rejects stale tickets;
- rejects foreign-server tokens and retains self-call/type checks.

These are deliberately source-free serial model invariants. The Python
`_ReplyTicket` fields are accessible/mutable in Python and DO NOT confer
cryptographic or OresVM capability authenticity. The real runtime must mint
non-forgeable affine reply capabilities and enforce atomic linearizable
terminal settlement, bounded resources, and CONTROL authority independently.
