# Portable ModelGraph digest — v1

**Status: PROPOSED / cross-backend conformance contract.** This digest identifies the portable, fully resolved semantic graph. It is not a signature, authorization token, package trust proof, execution-profile digest, instance identity, graph generation, parameter version or run identity.

## Goal

Java/Graal and LLVM must derive the same digest for the same admitted model semantics even if their internal object layouts, pointers, symbol-table IDs or temporary node labels differ. A model cache/hot-reload fence must never use a backend-private object hash or raw address as graph identity.

The v1 digest is:

```text
hex_lower(SHA-256(canonical_model_graph_v1_bytes))
```

The SHA-256 input begins with the exact ASCII domain separator:

```text
ORESLANG-MODEL-GRAPH-V1\0
```

followed by unsigned integer `1` encoded as four-byte big-endian.

## Canonical primitives

- `u8`: one unsigned byte.
- `u32`: four-byte unsigned big-endian integer.
- `u64`: eight-byte unsigned big-endian integer.
- `string`: `u32(byte_length) || UTF-8 bytes`. UTF-8 is the exact Unicode scalar sequence; v1 performs **no Unicode normalization**, so canonically distinct source strings remain distinct. Ill-formed surrogate/code-unit input must be rejected before digesting.
- a 64-hex-character SHA-256 digest field is decoded to its 32 raw bytes before encoding.
- signed `i64` constants are encoded as eight-byte two's-complement big-endian.
- finite `f64bits` constants are encoded as the exact eight raw IEEE-754 bytes represented by the canonical 16-hex-digit bit string.
- counts use `u32`; bounded byte/extents use `u64`. Inputs outside the admitted v1 bounds reject before hashing; they do not truncate or wrap.

Stable enum ordinals are part of the ABI:

```text
effect:      pure=0, io=1, network=2, random=3, clock=4, actor=5, ffi=6, suspend=7
provenance:  verified-ores=0, trusted-native=1
allocation:  none=0, scratch=1, dynamic=2
dtype:       bool=0, i32=1, i64=2, f32=3, f64=4
layout:      scalar=0, contiguous=1
constant:    bool=0, i64=1, f64bits=2, string=3, symbol=4
port kind:   buffer=0, nominal=1
```

Changing any ordinal requires a new digest version.

## Canonical graph byte sequence

After the prefix/version:

1. encode `modelTypeId` as a string;
2. encode node count as `u32`;
3. visit nodes in the compiler-defined canonical topological/source order;
4. encode output count and output node ordinals.

Temporary HIR node IDs are **not** hashed. Before encoding, map every admitted node ID to its zero-based canonical ordinal. Input references and graph outputs encode that `u32` ordinal. Therefore renaming `source/tax/round` to `n0/n1/n2` without changing topology does not alter the digest.

### Ordered v1 external input boundary

For the ordered source subset, a model may be unary at runtime without adding a fake source operator. The **first** resolved operation may have exactly one signature input port while its graph dependency list is empty; that unmatched signature slot is the model's external `run(input)` boundary. The port is already hashed as part of the operation signature. Subsequent ordered-v1 operations have one graph parent and one signature input. A zero-input first operation remains legal for generator/constant models.

Do not infer arbitrary missing dependency slots in later nodes. General multi-input/named-input DAG source syntax requires an explicitly versioned extension.

The `externalInput` golden vector demonstrates this rule.

For each node encode, in this exact order:

1. nominal operation ID string;
2. operation ABI string;
3. 32 raw bytes of `implDigest`;
4. provenance ordinal `u8`;
5. effect ordinal `u8`;
6. VJP-available flag `u8(0|1)`;
7. declared static-constant-kind count `u32`, then one constant-kind ordinal `u8` each;
8. actual canonical static-argument count `u32`, then each constant;
9. dependency count `u32`, then each parent canonical ordinal `u32` in argument order;
10. signature input-port count `u32`, then each exact input port in argument order;
11. exact output port;
12. scratch upper bound `u64`;
13. `freestanding` flag `u8`;
14. allocation ordinal `u8`;
15. deterministic flag `u8`.

An operation's `implDigest` must cover every compiler/linker-owned semantic artifact whose replacement can change admitted computation, including its registered differentiation implementation when the registry claims VJP support. Thus a VJP implementation change cannot retain an old graph digest merely because forward ABI stayed constant.

### Constants

A constant starts with its kind ordinal.

- bool: `u8(0|1)`;
- i64: exact signed two's-complement `i64`;
- f64bits: eight raw bits;
- string/symbol: canonical string encoding.

Defaults are resolved before this stage. Expressions, object identities, pointers, callbacks, capabilities and ambient state never enter the digest.

### Ports

A buffer port encodes:

```text
u8(0)
dtype:u8
rank:u8
extent[rank]:u64
layout:u8
has_unit:u8
unit:string            # only if has_unit=1
```

A missing layout is canonicalized before hashing to `scalar` for rank zero and `contiguous` otherwise. A present but inconsistent layout is rejected rather than normalized.

A nominal port encodes:

```text
u8(1)
typeAbi:string
bytes:u64
```

## Included versus deliberately excluded

The graph digest binds model nominal type identity, ordered topology, operation identity, ABI, implementation digest/provenance, exact ports, static configuration, effects, VJP availability, conservative scratch bound and compiler-owned portable operation profile.

It deliberately excludes graph generation, instance identity, parameter values/version, run ID, execution-profile digest, backend semantic version, target triple, machine code and backend cache metadata. Those are separately fenced as specified by `MODEL_GRAPH_LOWERING_ABI_V1.md`.

If a compiler specializes generated code to concrete parameter contents, that specialization belongs in the **compiled-plan cache key**, not by mutating the portable graph digest.

## Fail-closed rules

A digest may be emitted only after the graph has passed structural, type, effect, provenance, constant, resource and profile validation. Never hash untrusted guest metadata and then treat the resulting digest as proof that the metadata was valid.

Duplicate/forward/cyclic node references, unknown operations, noncanonical constants, invalid UTF-8 scalar input, integer overflow, nonfinite floating constants, malformed digest fields and unsupported enum values are rejection conditions.

The digest is an identity/checksum, not a MAC. Trust still comes from verified compiler/linker provenance and package/toolchain policy.

## Golden vector

The normative test vector is in `contracts/v1/model-graph/digest-v1-vectors.json`. The first pricing graph must produce:

```text
e4b3337bd3e8b71d8f062afc7fcad5646fa8ad567bfe009e3d02f599b3ee833c
```

Changing only `tax_bps` from 1500 to 1501 must produce:

```text
1dcfd1569621a30e53c969b9bf0e2add7fe94a04c2bf4474fae821555996d21b
```

Changing only the tax operation implementation digest must produce:

```text
cdb96a21464b7fbeeaa3c7fade033780785c7849bf15a6033634b060b597e5ce
```

Renaming only temporary node IDs must preserve the first digest.

Both Java and LLVM must pass these vectors before graph-digest parity is claimed.
