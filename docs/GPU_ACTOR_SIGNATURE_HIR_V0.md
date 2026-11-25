# AttoLang GPU actor typed-signature HIR v0

**Status: source-signature-only; NOT executable GPU MIR, actor state dispatch, or a GPU performance/hardware claim.**

This complements the proposed `gpu fnc` and `launch kernel(...) on gpu(device) {...}` contract in `GPU_EXPLICIT_LAUNCH_V1.md`. It does not define an alternate kernel syntax and does not change `gpu task {}` semantics. The actor remains a supervised, separately-owned actor; GPU kernels are device computations, not actor mailboxes.

## Parser → source-signature boundary

```atto
define gpu actor VectorWorker as
    state { let f32 scale: 1.0; }
    multiply(GpuBuffer<f32> buffer, f32 factor) -> void ::
        return;
    end
end
```

The source signature retains actor identity, visibility, bounded typed field slots, bounded typed method parameters, result kinds and original method-body tokens with lexer provenance. The Java candidate is `GpuActorSignatureHirV0` in [Java draft #2760](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2760). Its `TYPED_SIGNATURE_ONLY` descriptor cannot become an executable device capability. Existing LLVM [draft #1645](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1645) rejects GPU actor declarations before ordinary CPU actor lowering and does *not* yet produce this HIR.

## Types and effects

The scalar source signature admits bool, i32/i64, u32/u64, f32/f64 and the declared shape `GpuBuffer<f32>`; `void` is valid only as a method return. Buffer shape is metadata only; it never proves an allocation, device residency, a provider-issued loan, mutable uniqueness or memory fence. Host objects, actor handles, channels and arbitrary pointers are not device values.

Method bodies are retained but opaque: no body effects have been verified. A future typed MIR pass MUST reject host I/O, direct kernel mailbox sends, unbounded allocation, pointer escape, cross-actor mutable alias, and suspension inside actor critical regions; it MUST prove device residency, buffer loan and generation authority, bounded launch shape, actor epoch, and provider event quiescence. Do not infer any of these proofs from strings or JSON fields supplied by a guest.

## Actor turn and physical launch boundary

When actor-runtime integration is implemented, one actor turn owns a versioned state slot, a bounded admitted mailbox sequence, and an exclusive writer capability. A GPU kernel launch is a *separate* host-issued operation with an authenticated device/queue, allocation generations, explicit transfer records, typed write footprints, and an asynchronous device event. The runtime checks that exact generation and event before publishing staged actor state. Cancellation is not quiescence; device loss fences/poisons all affected actor generations and notifies their supervisors through CONTROL.

A physical GPU receipt requires independently compiled AttoLang guest semantics, device model/driver, kernel binary digest, real GPU event, source/compiler hashes, and nonzero executed steps. The existing OpenCL SAXPY physical probe can assess device availability, but by itself cannot certify source-level GPU actors.

## Implementation release gates

1. **G0:** Java source descriptor and cross-backend shared contract (this proposal). No guest execution.
2. **G1:** typed device-effects/ownership MIR in Java and LLVM with compile-negative tests and no executable artifact on rejection.
3. **G2:** one actor issues a physically admitted kernel using existing provider authority, explicit transfers and nonparking completion. Prove correct reply and cancellation/fence quiescence on real GPU hardware.
4. **G3:** 1,024 device-resident logical actors with independent state, bounded mailboxes, adversarial cancellation/device-loss tests and a physical GPU receipt.
5. **G4:** .NET, Wasm, Forge source parity and independent real-device evidence where those platforms support devices.

Keep all five backend physical-GPU statuses `NOT_EXECUTED` until each backend supplies its own proof.
