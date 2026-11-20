# ExecutionProfileDigest — v1

**Status: PROPOSED / cross-backend cache and run-fence contract.** This digest identifies the exact execution semantics selected for a compiled model plan. It is separate from the portable `GraphDigest`: the same graph may have multiple backend/target plans.

## Digest

`ExecutionProfileDigest = hex_lower(SHA-256(canonical_execution_profile_v1_bytes))`.

The byte stream begins with exact ASCII `ORESLANG-MODEL-PROFILE-V1\0`, followed by `u32be(1)`.

Encode these fields in order as `u32be(UTF-8 byte length) || UTF-8 bytes`:

1. `backendId`
2. `backendSemanticVersion`
3. `compilerSemanticVersion`
4. `targetTriple`
5. `dataLayout`
6. `runtimeAbi`

Then encode:
- numeric mode as u8: strict=0, ieee=1, fast=2;
- deterministic flag u8(0|1);
- allocation policy u8: preallocated=0, bounded=1, dynamic=2;
- freestanding flag u8(0|1);
- device presence u8; if 1, encode `deviceAbi` as a string;
- numeric feature count u32, then feature strings in **strict ASCII byte-sorted order**.

Numeric features are unique tokens matching `^[A-Za-z0-9_.+-]{1,64}$`. Reject duplicates or non-canonical ordering rather than silently sorting caller input. All strings must be valid Unicode scalar sequences and profile strings are bounded to 256 UTF-8 bytes.

## Semantics

The profile digest binds code-generation semantics that can change results or safety without changing the portable computation graph: backend/runtime semantic versions, target/data layout, numeric mode/features, determinism contract, allocation policy, freestanding selection, and optional device ABI.

It deliberately excludes graph content, instance identity, parameter version and run ID. A compiled-plan cache key binds at minimum `(GraphDigest, ExecutionProfileDigest)` and may additionally bind toolchain/build provenance.

A request for a stricter profile never silently falls back. For example, a preallocated/freestanding request fails if the admitted graph requires dynamic allocation or hosted services.

## Golden vectors

Normative vectors live at `contracts/v1/model-graph/execution-profile-digest-v1-vectors.json`. The portable reference profile is 127 bytes and hashes to:

`8440c7b53174d2d0dc6a6ff6e1fda662e409f4e21f6ce647eea38b87b3ff9695`

Changing numeric mode, numeric features, or target must change the digest. Java/Graal and LLVM must independently reproduce the vectors before compiled-plan cache parity is claimed.

This digest is an identity/checksum, not an authorization token or attestation.
