# Comparative design audit: Atto `std.test` versus functional test ecosystems and Rust

Status: reviewed design choices and proposed compatibility; **not proof of compiled Atto guest support**. Baseline: [Oreslang native testing](https://github.com/ores-truffle-oreslang/oreslang-source.java/blob/main/stdlib/testing.ores); parent proposal: [TEST_HARNESS_V1.md](./TEST_HARNESS_V1.md).

## Ecosystem comparison

| Framework | Proven strength | Adopt for Atto | Deliberately avoid |
| --- | --- | --- | --- |
| Haskell Tasty | Immutable composable test trees and plug-in test families (HUnit, QuickCheck, Hedgehog) | Immutable `TestNode` trees, composable independent `case`/`property`/actor tests | Global mutable test registration |
| Haskell Hspec | Readable nested test groups, `before`/`around` resource callbacks | Hierarchical descriptions and readable assertions | Implicit captured mutable `before_each` globals |
| Haskell Hedgehog | Integrated invariant-preserving shrinking and counterexample reporting | Strategy-linked shrink trees and replayable minimal counterexamples | Unbounded random generation/shrink |
| Haskell QuickCheck | Small composable properties and reproducible arbitrary inputs | First-class `gen`, sizing, seed and example laws | Requiring one type-global random instance per domain |
| Rust libtest / cargo test | Default unit/doc tests, exact filters, stable failure signal | `atto test` discovery, fail-on-no-match, test-only dependencies, CLI filtering | Macro/annotation requirement for user-authored tests |
| Rust rstest | Type-directed, parameterized fixture injection; test matrices | `Fixture<T>` acquisition and typed test args, table cases | Default `#[once]`-style shared mutable fixture |
| Rust proptest | Value-specific `Strategy` shrink; failure persistence and replay | `gen.int`/`gen.list` and bounded per-value shrinking, replay inputs | Re-running effectful properties against one mutable resource |
| Rust cargo-nextest | Process-per-test isolation, groups, timeouts, retry/flaky labeling | Optional process/tenant isolation and deterministic structured reports | Claiming actor heap isolation also protects from native segfaults |
| Rust loom | Systematic exploration of relevant concurrent interleavings | Future `test.interleavings` driven by Atto scheduler checkpoints | Random stress tests masquerading as exhaustive model checking |
| Scala MUnit | Typed per-test `FunFixture` and integrations | Typed fixture factories and approachable test API | Inheritance-based fixture hierarchy as core model |
| Scala Weaver / Cats Effect | `Resource`-bracketed test scope; test effect values and parallelism | Affine resource scopes, cancellation-safe release and structured concurrency | Parallel by default before ownership/scheduler proofs |
| Scala ZIO Test | Immutable test descriptions, service layers, TestClock/TestRandom and test aspects | Typed capability environment, deterministic clock, explicit test policy decorators | Hidden global clock/console replacement |
| Elixir ExUnit / StreamData | Per-case test process, setup context, concurrent test scheduling, property generation | Case-local supervisor/context and property generators | Assuming a new actor has an OS security boundary |
| Erlang EUnit / Common Test / PropEr | Test descriptors, setup/cleanup, OTP lifecycle, state-machine properties | Actor/supervisor lifecycle testing and model-based command sequences | Process-global mutable fixture registrations |
| OCaml Alcotest / QCheck | Typed testables/printers and generators | Typed equality + diff/pretty formatting; generator combinators | String-only assertion diagnostics |
| Pony PonyTest | Async actor completion and coordinated test control | Actor-scoped terminal completion + supervisor CONTROL receipt | Allowing a test to pass while child work remains live |
| Elm Test / F# Expecto & FsCheck | Functional fuzz/property tests, declarative test descriptions | Pure default path plus explicit effectful tests | Conflating pure source descriptors with executable proof |

### Primary sources

- [Haskell Tasty](https://hackage.haskell.org/package/tasty) and [Hedgehog](https://github.com/hedgehogqa/haskell-hedgehog).
- [Rust cargo test](https://doc.rust-lang.org/cargo/commands/cargo-test.html), [rstest](https://docs.rs/rstest/latest/rstest/), [proptest](https://github.com/proptest-rs/proptest), [failure persistence](https://proptest-rs.github.io/proptest/proptest/failure-persistence.html), [cargo-nextest process-per-test](https://nexte.st/docs/design/why-process-per-test/), [loom](https://docs.rs/loom/latest/loom/).
- [Scala MUnit fixtures](https://scalameta.org/munit/docs/fixtures.html), [Weaver](https://github.com/typelevel/weaver-test), [ZIO Test](https://zio.dev/reference/test/), [ZIO TestClock](https://zio.dev/reference/test/services/clock/).
- [Elixir ExUnit callbacks](https://hexdocs.pm/ex_unit/ExUnit.Callbacks.html), [StreamData](https://hexdocs.pm/stream_data/ExUnitProperties.html), [Erlang EUnit](https://www.erlang.org/doc/apps/eunit/chapter.html), [OCaml Alcotest](https://ocaml.org/p/alcotest/latest/doc/README.html) and [QCheck](https://github.com/c-cube/qcheck).

## Design decisions after comparison

### 1. Separate suite data from the runner

The public interface builds **inert typed values**. It does not register tests by importing a module, run setup at test definition time, inspect the environment, or open sockets. Discovery validates names, suite paths, tag/filter expressions and dependency graphs only. The runner interprets an already validated tree.

To avoid unnecessary new Atto keywords, use module methods. Prefer `test.case`/ `test.suite` if parser and static method resolution admit them; the initial portable candidate uses `test_case`/`test_suite` builders until that is proven. Always snake_case callable names.

### 2. Use typed, *case-local* fixtures, not a global mutable `before_each`

`using(Fixture<T>, children)` describes a dependency. Each selected leaf obtains a fresh `T` after discovery. Dependencies acquire outer-to-inner and release inner-to-outer; exceptions in acquisition, test body, and release are **separate** diagnostics. A cleanup failure cannot turn a failed test into a pass or overwrite an earlier failure.

The compiler must distinguish `borrow T`, `borrow mut T`, `take T`, and legal cross-actor transport. If a test task sends a resource to a child actor, the handle must satisfy the same `Sendable`/ownership and supervisor lifecycle contracts as production Atto. A test-local resource capability must not escape after teardown.

Shared immutable fixture values may be explicit; mutable session-global fixtures are not in the core API. External resources (database, network listener) require a declared exclusivity/lease strategy.

### 3. Model properties after Hedgehog **and** proptest

Generator instances own construction *and* shrink semantics, so dependent inputs remain valid. Each leaf gets a stable seed derived from `run_seed + full_name`, independent of suite order. Record original input, minimized input, iteration, seed and shrink count. Keep shrinking deterministic with strict budgets; store real regression cases separately for future replay.

**Critical effects rule:** a pure property may execute the predicate repeatedly while minimizing a failing case. The reference implementation **rejects injected fixture arguments** during shrinking rather than reusing mutable state. Future `property_with_fixture` must explicitly acquire and release a **new resource per generated/shrunk attempt**, not once per entire property leaf. The compiler should statically restrict effectful predicates unless this mode is used.

A property-context predicate intentionally receives no random-number generator; stochastic input comes only from the declared strategy. The JS reference cannot prove a closure has no hidden side effects, so it must never be cited as evidence of compiler-enforced purity.

### 4. Distinguish four isolation layers

1. **Pure test:** no ambient effects, no mutable sibling sharing (effect/borrow enforcement needed).
2. **Actor-scoped test:** one test-local supervisor with a private task/actor subtree; all children joined or cancelled and drained before terminal status (runtime work needed).
3. **Tenant/process test:** real resource and crash isolation, with restricted authority; used for untrusted/native-fatal cases (runtime/host work needed).
4. **Deterministic scheduling:** model scheduler for cooperative actor/task events and mailbox wake races; records an execution schedule for replay. Like Rust loom, it must systematically explore a bounded model, not claim that random stress covers all interleavings.

### 5. Keep runner concerns outside a minimal stdlib core

`std.test` owns descriptors, result types, assertions, fixtures and generators. `atto test` owns file discovery, compiler execution, test selection, scheduling, deadline, retries, capture, reporters, coverage and process boundaries. The CLI should produce machine-readable JSONL with correct escaping, fail on zero discovered or matched tests by default, and never silently relabel a retried success as an ordinary pass.

A test failure is a value/event. Nonzero process exit is an **outer runner policy**. Avoid `stdio` calls in pure assertion helpers. Reporting stdout/stderr must not modify test semantics.

### 6. Keep migration honest

The original Oreslang `TestBody = () => TestOutcome`, `TestCase`, `TestSuite`, `TestOptions` and `RunSummary` stay the compatibility target. The current `stdlib/test.atto` is an **unverified source candidate** preserving the basic case/summary shape; it does not yet compile in every backend, does not implement `using`, and cannot enforce pure/effectful separation. The JS reference oracle is an independent host-only behavioral model, not the source of truth for compiler behavior.

## Additional conformance gates before graduation

- Conflicting nested fixture types and illegal mutable capture must be compilation failures, not silently accepted runtime global state.
- Test body and release both fail: both retained in structured diagnostics.
- Cancellation while awaiting a child actor: immediate admission fencing, drain, and exactly one terminal event.
- Property shrinking with an injected mutable fixture must fail admission or rebuild fresh per attempt; never carry mutation between shrink candidates.
- Replaying a property with the same seed and source/strategy versions must be byte-for-byte deterministic for samples and minimized failures.
- A process-level fatal test must not terminate sibling tests when process isolation was requested; actor-only mode must never claim this protection.
- Filter that selects zero cases fails CI unless `allow_empty` is explicit.
- Negative compile fixture must produce **no guest artifact**.
- Reported backend support requires an actual compiled `.atto` guest at pinned source/compiler SHA and nonzero executed CI steps, not merely passing this JS oracle.
