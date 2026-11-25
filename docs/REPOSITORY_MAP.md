# AttoLang repository ownership map

Internal cross-repository routing index, audited **2026-11-08**. This directory lives in a private repository because it names repositories that may not be public. Do not copy this complete inventory into the public `.github` profile or marketing site.

The table states the **intended owner** of work, not whether code exists or the feature is complete. Each repository's root README defines its own inclusion/exclusion and security boundaries. Issue/PR changes should link to the proper owner, not fork normative contracts across backends.

## Routing principles

1. Canonical AttoLang source/library semantics use `.atto`; preserve legacy Oreslang repository, CLI and `.ores` compatibility explicitly.
2. `atto-spec` defines semantics, `atto-common-source` shares portable contracts, each `atto-source.*` owns its backend, and conformance repos own execution evidence rather than implementations.
3. `atto-playground` owns the static deployed compiler asset; `atto-source.rs` owns the Rust-authored compiler built *to* WebAssembly; `atto-source.wasm` owns guest Wasm/ABI backend contracts; `atto-source.js` owns JS lowering. **Wasmtime is native/server-side, not the browser runtime.**
4. Shared portable libraries do not depend on commercial `atto-co` hosting; demo repos do not silently become production services. Device/platform repos express explicit host capabilities, not a new language dialect.
5. All feature claims require exact SHA/tree, target, toolchain, nonzero executed guest tests, negative controls and statuses. `steps=[]`, compilation-only checks, and source-free canaries are not guest execution.

## Repository directory

### Governance, specification and evidence

