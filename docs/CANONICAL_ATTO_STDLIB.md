# AttoLang canonical .atto standard-library bytes — first small slice

Roadmap #85; initial review candidate, not a claim of compiler-backed portable standard-library implementation.

Canonical source now lives at stdlib/core/identity.atto, pinned in contracts/canonical-stdlib-v1.json by exact UTF-8 byte size and SHA-256. The one function is intentionally side-effect-free, has no host-specific I/O or runtime dependency, and is a minimal precursor to core, alloc, actor and std modules.

src/canonical-stdlib-bytes.mjs compares the canonical bytes with caller-supplied source copies for the five target labels Java/GraalVM, LLVM, .NET, Wasm, Forge. It requires all targets, exact paths and the exact bytes, rejecting missing sources, a changed byte, CRLF/BOM, malformed UTF-8, hash drift and unsafe paths. It NEVER treats a renamed .ores file or a normalized/reformatted copy as equivalent.

IMPORTANT EVIDENCE BOUNDARY: Current tests use five local simulated byte copies. Even with sourceByteIdentical=true, returned compilationExecuted=false, guestParityCertified=false and releaseAuthorized=false. No files were written to compiler repositories; no cross-org private source was mirrored. The five target entries are explicitly NOT_EXECUTED.

To finish #85: have each compiler take the reviewed canonical .atto source from a pinned, authorized dependency/artifact, verify content identity before build, link it with only minimal host primitives, execute actual source guest test cases and negatives on exact committed compiler trees with nonzero CI steps, demonstrate actor-owned heap/async-only I/O boundaries, and obtain independent source/export authorization and review. A module present on disk is not proof it compiles.

Source-free local test: node --test tests/canonical-stdlib-bytes.test.mjs

## Core / alloc / std expansion candidate (2026-11-20)

The canonical manifest now SHA-256-pins seven `.atto` sources. New pieces are:
- `stdlib/core/size_math.atto`: allocation-free checked bounded add/multiply and integer clamping.
- `stdlib/alloc/byte_region.atto`: actual Atto-language class and method bodies wrapping a **missing** sealed `OwnedBytes` runtime primitive; bounds/byte validation and mutable-receiver API.
- `stdlib/std/byte_ops.atto`: actual Atto-language byte-region equality loop that imports the alloc module, without I/O.

Existing `stdlib/std/buffer.atto` still talks directly to `OwnedBytes`. Migrating its storage onto `alloc.ByteRegion` requires type-checker/constructor/import support and is **not** claimed here. These algorithms are source candidates, not compiled guest behavior. The `core -> alloc -> std` import DAG is source-audited only, not enforced by a compiler on this branch.

`native/include/atto/tenant_bytes_v1.hpp` is the single proposed C++20 native source for LLVM/Forge consumption, with independently testable bounds, zeroing, budget accounting, revocation and per-arena authority checks. The host test is under `native/tests/` and can run with CMake plus ASan/UBSan. This C++ reference **does not** implement the production sealed `OwnedBytes` ABI, complete allocator accounting, arbitrary untrusted machine-code isolation or cross-actor transfers. Current LLVM and Forge backend branches do **not** yet import this native file.

Before any parity claim, verify each backend consumes the exact canonical source at a pinned commit, links a sealed allocator with nonforgeable actor/tenant authority, performs real guest positive/negative executions, and supplies exact-head CI receipts. Unsupported backends must report unsupported or not executed, not pass.
