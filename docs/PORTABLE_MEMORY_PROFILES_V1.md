# Portable ownership, zero-GC and near-zero-GC release profiles (v1)

Status: **target contract, not a claim that any backend is certified**. The
normative source contract is `contracts/v1/memory-runtime-profiles.json`.
This extends [the native/Graal memory contract](MEMORY_SAFETY_AND_PERFORMANCE.md)
and [ownership boundary audit](OWNERSHIP_BOUNDARY_AUDIT.md) to Wasm, embedded
and native desktop. Do not weaken existing target-profiles capability admission:
`gc` in a *host capability upper bound* does not authorize or imply guest GC.

## What the borrow checker must prove

- Affine ownership of every non-Copy allocation; field-sensitive places,
  partial moves, definite init, reborrows, immutable aliasing, exclusive mutable
  aliasing and a single deterministic destructor. Borrow checking is **necessary
  but not sufficient** for eliminating GC: lowering, graph shape, allocator,
  runtime, async frames, host imports, and transitive binary linkage matter.
- All exit edges have drop glue: normal/return/break, throw/raise/panic,
  cancellation, partial construction, supervisor shutdown, module unload and
  hot reload. `defer`/`finally` ordering must not double-drop or resurrect
  retired values. No exceptions for optimizer-generated paths.
- `await`, `select`, `nb select`, yield, channels, `rt cooperate`, deferred
  callbacks and carrier migration cannot retain a stack/actor-state borrow.
  Only compiler-owned pinned continuation frames with sound outlives,
  generation and cancellation proofs may retain a loan; otherwise reject.
  Neither a Future/Option wrapper nor Java reachability is a lifetime proof.
- Cross-actor send moves or copies owned data, or publishes a validated frozen
  `Shared<T>` with independently managed lifetime. `ActorRef` and raw FFI
  addresses are not guest memory aliases. Protect CONTROL and close producer,
  I/O and FFI leases before arena retirement; stale-generation handles fail.
- Cyclic references need one owning graph/region with non-owning generation
  handles/weak edges; never rely on implicit ownership cycles or reference
  counting alone. Opt-in managed graphs must be rejected in strict profiles.
- `requires no_alloc` and `requires no_block` include destructors, cloning,
  callbacks, allocator growth, logging, dynamic dispatch, FFI and exceptional
  paths. Effect-unknown calls and unsupported syntactic forms fail closed.
  `rt borrow` and `rt take` must not secretly allocate. No unsafe optimization
  may manufacture `noalias` or lifetime metadata without proof.

## Distinct platform contracts

| Profile | Guest policy | Host policy and limitations |
| --- | --- | --- |
| `llvm-native` | No tracing GC in linked Oreslang process, native full AOT; explicit owned alloc/free or arenas | Whole image, dynamically loaded plugins and FFI must be audited. Zero **GC** is not zero malloc, no stalls, or zero latency. |
| `desktop-native` | Same as LLVM native plus deterministic desktop/window/OS-resource cleanup | Same audit for GUI/audio/network plugins, callbacks, reload, and native dependencies. |
| `wasm32-core` | No Wasm-GC instructions or managed GC imports; owned linear memory, bounded allocator and compiled module | JavaScript/V8/Node or another embedder **may** GC. Claim only *guest* zero GC; never claim whole-process zero GC for a JS host. AOT-produced Wasm does not imply embedder AOT or no JIT. |
| `embedded-freestanding` | Core links without OS/libc/tracing collector; static/bounded supplied arenas; no allocations in explicitly no-alloc post-init regions | Injected allocator/executor/clock, interrupt safety, firmware image and actual QEMU/hardware guest run required. RTOS availability is not a memory-safety proof. |
| `graal-jvm` | Guest resources freed without waiting for JVM GC, target 0 bytes/op in designated warmed hot loops | JVM collection still possible; record p99 pause and collection counts. JVM JIT is **not full AOT**. |
| `graal-native-image` | Same guest deterministic resources; target 0 bytes/op in designated warmed hot loops | Build AOT native image and measure runtime-image GC; **Native Image can still use a GC**. |

`zero_gc`, `zero_heap_allocation`, `hard_realtime`, and `full_aot`
are **four independent claims**. Even an allocator-free hot tick does not mean
the host collector cannot run for unrelated objects. Do not promise arbitrary
Java user programs zero garbage or hard real-time bounds.

## Evidence gate and exact-tree release discipline

The checked-in script validates **record consistency only**:

```sh
python3 -m unittest discover -s tests -p 'test_memory_profiles.py' -v
python3 scripts/verify_memory_release_evidence.py --evidence /path/to/executed-observations.json
```

A hypothetical record needs `schema_version: 1`, `profile`, matching
`delivery`, exact `source_tree_sha` and `fixture_blob_sha` (40 hex),
`binary_sha256` (64 hex), positive run/job IDs, **executed** steps and
compiled guest tests, zero skipped/failed/errored tests, successful conclusion,
the explicit guest/host GC policies, `proofs` of every profile and common
obligation set to actual `true`, and all named nonnegative measured counters.
The `zero` metrics must equal numeric zero. Unit tests use intentionally
synthetic records **and are not execution evidence**. An offline pass prints
`STRUCTURALLY_VALID_ONLY`: no record alone authenticates its content.

