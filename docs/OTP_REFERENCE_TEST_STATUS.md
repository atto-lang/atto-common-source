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
