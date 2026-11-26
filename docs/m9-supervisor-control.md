# M9 supervisor CONTROL from compiled worker continuation

**Status:** candidate runtime/host contract stacked on the M8 FAILED lifecycle. No automatic multi-backend parity claim.

A genuine host actor receives already-compiled `.atto` M8 guest Wasm bytes and executes the guest on a worker, with an explicit `generation` and one accepted mailbox `message_id` at a time. A guest checked arithmetic trap persists `FAILED` and a fault code; the worker reports the fault to the host; **the host**, not the guest, fences admission, settles the in-flight DATA as FAILED, abandons queued accepted DATA, and independently publishes one priority supervisor **PANIC CONTROL** notice. A guest `m8_fault()` value alone is insufficient evidence of delivered CONTROL.

The host should maintain a bounded DATA inbox independent of CONTROL capacity, with monotonic actor/turn generations and strict serial receive. The exact conservation equation applies at every transition:

`accepted = completed + failed + abandoned + queued + in_flight`

For YIELD, `in_flight` remains 1 with a saved continuation PC; yield never admits a duplicate. STOP must fence new DATA and drain all already-admitted queued and suspended continuations before actor retirement. Repeated STOP coalesces, while a later PANIC supersedes STOP even if STOP was delivered. PANIC must not wait for free DATA slots; it invalidates outstanding frame work and prevents new guest resume. External worker termination or forged completion follows the same terminal accounting path, with distinct fault codes.

CONTROL notice fields (required): kind STOP/PANIC, actor_id, generation, supervisor_id, message_id, fault_code, reason. Fault 1/2 are signed i64 addition/index checked traps; 100/101 are worker exit and guest protocol violations. The wire format uses integers for identity and fault, short stable strings for kind/reason. Hosts must not allow arbitrary untrusted worker payloads to forge actor identity, generation, or completed turn; bind responses to host-owned actor references and message sequence.

**Hard requirements for evidence:** real compiler-emitted executable guest code, actual OS/browser Worker dispatch and trace, saturated bounded DATA and independently admitted CONTROL, exact once failed/abandoned settlement, STOP drain, PANIC after STOP, stale worker/messaging generation rejection, real native/compiler and Wasm execution, and exact source Git tree SHA on private Actions when source-org jobs cannot execute. Carry only exact SHA Git blobs and never cross-checkout private source with carrier token.

**Nonclaims:** this initial profile may use one worker per actor; it is not a true bounded worker pool, arbitrary guest receives, full language `await/select`, formal ownership across suspension, LLVM/Forge/.NET/native equivalence or hard real time.