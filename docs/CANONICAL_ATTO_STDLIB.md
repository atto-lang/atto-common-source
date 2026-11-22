# AttoLang canonical .atto standard-library bytes — first small slice

Roadmap #85; initial review candidate, not a claim of compiler-backed portable standard-library implementation.

Canonical source now lives at stdlib/core/identity.atto, pinned in contracts/canonical-stdlib-v1.json by exact UTF-8 byte size and SHA-256. The one function is intentionally side-effect-free, has no host-specific I/O or runtime dependency, and is a minimal precursor to core, alloc, actor and std modules.

src/canonical-stdlib-bytes.mjs compares the canonical bytes with caller-supplied source copies for the five target labels Java/GraalVM, LLVM, .NET, Wasm, Forge. It requires all targets, exact paths and the exact bytes, rejecting missing sources, a changed byte, CRLF/BOM, malformed UTF-8, hash drift and unsafe paths. It NEVER treats a renamed .ores file or a normalized/reformatted copy as equivalent.

IMPORTANT EVIDENCE BOUNDARY: Current tests use five local simulated byte copies. Even with sourceByteIdentical=true, returned compilationExecuted=false, guestParityCertified=false and releaseAuthorized=false. No files were written to compiler repositories; no cross-org private source was mirrored. The five target entries are explicitly NOT_EXECUTED.

To finish #85: have each compiler take the reviewed canonical .atto source from a pinned, authorized dependency/artifact, verify content identity before build, link it with only minimal host primitives, execute actual source guest test cases and negatives on exact committed compiler trees with nonzero CI steps, demonstrate actor-owned heap/async-only I/O boundaries, and obtain independent source/export authorization and review. A module present on disk is not proof it compiles.

Source-free local test: node --test tests/canonical-stdlib-bytes.test.mjs
