# Receive-invocation stack evidence contract v1

**Draft, source-free and not a compiler implementation.** This receipt gate adds the evidence admission rules for [AttoLang spec PR #26](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/pull/26) and [platform-conformance PR #635](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/635).

Run: \`node --test tests/receive-invocation-evidence-gate.test.mjs\`.

## Required guest cases

Each of Java/GraalVM, LLVM, Wasm, Forge, and .NET Native AOT has the same ten immutable case IDs in \`RECEIVE_STACK_CASES\`:
- distinct receive and child Task stacks; default serial suspended receive retains its DATA slot
- explicit N-concurrent receive separation; nested PC/local retention through await; one-shot wake/gen fence
- actor-wide aggregate bytes and frame quotas including suspended continuations
- cancellation versus physical cleanup; rejecting escaping critical borrows
- A's stack-budget overflow terminally fails A while unrelated B survives.

The verifier takes a caller-supplied receipt plus a *separately supplied observed provider snapshot*. It rejects missing/mismatched 40-hex Git heads, tree IDs and fixture blobs; truncated case matrices, unknown states, zero-step runs, failed jobs, missing runner IDs, wrong job/run linkage and host-only execution.

**Evidence must not be fabricated:** a green job and in-memory assertions are insufficient. Even all 50 positive candidate statuses are returned as **UNTRUSTED_CANDIDATE_ONLY**; the exported parity assertion deliberately refuses certification until an independent verifier inspects live GitHub API run/job/step data, verifies bytes and parses real guest outcomes. This script cannot itself independently authenticate those inputs. A fake provider observation is untrusted, not a signature.

No private source is transferred between GitHub organizations in this PR. The fixture SHA belongs to a future canonical exact-source corpus; the committed example manifest is deliberately **NOT_EXECUTED** on all five backends.
