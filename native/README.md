# Atto shared native allocation primitive (candidate)

`include/atto/tenant_bytes_v1.hpp` is **one common C++20 host-source implementation** intended for LLVM and Forge consumption at a pinned Git SHA. It is not an Atto language API, a sandbox, an allocator for arbitrary guest pointers, an actor scheduler, or a proof of cross-tenant safety. The host runtime must create each `Arena`, authenticate actor/tenant/generation, gate every guest import and prevent untrusted C++ execution. There is no guest-visible `Arena` constructor.

The reference `Bytes` object is move-only, holds a zero-initialized fixed-length byte region, accounts logical allocation plus a fixed header estimate against the creating arena's budget, and exposes only bounds-checked byte operations requiring the exact originating arena. Revocation rejects subsequent reads and writes. Destruction best-effort scrubs and retires quota. It does not account platform heap allocator internals, protect against untrusted machine-code memory access, guarantee physical zeroization, support cross-actor transfer, or replace the proof obligations of the spec's `OwnedBytes` ABI.

Build host tests:

```sh
cmake -S native -B /tmp/atto-common-native -DATTO_COMMON_SANITIZERS=ON
cmake --build /tmp/atto-common-native
ctest --test-dir /tmp/atto-common-native --output-on-failure
```

Compilers must consume a **source-verifiable** snapshot of this implementation (or a pinned dependency) and explicitly report missing import/typecheck/lowering/tenant-isolation support as `NOT_EXECUTED`. Native host tests do not certify `.atto` stdlib compilation or execution.
