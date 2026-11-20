# ByteBuffer v1 — canonical Atto library implementation boundary

**Status:** staged foundational `.atto` core endian helpers; **not a compiled or runnable ByteBuffer implementation**.

Normative contract: [atto-spec/language/byte-buffer-v1.md](https://github.com/atto-lang/atto-spec/blob/feat/byte-buffer-contract-v1-20261119/language/byte-buffer-v1.md).
Cross-backend fixture registry: [atto-platform-conformance/contracts/byte-buffer-v1.json](https://github.com/atto-lang/atto-platform-conformance/blob/feat/byte-buffer-contract-v1-20261119/contracts/byte-buffer-v1.json).

## Where the implementation must live

1. **core:** `stdlib/core/u32_endian.atto` is the first backend-neutral, allocation-free implementation of 32-bit bit-lane extraction and assembly. It uses only integer bitwise expressions. Its `u32_pack_*` helpers mask their byte arguments, intentionally; they are low-level bit operations, **not** validating public `ByteBuffer` writes.
2. **alloc:** implement a canonical `stdlib/alloc/byte_buffer.atto` type with actor-/tenant-owned byte storage, a validated allocator ABI and exact-bound reads/writes; no implicit OS, libc, GC or ambient host privileges. Do **not** create a type stub that compiles but calls an unchecked host buffer.
3. **std:** expose the public portable `std.buffer` module and `ByteBuffer.allocate`, with `read_u8`, `read_u16_le/be`, `read_u32_le/be`, `write_u8`, `write_u16_le/be`, and `write_u32_le/be`. The source should delegate through the canonical alloc/core implementation and use explicit capability/allocator effects as necessary.
4. **backends:** wire the allocator primitive, owned byte representation, borrow-aware view descriptors, memory-quota enforcement, and lowerings. Do not implement byte semantics solely in JS, Java, C#, C++ or Rust while leaving the canonical .atto library uncompiled.
5. **conformance:** compile the exact `.atto` fixtures for each compiler, run the resulting guest artifact, capture positive exits and negative typed errors, record code/tree SHA and toolchain; host reference cases cannot be promoted to a pass.

## Storage ABI requirements

- Logical length is byte-granular and immutable for the initial fixed-size allocation profile.
- Allocation returns an owned zero-filled region; record tenant owner, generation, capacity, logical length, allocation/deallocation authority and nonescaping borrowed view mode.
- A write is a non-suspending and non-allocating transaction: check writer capability, range and offset first; then write the exact bytes; a failure leaves the region unchanged.
- An offset is checked without adding width first (`offset <= length - width`, after validating width and nonnegative offset). Handle `int` maximum offset without integer overflow.
- A read must produce the same scalar on 32-bit and 64-bit hosts, little-endian and big-endian systems, JIT and AOT.
- Moving/disposing storage invalidates stale views; zero-copy across actors is never ambient, and no host pointer is exposed by default.
- A freestanding `core` import does not cause heap allocation. The `alloc` layer needs an explicitly provided allocator. The `std` facade must not quietly bypass this dependency boundary.
- `u64` reads/writes remain explicitly unsupported until a correct unsigned 64-bit type/representation is specified.
- Only publish `ByteBuffer` as supported after the **real** library source, runtime memory substrate, typechecker and guest tests succeed.

## Existing work to integrate, not overwrite

- `atto-common-source#10`: bounded buffer pool contract, related allocation/lease work. Not the `ByteBuffer` implementation.
- `atto-common-source#23` and `atto-spec#42`: core/alloc/std layering policy.
- `atto-spec#7`: actor-owned pools/transferable leases.
- Legacy `oreslang-source.java#2934`: owned `Bytes` over NIO2 with actual guest tests; inspect and migrate applicable allocator, ownership and I/O coverage to Atto Java instead of claiming this proposal already ports it.

## Evidence

The current `canonical-stdlib-v1.json` source manifest SHA-pins `identity.atto` and `u32_endian.atto` and preserves its five-backend `NOT_EXECUTED` verification boundary. The conformance registry separately inventories **all ten** known `atto-source.*` backends, also `NOT_EXECUTED`. Host byte-identity checking does not demonstrate compiler acceptance of bitwise operators or endian guest behavior.
