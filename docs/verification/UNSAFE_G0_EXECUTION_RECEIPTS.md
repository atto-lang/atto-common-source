# Unsafe G0 five-backend execution receipts (offline integrity gate)

**Status: source-free, non-certifying.** The contract remains `contract-only`, and all backend execution statuses remain `pending`. A syntactically valid receipt is **NOT** proof that GitHub Actions ran a compiler, that the compiler executable corresponds to its reported hash, or that any Oreslang guest program executed.

The gate is `scripts/verify_unsafe_g0_receipts.py`; its adversarial selftests are `scripts/test_verify_unsafe_g0_receipts.py`. Common CI runs the selftests automatically. To inspect a future, independently collected receipt:

```sh
python3 scripts/verify_unsafe_g0_receipts.py \
  --contract contracts/v1/unsafe-boundary-v1.json \
  --receipt PRIVATE_RECEIPT_PATH.json
```

A pass prints `OFFLINE_RECORD_CONSISTENT_NOT_ATTESTED`. **Do not rename that marker to success, certified, verified, or parity.** A missing receipt is not silently treated as a successful gate.

## G0 evidence boundary

G0 requires actual source compilation for all **five** backends. The current v1 inventory has **76** cases: **63** reject, **8** accept, **5** `accept_after_g2`. Exactly **71** cases per backend are due at G0; G2 cases are excluded rather than prematurely accepted. Complete future coverage therefore requires **355 executed observations** (71 × 5). This offline validator refuses missing, duplicate, skipped, failed, runnerless or stale-head records.

Every receipt must pin raw contract bytes by SHA-256, each source fixture by its UTF-8 SHA-256, exact source head/tree (Git SHA), compiler executable SHA-256, a successful run ID/attempt, successful job ID, assigned runner identity, and successful checkout + executed-compiler steps. Rejected source must have nonzero compiler status, a diagnostic and **zero emitted IR and binary bytes**. A supported positive control must produce a compiled artifact. Guest ABI/NativeAOT distinctions and functional positive G2 features remain separate from this consistency check.

## Independent authentication remains mandatory

This checker accepts **untrusted self-reported JSON**. An attacker may fabricate a consistent report, including fake runner IDs, step names, compiler digests and fixture content; the gate does **not** authenticate GitHub APIs or prove binary provenance. A security reviewer must independently query the exact run and job from GitHub, verify the commit/tree and all blobs, compare the actual runner/steps and artifact hashes, and review that each fixture really exercises the claimed contract case. For private-carrier execution, also enforce source transfer authorization and tree/blob-mode equality before running anything. Zero-step GitHub Actions runs are `NOT_EXECUTED`.

Do not put raw private Oreslang sources, foreign pointer values, ABI secrets, or private compiler binaries into a public issue, carrier artifact, cache, or release receipt. Raw fixture source appears in the offline receipt schema to bind the hash; such receipts must be stored inside an approved private evidence boundary and redacted for public summaries.

The absence of a signed and independently verified GitHub execution receipt is a **release blocker**, even if this source-free selftest passes. Do not merge unsafe admission functionality based solely on this record-consistency gate.
