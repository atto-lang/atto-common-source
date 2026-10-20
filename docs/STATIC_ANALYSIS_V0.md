# Oreslang static analysis v0: termination, amplification, security

Status: **experimental shared contract / reference-model proposal**. This is not a production Oreslang source analyzer, a proof of termination, or a substitute for compiler/backend security enforcement. Independently implemented Java/Graal and LLVM frontends must emit verified semantic facts; they do not yet consume this contract.

## Interface

Proposed CLI: `ores analyze --checks termination,amplification,security --format sarif`.
Use a separate `ores analyze --profile strict-aot|realtime|server` for policy. Default output may warn; CI gates should be enabled explicitly. A diagnostic needs rule ID, severity, confidence (`proven` vs `potential`), span, witness path, suggested mitigation and a source/producer digest. SARIF is for editors and CI; the reference model currently emits JSON only.

The reference input, `contracts/analysis/static-facts.v0.schema.json`, is **compiler-produced typed facts**, not source code. A hand-written file is useful for testing the algorithms but cannot certify a program. An attacker controlling the facts could falsely claim a bounded guard, a verified sanitizer or a permission ceiling. Production admission must authenticate the producer, bind facts to exact source/tree and compiler version, and validate all proof claims from HIR/MIR evidence. Do not accept arbitrary user-controlled manifests as a security proof.

## 1. Termination and progress

Construct a CFG per function, then interprocedural and async state-machine summaries. Preserve exit edges from `break`, `return`, `throw`, `raise`, `panic`, cancellation, `await` and supervisor stop. Use SMT/range analysis, abstract interpretation and ranking functions for common decreasing/ascending variants, plus explicit loop bounds. Only a proof of termination (not mere reachability of an exit edge) can mark `proved_terminates`. A conditionally terminating loop without an established ranking function is **potentially** non-terminating, not proven infinite. Separate:

* **no possible exit** proven by a closed-world CFG, except terminal faults which are also exits;
* **progress unverified** on a feasible back-edge;
* **scheduler starvation** when a feasible unbounded loop has no compiler-inserted cooperate/safepoint. `await` alone is not proof of eventual resumption.
* **intentional service loops**, allowed by policy but still required to cooperate, cancel and bound queue/memory effects.

Must inspect implicit loops from iteration, callbacks, stream operators, retry loops, hot code, generated state machines and tail calls. `rt cooperate` prevents monopolizing workers but does **not** imply termination.

## 2. Work and resource amplification

Build an interprocedural **typed weighted event graph**: synchronous call, actor spawn, `nb {}` task spawn, actor message, actor pipeline/callback, supervisor restart, retry, timer, hot-reload migration and I/O callback. Edges carry fanout, source span, trusted/candidate bound, await/join/cancel relation and capability domain. Compute SCCs (including indirect cross-actor cycles). A reachable cycle with no proven finite budget is suspicious even when each step has fanout 1: it can do infinite **cumulative work**. A cycle with an actor/task edge and multiplicity >1 risks exponential creation. A synchronous-call cycle risks stack growth unless a termination guard or tail-call guarantee is established. A message-only cycle is a mailbox storm, not necessarily a growing live-actor count.

Distinguish cumulative creations from **peak concurrently live** actors/tasks. Actor lifecycle, backpressure, joins, mailbox capacity and guaranteed cleanup are necessary to bound peak use. Build costs as vectors: `{actors, tasks, messages, bytes, CPU, retry_rate, nesting_depth}`. For dynamic fanout with unknown maximum, report `unknown` rather than substituting 1. The prototype also flags resource-creating event edges explicitly nested in a potentially unbounded loop. `proved_bounded` on a graph edge means a compiler-proven finite **total number of traversals across the cycle**, not a local bound on children per call. Respect caller quotas, global actor admission, supervision restart windows, timer/retry limits and delegated budgets. Overflow-check all bound arithmetic. Human-supplied annotations are hints, not proofs.

Example: spawn 30 children that re-enter their parent routine has `30^d` potential descendants after depth `d`, with no finite bound when depth is unbounded. Detect through actor messages and indirect calls too.

## 3. Security

Run effect/capability verification and flow-sensitive, field-sensitive taint across awaits, messages, shared-domain references, FFI, task closures and versions of hot-loaded code. Risk classes start with shell invocation, raw SQL, filesystem paths (traversal/symlink races), outbound network destinations (SSRF/rebinding), secret logging, and unsafe native pointer/FFI arguments. Only **compiler-verified risk-specific** validation may stop taint propagation; a generic `escape()` is insufficient. Track source-to-sink witness chains, not just matching names.

Privilege analysis: executable maximum permissions **do not grant** authority; effective grants also depend on runtime request, OS ceiling, actor/isolate and delegated child restrictions, with explicit denies winning. A privileged actor cannot delegate permissions it does not possess; hot reload, child tasks and native handles must not reintroduce denied effects. Detect suspicious cross-actor heap sharing, stale generation/capability permits, unsafe imports and missing cancellation/resource bounds. In-process checks do **not** sandbox arbitrary native code; native code requires mediated host APIs or OS isolation.

Both AoS, SoA, AoSoA and ECS storage must have identical logical taint/ownership semantics: track canonical field identity, field-sensitive aliases, region generations and column relocations, not physical memory layout.

## Reference model

`scripts/static_facts_analyzer.py` takes bounded JSON facts and emits deterministic JSON diagnostics. It demonstrates SCC and taint path analysis; it does **not** parse `.ores`, derive CFG proofs, validate proof provenance, perform symbolic execution or enforce security. Findings from hand-authored facts are tests, not authoritative vulnerabilities. Outputs are deliberately `potential` where termination/amplification depends on runtime paths. Security violations from permission sets represent contradictions **in the supplied facts**, not proof about real executables.

To test locally: `python3 -m unittest tests.test_static_facts_analyzer -v`.

## Admission phases

1. Specify a versioned semantic fact schema, deterministic diagnostics, negative fixtures and executable reference checker.
2. Add Java frontend exporter and checks over resolved AST/HIR; add LLVM exporter independently; ensure all constructs and edges are represented or explicitly `unknown`.
3. Verify CFG/ranking/safepoints, cross-actor SCC summaries and high-confidence security flows against real `.ores` fixtures; add deliberate false-positive and false-negative controls.
4. Propagate budgets/capabilities interprocedurally; model backpressure, actor lifetime and taint through aliasing, suspension, FFI and generation-safe hot reload.
5. Gate strict AOT/realtime/tenant profiles on verified facts; publish SARIF; maintain independent runtime admission, sandboxing and overload protection.

Acceptance: same fixture yields matching diagnostic **classes and witness graphs** on Java and LLVM; proof gaps stay `unknown`; no skipped or zero-step CI may be reported as a pass; exact source and fixture tree SHA are recorded. Production integration must not claim certification from this prototype.

Related: `docs/IR-DESIGN.md`, `docs/REALTIME_EXECUTION.md`, `docs/REACHABILITY_MANIFEST.md`, `oreslang-platform-conformance` permission contracts.
