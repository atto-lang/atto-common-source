# Atto shared native allocation primitive (candidate)

`include/atto/tenant_bytes_v1.hpp` is **one common C++20 host-source implementation** intended for LLVM and Forge consumption at a pinned Git SHA. It is not an Atto language API, a sandbox, an allocator for arbitrary guest pointers, an actor scheduler, or a proof of cross-tenant safety. The host runtime must create each `Arena`, authenticate actor/tenant/generation, gate every guest import and prevent untrusted C++ execution. There is no guest-visible `Arena` constructor.

The reference `Bytes` object is move-only, holds a zero-initialized fixed-length byte region, accounts at least one physically reserved byte plus a fixed object header estimate against the creating arena's budget, and exposes only bounds-checked byte operations requiring the exact originating arena. Revocation rejects subsequent reads and writes. Destruction or trusted idempotent `drop_now()` best-effort scrubs and retires quota. It does not account platform heap allocator internals, protect against untrusted machine-code memory access, guarantee physical zeroization, support cross-actor transfer, or replace the proof obligations of the spec's `OwnedBytes` ABI.

Build host tests:

```sh
cmake -S native -B /tmp/atto-common-native -DATTO_COMMON_SANITIZERS=ON
cmake --build /tmp/atto-common-native
ctest --test-dir /tmp/atto-common-native --output-on-failure
```

Compilers must consume a **source-verifiable** snapshot of this implementation (or a pinned dependency) and explicitly report missing import/typecheck/lowering/tenant-isolation support as `NOT_EXECUTED`. Native host tests do not certify `.atto` stdlib compilation or execution.

## Local execution and limitations

On the current identical C++ header/test Git blobs in common-source, LLVM and Forge, the native test compiled and executed locally under GCC and Clang with `-std=c++20 -Wall -Wextra -Werror -pedantic -UNDEBUG -fsanitize=address,undefined`, both `-O1` and `-O2` (4/4 passed). The negative-size code now differs from invalid-owner; zero-length allocations charge one physical byte; cancellation `drop_now()` reclaims quota exactly once in the host test. CI runs in the source organization have no executed steps. None of these results prove an untrusted actor's memory confinement, correct compiler-generated guest calls, or cancellation-safe loan release in an Atto executor.
