# ByteBuffer v1 — canonical Atto library implementation boundary

**Status:** concrete canonical .atto endian/bounds code and source-first std.buffer.ByteBuffer method bodies staged in Draft. NOT COMPILED, LINKED OR GUEST EXECUTED: sealed OwnedBytes, typed Error subclasses, module resolution and borrow-aware method lowering remain outstanding.

Normative contract: [atto-spec/language/byte-buffer-v1.md](https://github.com/atto-lang/atto-spec/blob/feat/byte-buffer-contract-v1-20261119/language/byte-buffer-v1.md).
Cross-backend fixture registry: [atto-platform-conformance/contracts/byte-buffer-v1.json](https://github.com/atto-lang/atto-platform-conformance/blob/feat/byte-buffer-contract-v1-20261119/contracts/byte-buffer-v1.json).

## Where the implementation must live

1. **core:** `stdlib/core/u32_endian.atto` and `stdlib/core/byte_bounds.atto` implement pure endian assembly and overflow-safe range/unsigned admission. It uses only integer bitwise expressions. Its `u32_pack_*` helpers mask their byte arguments, intentionally; they are low-level bit operations, **not** validating public `ByteBuffer` writes.
2. **alloc:** implement the sealed compiler/runtime OwnedBytes primitive specified in `contracts/owned-bytes-runtime-abi-v1.json`; it governs per-tenant/actor byte regions, quota, zeroization, generation and lifetime. This primitive does not yet exist and must never expose unrestricted guest host pointers.
3. **std:** `stdlib/std/buffer.atto` now stages source-level `ByteBuffer.allocate`, `read_u8`, `read_u16_le/be`, `read_u32_le/be`, `write_u8`, `write_u16_le/be`, and `write_u32_le/be`. Bounds and endian operations are implemented in Atto; the `std` source now delegates raw byte calls to `alloc.ByteRegion`, which alone consumes the sealed `OwnedBytes` runtime primitive. It is not compiled/executable.
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

The current `canonical-stdlib-v1.json` SHA-pins seven `.atto` modules spanning core, alloc and std, with all eleven current backend entries `NOT_EXECUTED`. Host byte-identity checking does not demonstrate compiler acceptance of bitwise operators or endian guest behavior.

## Current source milestone and remaining gates

- Source staged: checked byte bounds, unsigned width predicates, endian pack/unpack, u8/u16/u32 public read/write algorithms, constructor/factory source and pinned exact-byte manifests.
- NOT IMPLEMENTED: sealed runtime OwnedBytes for any backend; typed Buffer*Error classes/linkage; compiled module imports; executable guest methods; ownership/loan integration; try_* Result adapters; borrowed zero-copy views and pooled storage.
- Source validation: node --test tests/canonical-stdlib-bytes.test.mjs tests/byte_buffer_source_contract.test.mjs tests/alloc_core_std_source.test.mjs.
- Rust host reference: rustc --edition=2021 --test -D warnings tests/byte_buffer_reference.rs -o /tmp/atto-byte-reference && /tmp/atto-byte-reference. Neither is a compiled Atto guest test.
- The #23 layering guard and #150 admission hardening are incorporated in the reconciled #30 candidate; the manifest now inventories seven reference sources. Retest the integrated head before merging; never weaken effect or import checks.
- For secure runtime admission: prove actor/tenant isolation, exclusive loans, stale generation rejection, typed error identity, zeroized reuse, quota accounting, fail-atomic ordinary errors, no host fallback and full AOT where applicable.
- Checked alternate private CI carrier's explicit allowlist does not currently authorize copying atto-common-source. Do not mirror private source without authenticated security approval. Any zero-step CI is NOT_EXECUTED.

The current `ByteRegion.empty()` constructor is intended to avoid an extra zero-length allocation when constructing `std.ByteBuffer`. The C++20 native host-model allocator has an explicit, idempotent `drop_now()` teardown path for trusted cancellation handlers; it is not exposed as an unchecked guest operation. Actor suspension/loan checks, quota enforcement under an actual TenantVM, and compiler import/link integration are still required.

Production implementations of these public semantics remain owned by each `atto-source.*` compiler. The shared byte manifest pins reference fixtures only; independently implemented backend libraries need behavioral guest parity, not identical source bytes.
