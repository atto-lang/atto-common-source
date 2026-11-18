# Atto `std.test`: functional, resource-scoped test harness (v1 proposal)

**Status:** RFC + executable **host-only reference oracle**, not a compiled Atto standard-library implementation. Do not label Java/LLVM/.NET/Wasm/Forge guest parity as passed on the basis of the reference tests.

## Motivation and prior art

The existing [native Oreslang runner](https://github.com/ores-truffle-oreslang/oreslang-source.java/blob/main/stdlib/testing.ores) already has immutable `TestCase`, `TestSuite`, `TestOptions`, `TestOutcome`, source-ordered execution, exact hierarchical filtering, skip/fail-fast, deterministic table cases, `RunSummary`, and `ORES_TEST|` receipts. Its [documentation](https://github.com/ores-truffle-oreslang/oreslang-source.java/blob/main/docs/TESTING.md) explicitly defers isolation, scheduler integration, snapshots, fuzzing and timeouts.

The Atto design retains that foundation and learns from: Node `node:test` (subtests/reporters), Haskell Tasty/Hedgehog (declarative trees, generated properties/shrinking), Scala MUnit/Cats Effect (typed, bracketed resources), Erlang EUnit/Common Test and Elixir ExUnit (per-case process context and cleanup), OCaml Alcotest/QCheck (typed assertions/generators), Pony PonyTest (async/actor test completion), and JUnit Jupiter (per-test lifetime, injection).

**Normative rule:** a test must never depend on a shared mutable `before_each`/global fixture as its implicit input. Fixture acquisition occurs **once for each selected leaf case, after discovery**, not when the suite is built.

## Proposed `std.test` API

This is a **design sketch**, not accepted parser/ABI or executed guest-source syntax. Names are snake_case and lambda syntax uses canonical `|x| -> ...`. No new test-specific language keywords.

| API | Semantics |
| --- | --- |
| `test.suite(name, children)` | Immutable, lazily interpreted hierarchy |
| `test.case(name, body)` | Pure test; `body` returns `TestOutcome` or checked test result |
| `test.skip(name, reason)` | Explicit skip descriptor, never invokes body |
| `test.fixture<T>(acquire, release)` | Typed per-case resource blueprint, no eager acquisition |
| `test.using<T>(fixture, children)` | Inject fresh `T` into every descendant leaf case |
| `test.effect_case(name, capabilities, body)` | Explicit capabilities/effects, no ambient OS privileges |
| `test.async_case(name, body)` | Structured `susp` test, completion must be awaited |
| `test.actor_case(name, body)` | Test-local supervisor + child actor/task scope |
| `test.property(name, generator, predicate, options)` | Reproducible seed, bounded runs, shrinking and replay |
| `test.table(name, values, body)` | Deterministically expanded named/numbered cases |
| `test.expect_equal(a, b)` | Value `eq` with typed formatting and an explicit failure result |
| `test.expect_same(a, b)` | Identity `is` with distinct diagnostic |
| `test.run(suite, options)` | Deterministic `RunSummary` + structured event stream |

An equivalent type-checker surface should be built from `TestNode`, `TestBody<T>`, `Fixture<T>`, `TestContext`, `TestOutcome`, `TestEvent`, `RunSummary`, and `Generator<T>`. Heterogeneous child nodes must preserve the type of each injected fixture within a case body; the compiler may erase a **validated descriptor**, but must never coerce an arbitrary `Any` callback across an ownership boundary.

### Default: pure tests with no hooks

```atto
import module test from "std.test";

val suite = test.suite("arithmetic", [
    test.case("addition", || -> test.expect_equal(2 + 2, 4)),
    test.case("value equality", || -> test.expect_equal("ab", "a" + "b"))
]);
```

A pure test body has no ambient filesystem, network, process, clock or random capabilities. The compiler must enforce this once the requisite effect contracts are available. A host-only reference implementation cannot prove that restriction.

### Typed, separately acquired fixture per case

```atto
val counter_tests = test.suite("counter", [
    test.using(
        test.fixture<Counter>(
            acquire=|scope| -> Counter.new(),
            release=|counter, scope| -> counter.close()
        ),
        [
            test.case("starts at zero", |t, counter| ->
                t.expect_equal(counter.value(), 0)
            ),
            test.case("increments", |t, counter| -> {
                counter.increment();
                return t.expect_equal(counter.value(), 1);
            })
        ]
    )
]);
```

The `Counter` resource is created **twice**, not once. Mutation in `increments` is scoped to that test's own resource and cannot affect `starts at zero`. `acquire` and `release` are effectful **only** with explicitly injected capabilities. `using` receives a descriptor and never calls `acquire` at registration/discovery.

If cleanup fails, the case fails even when assertions passed. If both body and cleanup fail, retain both errors in order (no swallowed primary failure). Nested fixtures acquire outer-to-inner and release inner-to-outer. On partial acquisition failure, release successfully acquired resources only. Release occurs once on ordinary completion, handled failure, unwinding and cooperative cancellation; process crashes/OS kill cannot guarantee guest cleanup.

### Async/actor example (target API)

```atto
val mailbox_tests = test.suite("mailbox", [
    test.actor_case("serial worker processes two messages", |t| -> {
        val worker = t.spawn(SerialWorker());
        await worker.send(1);
        await worker.send(2);
        val result = await worker.get_done();
        return t.expect_equal(result.count, 2);
    })
]);
```

`actor_case` creates a test-local root supervisor and task scope. The runner waits for terminal child/actor outcomes, checks mailbox closure/leak receipts, and tears down the entire scope before advancing. Actor CONTROL panic, unhandled raise/throw, leaked task, runaway mailbox or stale capability must fail **only that case** (unless the VM itself has fatally exited). Never confuse isolation within one VM with an OS/security sandbox: untrusted cases require a separate, properly restricted tenant/process.

### Property example (target API)

```atto
test.property(
    "reverse twice is identity",
    gen.list(gen.int()),
    |t, xs| -> t.expect_equal(xs.reverse().reverse(), xs),
    runs=200
);
```

Generator and shrinker are pure and bounded. Each case has a stable, printed seed derived from global seed + full hierarchical name. Counterexamples report seed, minimal shrunk input, original failure and replay command. A shrink must not rerun external side effects without an explicit isolated fixture and opt-in; tests of IO use model/state-machine commands with fresh resources for each attempt.

## Execution contract

1. **Discovery is inert.** Construct, filter and inspect descriptors without executing test bodies, fixture acquisition, app code, or global registration hooks. Duplicate full paths are a pre-execution error.
2. **Each selected leaf owns its context.** Local RNG state, clock capability, temporary files, resources, mocks, child tasks, actors, logs and cancellation belong to one case. No mutable captures from sibling cases; shared immutable `Shareable` data may be opted in explicitly.
3. **Resource scopes are lexical.** Acquisition succeeds before invocation; releases are LIFO and once-only. Error and cleanup diagnostics remain separate; strict result accounting ensures `total = passed + failed + skipped`.
4. **Fail closed on escape.** A fixture reference must not outlive its test, cross into another actor without legal `Sendable` ownership, or mutate another test's state. A scoped actor/task handle cannot be re-used after teardown.
5. **Parallel is opt-in and capability-aware.** Parallel cases get isolated owned resources. No concurrent reuse of mutable fixtures by default; shared/external resources must declare explicit serialization or leases. Deterministic event presentation is independent of completion order.
6. **Time and failure are explicit.** Monotonic deadlines; cooperative cancellation and bounded join grace; report live child handles; virtual clocks only where runtime supports them. Do not promise cleanup on uncatchable process kill.
7. **Mock by injection, not monkeypatching.** `t.mock(clock)`, `t.mock(http_client)` and `t.fake_channel` supply typed replacement capabilities; do not patch process-global methods or intercept unrelated actors.
8. **Structured output and backward compatibility.** Return typed `TestEvent`s; provide human, JSONL, TAP, JUnit adapters as separate reporters. Existing Oreslang `ORES_TEST|` receipt behavior remains available through an explicit compatibility adapter. Never embed unescaped user strings in delimiter-separated output.
9. **Run admission.** Non-empty matching-case selection is required in CI unless `allow_empty` is explicitly set. Exact full-name filtering is v1; glob/tag/focus filtering requires a separately versioned extension. No persistent `.only` global registry.
10. **Authority boundaries.** Test-only helpers must be unreachable from production targets unless the test capability/module is imported. Fixture acquisition cannot implicitly create network listeners, fork processes, or spawn privileged actors. Do not infer that sandboxing is implemented from source-only tests.

## Existing compatibility and migration

Old `TestBody = () => TestOutcome` maps directly to `test.case("name", || -> old_test())` without exposing shared mutable state. Keep source-order, exact path filters, explicit skip, fail-fast summary and nonzero `require_success` behavior. Prefer `eq` for Atto value equality and `is` for identity; avoid teaching `==` as value equality.

A legacy `before_each` adapter, if ever provided, must **not** share a mutable captured variable between cases. Convert setup into an explicit `Fixture<T>` that returns a fresh typed `T` on every case.

## Implementation and evidence stages

- **Stage A (this PR):** this v1 contract, a dependency-free executable JS semantic reference and its regression tests. **Host-only**. No claim of compiled Atto code or actor scheduling.
- **Stage B:** implement/compile `library/atto.std/test.atto` core pure case/summary operations against real Atto compiler guest execution. Preserve Oreslang semantics for old adapters. Record exact guest source/compiler SHA and negative no-artifact compile checks.
- **Stage C:** typed fixture/HIR ownership/effect admission and runtime-guaranteed LIFO teardown. Negative mutable capture, use-after-test, duplicate full names, failure in acquisition and release.
- **Stage D:** scheduler/actor supervisor integration with bounded child task scope, deadline/cancel handling, mailbox leak detection, and actual actor panic CONTROL case tests. Execute real guest on supported backends; isolate untrusted tests in OS-backed tenant sandbox.
- **Stage E:** generators/shrinking/model-based concurrency, fake clock/ports, snapshot/coverage adapters and CLI discovery/JSONL reporter. All nondeterminism must be replayable or explicitly marked non-replayable.

**Evidence status:** Java/Graal, LLVM, .NET NativeAOT, browser/Rust/Wasm, independent Wasm and Forge: **NOT_EXECUTED for this v1 harness**. The JS reference is not a compiler, not an Atto guest and not a scheduler.

## Host-only reference

`reference/test_harness_v1.mjs` implements: inert suite discovery, duplicate-name rejection, per-leaf fixture acquisition, nested LIFO release, awaited async acquire/body/release, no double cleanup after acquire failure, exact-name filtering, skip/fail-fast accounting, per-name seeded RNG and a single pass/fail receipt per selected case. These are **only** a semantic oracle for guest implementation.

Run locally with `node --test tests/test_harness_v1.test.mjs`. Do not promote host-only results to guest-backend certification.
