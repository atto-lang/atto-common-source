# Contextual allocation event contract v1 — candidate

This is a symbolic reference replay format for the strict Atto-owned allocation profile, not a binary ABI, an allocator implementation or a runtime certification. It complements contextual-value-v1 and the hybrid actor-memory contract rather than replacing their authority or layout rules.

## Compiler and runtime obligations

- Ordinary `new` resolves the active contextual allocator (actor or main control loop). `make` is value construction, not a physical-placement promise. An explicit allocator selection must be typed, live, authorized and evaluated once. No automatic fallback to a process-managed heap.
- The allocation context is carried by typed IR and task/continuation state, not derived solely from the carrier thread. Suspension does not release ownership. The main control loop owns a separate collector-free region.
- Each successful allocation reserves checked layout bytes under its context's quota; failure changes neither existing ownership nor quota. Release and retirement are deterministic, independent of a tracing collector. Real backends must separately prove alignment, physical reservation, peak charges, allocator metadata, destructors and physical reclamation.
- Context identities in this event stream represent distinct incarnations; never reuse a retired identity within a trace. Allocation identities are unique successful allocations, not addresses. A task incarnation enters once, never reuses an earlier task identity, and must resume in the same context. Multiple turns of a logical task use distinct incarnation IDs unless represented by suspend/resume. This bounded full-process replay requires actors to open while main is live and retire before main. It does not model detached services that outlive the main loop.
- The strict replay admits no host allocation event and no GC event. Explicit authorized host interop is a separate profile/measurement; a host runtime collecting unrelated objects is not a guest collection. Unsupported lowering must fail before artifact publication.

## Reference event shapes

All events are closed records with an `op`. The reference consumes already-parsed records from a trusted test harness; duplicate-key detection and authentication belong to that harness. Numeric inputs are nonnegative safe integers, allocation sizes and quotas are positive, and alignments are powers of two up to 65536 in this bounded replay. Arithmetic uses BigInt.

| Operation | Fields beyond op |
| --- | --- |
| open | context, kind (main/actor), quota |
| enter / suspend / resume / leave | context, task |
| alloc / deny | context, task, allocation, bytes, align, placement (contextual) |
| release | context, task, allocation |
| pin / unpin | context, pin |
| retire | context |

The charge is the rounded-up payload size, not a physical RSS measurement or proof of the allocator's actual footprint. The deny event models quota failure only, not native malloc failure or arbitrary placement failure. The model rejects retirement with active/suspended tasks, pins or live allocations. A full trace terminates with every context retired. The model returns `certified:false` deliberately.

## Backend work required

Java/GraalVM and .NET must observe managed allocations attributable to actual guest execution (including wrappers, boxes, arrays, strings, closures, exceptions and continuation objects). LLVM/Forge/Rust/Cranelift must wire typed allocation and drop lowering to their real native allocators. Wasm/JS must use explicit linear storage for owned guest payloads and report host overhead separately. This replay does not prove any of those implementations.

Run `node tools/contextual-allocation-events-v1.mjs` for reference self-tests, including a 10,000-operation reuse trace and malformed/invalid lifetime cases. CI must bind the actual compiler, artifact and trace to exact source identities before using any eventual backend receipt. Do not mark a backend supported from reference execution alone.
