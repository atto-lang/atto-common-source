# Three-backend Atto tracing parity ledger — 2026-11-13

**STATUS: PARTIAL IMPLEMENTATION / FULL PARITY NOT MET.**
This is an audit receipt, not an executable three-backend conformance result. Always distinguish Java/GraalVM guest code, LLVM compiler-backed guest native code, .NET host Native AOT code, dormant AOT probes, and real newly compiled JIT variants.

## The three modes must remain distinct
1. **AOT dormant probes:** compiler-emitted boundaries or function sites already exist; host may enable/disable without process restart, but the program does **not** JIT.
2. **JIT deep instrumentation:** a trusted backend actually compiles a verified equivalent new function from protected typed IR, installs a pinned code version with complete tenant/ABI/effect/ownership/continuation identity, and retires it after all logical continuations finish. Policy/dispatch-only prototypes do not count.
3. **Signed AOT hot-load:** a separately compiled and verified new native generation is installed with lifecycle fencing. This is not same-binary JIT; feature-gate if unsupported.

## Concrete backend receipts

| Backend | Executed evidence | Gaps |
|---|---|---|
| **Java / GraalVM** | [Java PR #2994](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2994): source SHA `059334fbfbe1b5b71bad3bca430697b74d59f812`, [GraalVM Java 25 test carrier #43323329930](https://github.com/atto-lang/atto-compilers-parity-testing/actions/runs/43323329930), 50/50 compiler/guest tests; first-class `using telemetry.span` and task-aware cleanup. [Java PR #3035](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/3035) separately has adaptive policy/dispatch host-only smoke. | No runtime-generated per-callable Truffle JIT probes or full Native Image / OTLP/actor E2E proof. |
| **LLVM** | [LLVM PR #1716](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1716): exact subset LLVM compiler→native `.atto` scope cases, five positive/five negative, Clang O0/O2, true same-process dormant probe toggles [#43325381462](https://github.com/streempilot-test/browser-studio-e2e/actions/runs/43325381462). [LLVM PR #1767](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1767): host-only versioned code dispatch at source head `e4ad140e29380b4540065161e2ad6e7650d53edb`, [GCC/Clang ASan/UBSan #43550432893](https://github.com/benefactor-cc/benefactor-e2e/actions/runs/43550432893). | No ORC-generated Atto function version, async continuation-lifetime code retirement or OTLP end-to-end proof. |
| **.NET Native AOT** | [.NET draft PR #512](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/512): policy + version-pinned host dispatch, W3C logical scope, same-process dormant boundary probe toggle, thread migration/retirement and cross-tenant denial. A four-blob private test carrier compiles and runs managed .NET 10 and Native AOT host-only suites; [previous passing CI #43550686035](https://github.com/benefactor-cc/benefactor-e2e/actions/runs/43550686035) at prior source SHA `bfb0d5e3a429c79180bcf0e0dd68c7d2a2db797c`. | The .NET compiler still deliberately **rejects** `using telemetry.span`; no guest-CIL lowering, independently compiled native JIT provider, real signed hot-load, or guest OTLP proof. Latest revocation hardening requires its own receipt. |

## Required promotion gates

- **Real guest source execution:** the same portable `.atto` fixture compiles through each native source compiler and produces equivalent span lifecycle, trace IDs/parent relation and unchanged output/exit code.
- **Closure and actor ownership:** test return, `?`, throw/raise/panic, cancellation, supervisor restart, `await`, `rt cooperate`, tenant transfer denial, and physical carrier migration. Do not promote .NET or LLVM while scope suspension is unsupported.
- **Runtime activation:** OFF→ON→OFF→ON in one unchanged production image, with no runtime compiler falsely reported on dormant probe tests.
- **True deep JIT:** verify generated code rather than test supplied function pointer/delegate; check IR signature/typed ownership, ABI fingerprints, permission/tenant authorization, code memory W^X, quota, safe code retirement and adverse reconfiguration races.
- **Real OpenTelemetry:** HTTP SERVER → actor mailbox → async continuation → HTTP CLIENT → bounded OTLP collector, with W3C propagation, privacy exclusions, no exporter recursion, no actor blocking.
- **CI provenance:** prefer source-org Actions; if unable to admit jobs, use an explicitly approved **private** alternate org and exact SHA Git-blob mirror without cross-org token/secrets; distinguish subset mirror from whole-tree mirror. Require nonzero executed steps, no skipped cases and exact source SHA.
- Keep Java, LLVM and .NET draft or unpromoted for any mode without its own concrete executed evidence. Java guest tests must not certify LLVM or .NET guest parity; a .NET Native AOT host test must not certify guest CIL.

## NativeAOT security note

The .NET and LLVM dispatch prototypes take trusted/verifier result flags from a host-only control plane. These flags **are not cryptographic signature checks**. They must be bound to independently authenticated manifests and actual compiler-produced artifacts before any untrusted tenant can request dynamic generation. The .NET host recorder currently allocates span/scope objects; near-zero/zero-GC performance has not been measured or proved.