Before publishing a profile claim, independently verify source tree/blob
identity, toolchain/flags, allowed FFI imports, the *linked* guest executable
or Wasm module, workflow job steps, compiled guest input/output, sanitizer and
ownership-negative tests, allocator trace, collection/tail measurements and
repetition counts. CI with zero job steps is **no execution**, not a pass.
Cross-organization mirrors must never expose private sources publicly.
Pin runner, fixture, profiler, warmup and CPU configuration. Keep PRs draft
until those checks have executed at the exact PR head.

## Implementation sequence

1. Build a shared typed ownership MIR with `alloc/move/borrow/end_loan/drop/
   unwind/suspend/send/ffi` and per-place validity; model-check the transfer
   and cleanup graphs before backend optimization and AOT codegen.
2. LLVM native: lower general owned values, classes, pinned async frames and
   actor arenas to deterministic drops; audit linked collector symbols;
   source-level positive/negative compiler tests and sanitizers.
3. Wasm: reuse the LLVM ownership MIR/drop placement; audit Wasm-GC opcodes,
   imports and linear-memory lifetimes, including cancellation and host
   resource handles. The present pure `() -> i64` host is only a bootstrap.
4. Embedded: prove no-OS `core`, separate optional `alloc` and `actor`,
   use static memory/bounded mailboxes, and test firmware image and interrupts.
5. Graal: optimize hot guest allocations using unboxed/inline representations,
   pinned/native regions and escape analysis; collect JFR/Native Image
   allocation and GC tails without disabling host GC.
6. Desktop: native LLVM full-AOT distribution with tracked OS/FFI resource
   lifetimes; separately exercise Graal desktop as a low-GC, not no-GC mode.


## October 17 implementation slices and non-evidence boundaries

The following are draft work branches, **not release certifications**:

