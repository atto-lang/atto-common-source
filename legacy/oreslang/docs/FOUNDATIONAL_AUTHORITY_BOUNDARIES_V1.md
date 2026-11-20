# Foundational authority boundaries — executable reference v1

**Evidence status:** source-free Python reference oracle only. Not a compiler,
interpreter, runtime permission implementation, security sandbox, successful
Oreslang guest execution, or proof of Java/LLVM/WASM/.NET/JS parity. CI executing
this oracle must never be reported as guest conformance.

## Purpose and ownership

The Oreslang type/borrow/effect systems and actor runtime must enforce *one
shared authority invariant*: neither type erasure, an effect declaration,
message transport nor hot code replacement may mint or amplify ownership or
privileges. The independent backend compilers keep their existing source
admission gates until they pass executed guest fixtures.

`contracts/v1/authority-boundary-v1.json` enumerates allow/deny cases. The
stdlib/API signatures, normalized runtime permission names and CLI flag grammar
are not specified here. The names (`fs.read`, `net.connect`, etc.) are oracle
permission identifiers, **not** a declaration that `--allow-read` or another
CLI spelling is currently implemented. Do not confuse an actor capability with
OS-process isolation or independent WebAssembly linear memories.

## Initial fail-closed subset

- `unknown` is opaque untrusted input. Only a verified runtime predicate can
  validate a type, and this first oracle checks `int` (signed 64-bit), `bool`,
  `string` and `Option` of those scalar types.
- `any` hides a *previously validated* concrete type. In v1 it can wrap only
  copyable scalar values; it cannot store/erase borrowed data, actor refs,
  functions, mutable objects, pointers, channels or effect witnesses. It
  cannot be called or accessed through reflection.
- A compiler-owned `narrow` operation must check the full runtime type. A
  generic `any` or `unknown` is **not** itself a transport proof. Actor messages
  accept independently verified copyable scalar payloads in this oracle;
  aggregate/serialized messages await recursive ownership and schema proof.
- A process policy bounds root actors; child permissions must be subsets of
  their parent. An effect annotation is never a runtime capability.
- Ordinary I/O cannot proceed while a critical actor-state loan is live.
  This matches the conservative synchronous state-loan contract, not an
  authorization of future suspension-capable state loans.
- Hot-upgrade preflight forbids privilege increase, incompatible state without
  verified migration, active critical loans, and live children without a
  coordinated generation transition. Only successful preflight rotates the
  actor authority generation and invalidates its previous token. This oracle
  does not model in-flight tasks/messages, real route publication or rollback
  after publication; production code must additionally prove those barriers.

## Cross-backend implementation phases (not completed by this PR)

| Area | Required implementation evidence |
| --- | --- |
| Type/inference/Option | Parser + static checker rejects unguarded `unknown`/`any` and nullable-to-nonnullable coercion; exact runtime type tags in JIT, AOT and interpreter |
| Borrow/actor boundary | Negative compiler tests for aliased mutable state, unsafe transitive message fields, leaked state loans and async suspension |
| Effect + permission | Source-level effect summaries, Deno-style process permission parsing with default-deny resources, actor capability delegation, runtime checks for FFI/reflection/import/hotload and untrusted code |
| Errors and handlers | Typed `throws`, `raises`, `panics`; handling cannot forge capability; panic remains actor-fatal; exact exceptional cleanup |
| Runtime scheduling | Strict NIO host provider; noncompliant blocking or worker-offload APIs are rejected as specified in `docs/NATIVE_IO_NAMING.md` |
| Actor memory/layout | Arena provenance/quiescence and independently tested AoS/SoA/AoSoA/SoAoS, consistent with `actor-memory-layout-v1.json` |
| Tail calls | Function/method stack-space proof with cleanup and effect constraints; static recursion rejection for routine cycles |
| Hot upgrade | Atomic code publication with pinned continuations, state schema versioning/migration, rollback, capability non-escalation and lifecycle fences |

## Running the reference

```bash
python3 -m unittest discover -s tests -p 'test_authority_boundary_v1.py' -v
```

The matrix is expected to reject operations before any authority-bearing
state changes. To promote a backend, add **unchanged Oreslang guest fixtures**
with positive and negative compiler/run evidence, pin exact source and artifact
hashes, and validate the same observable semantics in Java/Graal and LLVM
separately. WASM and other targets require their own honest support matrices.

Reference dependencies: `docs/TERNARY_ANY_UNKNOWN_RUNTIME_GUARDS_V1.md`,
`docs/OWNERSHIP_BOUNDARY_AUDIT.md`, `docs/POINTER_CAPABILITY_CONTRACT.md`,
`contracts/v2/CHECKED_EXCEPTIONAL_EFFECTS_V2.md`,
`docs/MEMORY_SAFETY_AND_PERFORMANCE.md`, and `docs/NATIVE_IO_NAMING.md`.
