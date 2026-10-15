# Read-only, cross-backend formatter workspace audit

The five independent Oreslang source backends are `oreslang-source.java`,
`oreslang-source.llvm`, `oreslang-source.wasm`, `oreslang-source.forge`
and `oreslang-source.net`. Their related contract and canonical formatting
repositories are `oreslang-common-source` and `oreslang-format`.

## Objective and safety boundary

Audit **all** `.ores` files in these seven repositories using the exact same
reviewed `oresfmt` executable. Never format a live Git working tree and
**never rewrite another pull request** as a side effect of this audit.

The script reads each source, writes a private copy to a temporary directory,
invokes `oresfmt --stdout` on the copy, then checks the output with a second
temporary pass. It reports whether the source would change, formatter
rejections, instability, and per-input SHA-256. It also verifies the source
file remained unchanged. Symlinked files and directories are not traversed.

No `oresfmt --write`, Git mutation, commit, force-push, PR update, or
normalization of negative compiler fixtures is performed.

## Usage

Provide a workspace directory with the seven repositories checked out as
sibling folders. Checkout credentials and fetching repositories are the
caller's responsibility; in particular, a GitHub Actions GITHUB_TOKEN from
another organization cannot silently read private source repositories.

```sh
python3 -m unittest discover -s tests -p 'test_audit_formatter_workspace.py' -v

python3 scripts/audit_formatter_workspace.py \
  --workspace /path/to/ores-truffle-oreslang \
  --formatter /absolute/path/to/reviewed/oresfmt \
  > formatter-workspace-audit.json
```

For reproducible review, pass `--formatter-sha256 EXPECTED_BINARY_SHA256`
and record the input seven repository Git commit/tree IDs separately.
A binary SHA-256 is not compiler provenance or a supply-chain attestation.
The report prints per-input content hashes and the formatter binary hash;
it does **not** attest source repository Git heads or CI execution.

Use `--strict` only on a fully curated, intentionally canonical corpus:
the current source trees contain invalid, negative, and backend-unsupported
compiler fixtures, so rejection and would-change observations must be
triaged before promoting the entire inventory to a mandatory formatting gate.
The default inventory exits nonzero for unsafe tool failures, source changes,
oversized inputs, malformed sources or lack of formatter idempotence; ordinary
source-syntax formatter rejections remain separately visible in its JSON report.
Exit code 1 is treated as a formatter source rejection, while crashes, CLI
usage failures and other nonzero codes are tool errors, not evidence of a
legitimate negative source fixture.

The audit bounds input snapshots and captured formatter output (at most
twice the configured input limit), rejects input symlinks and nonregular files
at open time, and kills timed-out or output-flooding formatter process groups.
Each candidate's temporary input must remain a regular, unchanged file. If
an input exceeds the limit its `input_sha256` is `null`, rather than a
misleading digest of a truncated prefix. The JSON statuses
`invalid_source`, `oversize_output`, `timeout`, `unsafe_temp_write`
and `source_changed` are blocking outcomes.

This is not an OS sandbox or an atomic read-only filesystem snapshot: a
malicious formatter can attempt writes outside its temporary directory, and
another process can mutate a checked-out source tree while the audit runs.
Run reviewed formatter binaries in an isolated, read-only CI checkout and
verify source Git trees before and after the inventory. An audit does not
prove the underlying compiler source semantics or test execution.

## Acceptance criteria before enforcing a formatter check

1. Review all formatter **rejections** to separate malformed negative fixtures
   from valid backend inputs. A rejected source is never counted as a pass.
2. Require second-pass idempotence on formatter-admitted input.
3. Compare compiler acceptance of source *before and after formatting* using
   real Java, LLVM, Forge and .NET frontends for supported feature subsets.
   Wasm uses LLVM for source compilation and must test emitted core Wasm as
   a separate integration path. A mere formatter success proves no parity.
4. Add semantic/runtime differential checks on the shared executable subset,
   particularly imports/init side effects, ownership, actor constructs,
   exceptions/effects, channels, streaming, and typed matches.
5. Pin the reviewed formatter revision and source snapshots before enabling
   non-mutating CI gates. Never auto-run `--write` on a PR branch.

The existing formatter tests include a Rust suite and a two-fixture
Java/LLVM compiler-admission harness. LLVM also includes a read-only corpus
auditor. Java's related staged work is PR #959. This shared workspace
inventory complements rather than replaces those per-backend tests.

The audit tool itself is tested with synthetic formatter executables. Those
offline tests confirm its handling of safe copies, detection of drift,
idempotence and temporary-input mutation; they do **not** execute the real
Rust formatter or prove correctness across all backends.