- [LLVM native CFG suspension-fence PR #596](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/596): adds host CFG `Suspend` operation rejecting all ordinary live loans, including projection and branch-join cases. Every real source lowering path still needs to emit the fence, and pinned async frames need separate actual runtime proof.
- [LLVM native IR admission PR #594](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/594): early rejection of known LLVM tracing collector intrinsics/strategies/calls in standalone AOT driver. Cannot certify linked/loaded dependencies.
- [Wasm strict guest admission PR #94](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/94): parses type, global and code sections to reject GC/reference operations before the host compiles/admits the Wasm scalar guest. Checked-in gate was exercised via source-fetched V8 evaluation against 8 source-free binary fixtures; Node 22 validated the corresponding module shapes. Not `npm test`, .ores guest codegen, deterministic drops, or host no-GC evidence.

As of these checkpoints the source-organization Actions jobs for all these
draft PR heads terminate before any job steps execute (zero-step failures).
Classify them as **CI infrastructure blocked**, not source-test passes or
implementation test failures. Use only separately executed evidence with exact
source provenance; never place protected private source in a public Actions
mirror merely to obtain runner minutes.


### Additional executable-path hardening (October 17 follow-up)

- [LLVM #596](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/596) now also adds an atomic exclusive graph-heap mutation gate. An outstanding FFI/continuation lease fences allocate/emplace/write/link/remove and the destructor terminates rather than reclaim still-borrowed storage. Read methods acquire counted pins before checking retirement. An existing native CTest includes 128 race rounds plus a fork-isolated fatal lifetime regression. This is source-code implementation and checked-in testing, **not** executed exact-head sanitizer evidence.
- [Embedded #20](https://github.com/ores-truffle-oreslang/oreslang-platform.embedded/pull/20) hooks a tracing-GC/heap-allocator IR and actual ARM object-symbol screen into the `.ores` Cortex-M compiler-to-object publication path, with source-free CTest negatives. This is a deliberately restricted no-heap guest profile, not proof about the complete Zephyr or board firmware image.
- [Java/Graal #1278](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1278) adds opt-in JVM current-thread allocation counters and global collector count/time deltas around actual repeated Graal Polyglot guest evaluation. Missing JMX metrics are **UNAVAILABLE**, never zero. This is measurement infrastructure; it cannot certify zero allocation, independent actor heaps, or GC pause quantiles. Run separate JFR and Native Image evidence before making a near-zero claim.

All three source-organization branch workflows still show **zero executed
job steps** at the checked current heads. No current-branch compiler,
CTest, Maven, sanitizer or target-device PASS is asserted.


### Follow-up red-team audit (October 17): exact-once retirement and admission closure

- **Native graph reclamation is a different capability from a live read, loan
  or write.** LLVM #596 now keeps a separate atomic reclamation claim beyond
  the loan/writer gate, so two supervisor retirement attempts cannot run drop
  glue simultaneously; standalone gates fail-close if destructed with outstanding
  leases or mutation tokens. Queries check stale target generations, retirement
  observation is atomic, and overlapping byte writes use `memmove` before
  scrubbing trailing storage.
- **Testing must exercise every newly introduced negative.** LLVM #596 adds
  fork-isolated gate-lifetime fatal tests, competing supervisor retire/drop
  test, and a 6000-operation independent graph accounting model. These C++
  tests are checked in, not executed by current source-org Actions.
- **Directly exported validators must not be weaker than their wrappers.**
  Wasm #94 now rejects imports, tables, elements, starts, tags and future
  extension section IDs even when `assertNoManagedWasm` is invoked without
  `inspectWasmBytes`. The actual checked-in JS scanner was exercised with
  ten generated binary admission probes (10/10 expected decisions); no
  `npm test` or compiled `.ores` pass is inferred.
- **Embedded no-GC must fail closed on indirection.** Cortex-M #20 adds
  native allocator-wrapper/mangled-symbol denial and rejects opaque inline
  assembly that would evade LLVM symbol inspection. These gates cannot prove
  transitive linked firmware or zero post-init allocations.

The exact latest LLVM/Wasm/embedded/Graal draft-head Actions runs observed
during this audit all report zero executed job steps and zero artifacts.
Such a workflow is **not compiler/test evidence**, independent of its
badge color. No production target is certified zero GC by these draft PRs.


### Additional runner-capacity and exact-blob audit (October 17 evening)

- LLVM graph source branch [PR #596](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/596) gained a three-thread
  graph read/write/link contention regression; an equivalent locally compiled
  workload using *byte-identical, SHA-confirmed native header blobs* passed
  GCC ThreadSanitizer and Clang AddressSanitizer/UndefinedBehaviorSanitizer.
  The existing exact-header graph model harness also passed 150,000
  operations under Clang ASan/UBSan. A bounded borrow-gate harness passed
  1,000 GCC TSan races, 2,000 seal-vs-live-claim tests and two fork-isolated
  lifetime-failure checks. These are **local header tests**, not a compiled
  Oreslang guest or exact-Git-tree CI run.
- Embedded [PR #20](https://github.com/ores-truffle-oreslang/oreslang-platform.embedded/pull/20)
  now screens indirect LLVM `call`, `invoke` and `callbr` instructions
  so unknown function pointers cannot silently bypass collector/allocator
  symbol checks. A quote-aware inline-comment scrub prevents
  `; @harmless()` from laundering a dynamic callee. Its source-free locally
  reproduced parser regression suite passed 8/8; the exact new GitHub
  blob still needs a proper fresh-head CI execution.
- Existing private destination `ores-vector-embedding/ores-vector-embedding-lib-core`
  has historical executed GitHub Actions (12 steps in a September 2026 run),
  but **historical success does not confirm current available minutes**.
  The private cross-org source copy was blocked before any blob/tree transfer.
  The temporary mirror ref remained at the destination's original tree, so
  it MUST NOT be treated as a source copy or exact-tree test.
- One explicit GitHub rerun of the source embedded host workflow was accepted
  by GitHub, but attempt 2 still failed with **zero executed job steps**.
  The latest observed LLVM, Wasm, embedded and Graal source heads also had
  failed zero-step jobs. Do not publish PASS receipts from those runs.

Remaining release blockers: signed or otherwise trusted exact-tree provenance;
native full-CTest and sanitizer execution; real `.ores` source-to-AOT actor
ownership/deterministic-drop parity; Wasm worker execution; real Cortex-M QEMU
and firmware binary closure; measured GraalVM JVM and Native Image resource
allocation and GC pause-tail evidence.


### Cross-layout native heap handle identities and exhaustion (October 17 evening)

LLVM actor graph [PR #596](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/596)
now mints graph heap IDs from a shared non-template monotonic atomic source.
This fixes collisions between different `ActorOwnedGraphHeap<N, B, L>`
specializations that otherwise start counters at the same value.
The maximum `uint64_t` heap ID is issued at most once, followed by a
permanent zero sentinel; further minting throws, not wraps to a reused ID.
No source `.ores` or cross-process capability security is implied by the
numeric ID alone.

The C++ native CTest adds 128 cross-layout forged-handle negative checks,
4096 racing cross-layout heap constructions and near-overflow unit cases.
Standalone harnesses using *exact blob SHA*
`dd23f57ec8c16fff1f35276ebdbeeceb0651e8ae` passed GCC TSan
(4096 constructor races), Clang ASan/UBSan (uint64 boundary and 10002
sequential cross-layout IDs), and Clang ASan/UBSan (150000 graph model
operations). The last recorded LLVM exact-head GitHub Actions run
`39097728303` still executed **zero steps**. Do not promote these
local-header test results into compiled-language, executable-binary or
production no-GC evidence. Multi-DSO runtimes need a host-assigned,
stable runtime-instance identity as an additional namespace.
