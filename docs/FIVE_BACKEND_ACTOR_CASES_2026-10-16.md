# Five-backend actor/serialization parity — executed case evidence (16 October 2026)

**This is one 13-case slice, not full Oreslang-language parity.** `P`
means the case-level proof ran and passed according to the verified log;
`U` means the *checker explicitly reported unsupported*, not failing,
passing, or proof of absent implementation. Every backend's status must be
derived from executed source tests, not static contract-text equality.

## Provenance

- Carrier: private `voxletra/voxletra-e2e`, repository ID `1311678027`.
- Successful [Actions run #38945978798](https://github.com/voxletra/voxletra-e2e/actions/runs/38945978798)
  at exact carrier commit `9334b22a60b2ed157bc86f79baccb21abbc4752b`,
  workflow `.github/workflows/five-backend-parity.yml`, event `push`.
- Executed `conformance-evidence` job `117125452377`, runner
  `1000002267`, completed successfully. Raw job logs contain all five
  per-case JSON result records, matching count summaries and final report
  `PASS all claimed case-level proofs executed; unsupported stays unsupported`.
- Source compiler/fixture identities are delegated to the exact-blob checks
  in the same run; this snapshot is **not** a replacement for examining those
  manifests, nor does it independently authenticate the log.
- Machine parser `scripts/five_backend_actor_evidence.mjs` validates five
  exact case rows and summary counts. Its offline unit tests deliberately
  reject missing/duplicate/malformed records, count discrepancies, unknown
  cases or evidence status; *neither tool establishes remote authenticity*.

## Exact 13-case execution matrix

| Contract case | Java | LLVM | .NET | Wasm | Forge |
| --- | :---: | :---: | :---: | :---: | :---: |
| actor-ref-on-wire | U | U | P | U | U |
| boolean-singleton | P | U | U | U | U |
| callable | U | U | U | U | U |
| messagepack-v2 | U | P | U | U | U |
| nested-borrow | P | U | U | U | U |
| primitive | P | U | U | U | U |
| runtime-envelope | P | U | U | U | U |
| same-id-cross-mailbox | U | U | P | U | P |
| shared-lock-on-wire | U | U | U | U | U |
| stale-generation | U | U | P | U | P |
| unknown-nominal | P | U | U | U | U |
| unregistered-json | U | U | U | U | U |
| unregistered-protobuf | U | U | U | U | U |
| **Executed passing / 13** | **5** | **1** | **3** | **0** | **2** |
| **Unsupported / 13** | **8** | **12** | **10** | **13** | **11** |

Total: **11 case/backend pairs passed, 54 explicitly unsupported, zero
reported failures.** A green workflow only verifies claimed case-level proof
execution. It does not mean Wasm failed 13 actual guest tests or that any
backend implements all 13 capabilities. Do not silently turn `U` into
`P` when copying contracts.

## Five incremental parity tasks (one backend each)

1. **Java — MessagePack v2 case-level evidence.** Compare its
   [Sendable/Serializable actor boundary PR #1060](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1060)
   against the LLVM-proved `messagepack-v2` case, then add a real
   executed source/runtime positive-or-denial test. Maintain local-only
   ActorRef/SharedLock JSON denial and separate local Sendable from wire
   Serializable; do not infer codec support from a schema file.
2. **LLVM — primitive/runtime-envelope proofs.** Keep LLVM's
   `messagepack-v2` passing result while adding actual native
   `primitive` and `runtime-envelope` tests against Java's
   existing observed cases. Start from
   [LLVM Sendable/Serializable PR #440](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/440)
   and [conformance PR #447](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/447).
3. **.NET — boolean singleton and MessagePack codec admission.** Follow
   [ActorRef JSON-deny PR #21](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/21)
   and [Native AOT execution PR #37](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/37):
   execute a canonical positive/negative fixture; record unsupported if
   the frontend/runtime cannot actually execute it.
4. **Wasm — first executable case proof.** The checker currently has
   **0/13 case-level proofs** for Wasm even though separate Wasm guest jobs
   ran. Use [Sendable source-contract PR #20](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/20)
   and [pinned LLVM-to-Wasm execution PR #35](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/35)
   to supply one canonical denial/acceptance proof (begin with forbidden
   ActorRef-on-wire), executed in an actual guest.
5. **Forge — expand beyond stale generations/mailbox identity.**
   [Forge Sendable/Serializable PR #13](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/13)
   and [native CTest scalar execution PR #30](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/30)
   should add a compiled source `primitive` or wire denial fixture with
   native guest/CTest output, preserving `same-id-cross-mailbox` and
   `stale-generation` evidence.

**Promotion rule:** require identical fixture semantics, exact pinned source
Git identity, actual backend compiler/runtime execution, checked expected
observable behavior and a successful named runner job. A missing compiler,
skipped run, syntax-only gate or mocked output remains `U`; a real failing
test must become `failed`, never `U`. This evidence is frozen to the
carrier commit listed above, not necessarily the current heads of the five
source repositories.

## Source confidentiality

This report and its machine parser contain only case **names/statuses and
provenance identifiers**. No private Oreslang compiler source, serialized
runtime bytes, source manifests, credentials or Git object contents are
exported. The separate public-source exposure incident and protected
cross-org export authorization remain open.
