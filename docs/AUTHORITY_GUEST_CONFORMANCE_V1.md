# Authority guest conformance v1 — candidate source fixtures

**Status:** contract + source-file integrity checks. Neither Java/Graal nor LLVM guest
compiler execution has been observed for this exact corpus. Do not interpret
passing `test_authority_guest_gate.py` as backend acceptance, safety, runtime
permission enforcement, or executable AOT proof.

Fourteen exact Oreslang `.ores` files, source blob SHA-1s and expected compiler
admission phases live in `fixtures/authority-guest-v1/cases.json`. The sources
are adaptations of exact positive/negative Oreslang test programs in Java draft
PR #1176 (`AnyUnknownTernaryGuardTest`), Java draft PR #1290
(`CheckedEffectsTest`), and `UntrustedActorTest`. They are staged for an
unchanged-input compiler comparison, not considered supported on `main`.

## Evidence and admission model

Each case carries an expected `accept` or `reject`, with a specific
`parser`, `typecheck`, or `capability` phase. A parser rejection does **not**
satisfy an expected ownership, typechecking, or capability denial. For valid
fixtures, passing parse alone does not satisfy type-check admission. The
capability cases require the compiler's actual isolate/capability checker,
not merely parsing.

Compiler adapters must report exact fixture Git blob SHA, compiler revision,
actual invocation command, tool exit code and meaningful diagnostic for rejected
fixtures. `scripts/authority_guest_gate.py` checks integrity and
internal consistency of supplied reports; it does **not** launch backends or
authenticate a report. Do not submit synthetic unit-test reports as proof.

The existing shared `scripts/exact_source_gate.py` requires executed workflow
jobs and verifies source tree identity, which must additionally gate any
cross-org CI mirror. A private destination must be authorized and must
successfully execute a source-free runner probe **before** copying private
source. No token, secret or private source should be added to public test repos.

## Current integration boundaries

- Java/Graal `any/unknown` feature branch: PR #1176, not verified on
  its exact head in Actions.
- Java/Graal checked exceptional effects: PR #1290, independently staged;
  these two Java feature branches are **not the same compiler revision**.
- Java/Graal untrusted capability gate: existing `UntrustedActorTest`
  exercises parser + `CapabilityChecker`; this is not CLI Deno permission
  enforcement.
- LLVM: support for these exact syntax and checks must be reported case by
  case. Rejections caused only by missing grammar or missing tools do not
  establish semantic parity.
- Additional actor-critical suspension, actor state loan, FFI dynamic taint,
  capability-minting and hot-upgrade guest fixtures require their own
  validated syntax and backend admission; the 14 cases do not claim them.

## Local metadata test command

```bash
python3 -m unittest discover -s tests -p 'test_authority_guest_gate.py' -v
```

No CLI permissions, type-erased actor message transport, or hot reload runtime
behaviors are certified by this suite.
