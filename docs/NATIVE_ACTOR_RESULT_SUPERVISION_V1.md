# Native Atto actor results, supervision and typed services — conformance v1

**Status:** executable **selected-file Java/JVM actor output sample** plus a
machine-checkable architecture contract; NOT a complete `SupervisorActor` or
`ServiceActor` implementation and NOT five-backend parity.

## Verified milestone

Source-identical `java-closed-world-output-readback.atto` comes from
[Java #2981](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2981).
It is a real Atto actor with one sealed state container, runtime-only
`external mtd init/receive`, critical state updates, and
`p.send(mail.value)` via a bounded actor output channel. It has an
**experimental** terminal `return a.output_value();` result projection.
The real JVM compiler/actor test carrier executed 94/94 focused tests,
including this guest output, but the carrier contains a selected-file mirror,
not the complete upstream Java Git tree.

The experimental `output_value()` method must not become the general
canonical Atto API. Correct future compilation means actual typed
`spawn`/ActorRef/async output stream/await continuations, with no blocking
actor or Mailman carrier and no arbitrary guest host callback.

## Native SupervisorActor — runtime-authenticated CONTROL

The real guest-facing `SupervisorActor` must be defined as native Atto code,
with code generation enforcing a trusted runtime supervisor identity. A class
declaration or `implements Supervisor` is **never** enough to mint CONTROL
authority. Child bindings require immutable parent and incarnation provenance;
parent USER mailbox saturation must not drop terminal notices. Per-child panic
failure receipts are lossless and acknowledged before child physical DONE.
Panic cannot be intercepted by its dying actor; stale generations cannot
restart or commit. Failed physical retirement quarantines the generation.

Existing native LLVM host tests in #1705 and Java host tests in #2977 are
useful *substrates* but are not compiled native Atto `SupervisorActor` guest
tests. The separate five-backend conformance status remains **NOT_EXECUTED**.

## Native ServiceActor<Request,Reply> — owned replies

The ordinary `Service<Request,Reply,E>` trait is behavioral, not mailbox
authority. A checked native service actor must acquire its actor reference,
mailbox sender, and reply-port identity from the runtime. Each reply port is
linearly owned, settled exactly once, and reclaimed on cancel, timeout, close,
panic and restart. Success from bounded mailbox admission is **not** a durable
storage acknowledgment.

## Cross-backend acceptance criteria

For each Java/GraalVM, LLVM, Wasm, Forge and .NET target:

- Compile and execute **native guest source** with independently verified
  exact source-tree/fixture Git identity.
- Demonstrate two actor instances, output values and sealed-state isolation.
- Check all forbidden marker authority, output forgery, state-alias escape,
  suspension across critical loans and stale-incarnation scenarios.
- Stress saturated DATA/USER plus trusted CONTROL, per-child panic/STOP
  receipts, restart ordering and exactly-once wake/quota accounting.
- Prove typed request/reply ownership and cancellation, not merely output
  stream emission or host-only supervisor tests.
- Run runtime-specific negative admission suites where compiler lowering is
  still unsupported, and report **NOT_EXECUTED** for unsupported positive
  features rather than substituting mocks.
- Execute native AOT/LLVM with real compiler optimization and sanitizers;
  source-only Node integrity tests never count as guest execution.

**Carrier security:** do not copy private source into arbitrary organizations.
Require each destination and test plan to be explicitly approved, pin exact
Git blob identities, avoid cross-org checkout tokens, and retain immutable
runner receipts. No CI workaround permits lowering security or bypassing
independent review.