| Repository | Owns |
| --- | --- |
| [`.github`](https://github.com/atto-lang/.github) | Public organization profile, default community/review policy; never private inventory |
| [`atto-spec`](https://github.com/atto-lang/atto-spec) | Normative language semantics and language-change proposals |
| [`atto-common-source`](https://github.com/atto-lang/atto-common-source) | Backend-neutral IR/ABI and canonical portable .atto core/std |
| [`atto-target-profiles`](https://github.com/atto-lang/atto-target-profiles) | Target capabilities, constraints and unsupported combinations |
| [`atto-platform-conformance`](https://github.com/atto-lang/atto-platform-conformance) | Portable executed guest fixtures and five-backend receipts |
| [`atto-compilers-parity-testing`](https://github.com/atto-lang/atto-compilers-parity-testing) | Cross-compiler differential comparison and mismatch triage |
| [`atto-ml-conformance`](https://github.com/atto-lang/atto-ml-conformance) | Executed numerical and ML backend parity |
| [`atto-hot-loading-tests`](https://github.com/atto-lang/atto-hot-loading-tests) | Hot-upgrade generation, rollback and lifecycle conformance |

### Compilers, code generation and runtime

| Repository | Owns |
| --- | --- |
| [`atto-source.java`](https://github.com/atto-lang/atto-source.java) | Java/GraalVM frontend and backend, Native Image, actor runtime |
| [`atto-source.llvm`](https://github.com/atto-lang/atto-source.llvm) | LLVM native lowering, actor/tenant memory and target code generation |
| [`atto-source.net`](https://github.com/atto-lang/atto-source.net) | .NET/CIL and NativeAOT compilation and runtime |
| [`atto-source.rs`](https://github.com/atto-lang/atto-source.rs) | Rust-authored compiler; Rust-to-Wasm browser compiler artifact |
| [`atto-source.wasm`](https://github.com/atto-lang/atto-source.wasm) | Wasm backend, guest/host ABI, actor runtime contracts |
| [`atto-source.js`](https://github.com/atto-lang/atto-source.js) | AttoLang-to-JavaScript transpiler and worker runtime |
| [`atto-source.forge`](https://github.com/atto-lang/atto-source.forge) | Independent Forge compiler/runtime JIT/AOT experiments |
| [`atto-source.cranelift`](https://github.com/atto-lang/atto-source.cranelift) | Cranelift code generation and independent native runtime tests |
| [`atto-source.hdl`](https://github.com/atto-lang/atto-source.hdl) | Synthesizable AttoLang subset and HDL lowering |
| [`atto-source.realtime`](https://github.com/atto-lang/atto-source.realtime) | Planned deterministic real-time compiler/backend (bootstrap only) |
| [`atto-runtime.realtime-java`](https://github.com/atto-lang/atto-runtime.realtime-java) | Java latency-focused actor scheduler/arena research |

### Developer tools and browser-facing products

| Repository | Owns |
| --- | --- |
| [`atto-format`](https://github.com/atto-lang/atto-format) | Canonical formatting rules and golden tests |
| [`atto-cli`](https://github.com/atto-lang/atto-cli) | Build/run/test project CLI surface |
| [`atto-test.cli`](https://github.com/atto-lang/atto-test.cli) | Guest test discovery, harness and receipts |
| [`atto-static-analysis.rs`](https://github.com/atto-lang/atto-static-analysis.rs) | Static diagnostics, ownership/effect/lint checks |
| [`atto-vscode`](https://github.com/atto-lang/atto-vscode) | VS Code editor package and language-service integration |
| [`atto-sublime`](https://github.com/atto-lang/atto-sublime) | Sublime Text editor package |
| [`atto-playground`](https://github.com/atto-lang/atto-playground) | Static in-browser IDE, pinned compiler asset and browser tests |
| [`atto-lang.github.io`](https://github.com/atto-lang/atto-lang.github.io) | Official public language website and Pages release |
| [`atto-browser`](https://github.com/atto-lang/atto-browser) | Reusable browser APIs and DOM/worker host bridges |
| [`atto-wasm`](https://github.com/atto-lang/atto-wasm) | Reusable Wasm component, module and ABI interop |
| [`atto-runtime-ui`](https://github.com/atto-lang/atto-runtime-ui) | Portable UI/event bridge and target surface contracts |

### Platforms and devices

| Repository | Owns |
| --- | --- |
| [`atto-platform.desktop`](https://github.com/atto-lang/atto-platform.desktop) | Desktop lifecycle, native windows and packaging |
| [`atto-platform.mobile`](https://github.com/atto-lang/atto-platform.mobile) | Android/iOS lifecycle, APIs and app packaging |
| [`atto-platform.embedded`](https://github.com/atto-lang/atto-platform.embedded) | MCU, bare-metal and bounded-memory device targets |
| [`atto-platform.iot`](https://github.com/atto-lang/atto-platform.iot) | IoT/edge host integration and secure device protocols |
| [`atto-platform.fpga`](https://github.com/atto-lang/atto-platform.fpga) | FPGA board flows and hardware tests |
| [`atto-platform.asic`](https://github.com/atto-lang/atto-platform.asic) | ASIC-target validation and silicon-facing constraints |

### Libraries and scientific packages

| Repository | Owns |
| --- | --- |
| [`atto-db`](https://github.com/atto-lang/atto-db) | Portable DB APIs and persistence contract |
| [`atto-postgres-orm.atto`](https://github.com/atto-lang/atto-postgres-orm.atto) | PostgreSQL-specific ORM implemented in .atto |
| [`atto-http-routing`](https://github.com/atto-lang/atto-http-routing) | HTTP routing semantics and immutable dispatch |
| [`atto-rpc`](https://github.com/atto-lang/atto-rpc) | RPC API, transport and schema evolution |
| [`atto-ssr`](https://github.com/atto-lang/atto-ssr) | Server-side rendering and client handoff |
| [`atto-serialization-and-validation`](https://github.com/atto-lang/atto-serialization-and-validation) | Portable codecs, schemas and validation |
| [`atto-otel`](https://github.com/atto-lang/atto-otel) | OpenTelemetry integration for traces/metrics/logs |
| [`atto-linked-queue`](https://github.com/atto-lang/atto-linked-queue) | Ownership-safe FIFO and queue lifecycle |
| [`atto-rx`](https://github.com/atto-lang/atto-rx) | Reactive stream composition |
| [`atto-rx-callbacks`](https://github.com/atto-lang/atto-rx-callbacks) | Callback listener interop/lifetimes |
| [`atto-rx-channels`](https://github.com/atto-lang/atto-rx-channels) | Observable bridges for typed channels |
| [`atto-rx-tasks`](https://github.com/atto-lang/atto-rx-tasks) | Reactive async task composition/cancellation |
| [`atto-stategraph.atto`](https://github.com/atto-lang/atto-stategraph.atto) | State machines and graphs in .atto |
| [`atto-logic.atto`](https://github.com/atto-lang/atto-logic.atto) | Logic programming and inference experiments |
| [`atto-ml`](https://github.com/atto-lang/atto-ml) | Model-level ML execution and adapters |
| [`atto-tensor`](https://github.com/atto-lang/atto-tensor) | Tensor shape/layout and numerical kernels |
| [`atto-autograd`](https://github.com/atto-lang/atto-autograd) | Automatic differentiation and gradient tapes |
| [`atto-data-science`](https://github.com/atto-lang/atto-data-science) | Scientific/statistical computing workflows |

### Examples, reference apps and benchmarks

| Repository | Owns |
| --- | --- |
| [`atto-demo`](https://github.com/atto-lang/atto-demo) | Minimal first-run programs |
| [`atto-demos`](https://github.com/atto-lang/atto-demos) | Curated examples spanning domains/targets |
| [`atto-proof-of-concepts`](https://github.com/atto-lang/atto-proof-of-concepts) | Unstable research prototypes |
| [`atto-design-patterns`](https://github.com/atto-lang/atto-design-patterns) | Documented idiomatic design patterns |
| [`atto-demo-restful-server`](https://github.com/atto-lang/atto-demo-restful-server) | Introductory REST server demo |
| [`atto-api-server.atto`](https://github.com/atto-lang/atto-api-server.atto) | Reference .atto API server application |
| [`atto-phoenix-server.atto`](https://github.com/atto-lang/atto-phoenix-server.atto) | Phoenix-inspired actor server experiment |
| [`atto-websocket-server-demo.atto`](https://github.com/atto-lang/atto-websocket-server-demo.atto) | WebSocket actor server demonstration |
| [`atto-restful-server-perf-benchmarks`](https://github.com/atto-lang/atto-restful-server-perf-benchmarks) | Reproducible HTTP server performance studies |
| [`atto-forward-proxy-demo.atto`](https://github.com/atto-lang/atto-forward-proxy-demo.atto) | Forward proxy/SSRF-safe outbound demo |
| [`atto-reverse-proxy-demo.atto`](https://github.com/atto-lang/atto-reverse-proxy-demo.atto) | Ingress reverse proxy and upstream demo |
| [`atto-ai-agent-coordination-demo`](https://github.com/atto-lang/atto-ai-agent-coordination-demo) | Agent actor orchestration demo |
| [`atto-step-function-demo`](https://github.com/atto-lang/atto-step-function-demo) | Step orchestration and durable state demo |
| [`atto-physics-demo.atto`](https://github.com/atto-lang/atto-physics-demo.atto) | Physics simulation and numerical execution demo |

## Audit snapshot and security limitations

At inventory time, only `atto-source.rs`, `atto-playground`, `atto-lang.github.io`, `atto-common-source` and `atto-platform-conformance` had more than one tracked path on `main`. The other 62 repositories began with a README-only tree, and `atto-source.realtime` was empty before its README bootstrap. Thus **repo existence and README text are not evidence of implementation**.

Review pending documentation PRs on isolated branches before merging, preserving any concurrent mainline or feature work. No compiler/runtime tests were executed as part of this inventory documentation task.
