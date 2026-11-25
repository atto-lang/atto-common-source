# Three-backend Atto tracing parity ledger — 2026-11-13

**STATUS: PARTIAL IMPLEMENTATION / FULL PARITY NOT MET.**
This is an audit receipt, not an executable three-backend conformance result. Always distinguish Java/GraalVM guest code, LLVM compiler-backed guest native code, .NET host Native AOT code, dormant AOT probes, and real newly compiled JIT variants.

## The three modes must remain distinct
1. **AOT dormant probes:** compiler-emitted boundaries or function sites already exist; host may enable/disable without process restart, but the program does **not** JIT.
2. **JIT deep instrumentation:** a trusted backend actually compiles a verified equivalent new function from protected typed IR, installs a pinned code version with complete tenant/ABI/effect/ownership/continuation identity, and retires it after all logical continuations finish. Policy/dispatch-only prototypes do not count.
3. **Signed AOT hot-load:** a separately compiled and verified new native generation is installed with lifecycle fencing. This is not same-binary JIT; feature-gate if unsupported.

## 2026-11-13 backend receipts

| Backend | Executed evidence | Gaps |
|---|---|---|
| **Java / GraalVM** | [Java PR #2994](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2994): source SHA `059334fbfbe1b5b71bad3bca430697b74d59f812`, [GraalVM Java 25 test carrier #43323329930](https://github.com/atto-lang/atto-compilers-parity-testing/actions/runs/43323329930), 50/50 compiler/guest tests; first-class `using telemetry.span` and task-aware cleanup. [Java PR #3035](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/3035) separately has adaptive policy/dispatch host-only smoke. | No runtime-generated per-callable Truffle JIT probes or full Native Image / OTLP/actor E2E proof. |
| **LLVM** | [LLVM PR #1716](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1716): exact subset LLVM compiler→native `.atto` scope cases, five positive/five negative, Clang O0/O2, true same-process dormant probe toggles [#43325381462](https://github.com/streempilot-test/browser-studio-e2e/actions/runs/43325381462). [LLVM PR #1767](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1767): host-only versioned code dispatch at source head `e4ad140e29380b4540065161e2ad6e7650d53edb`, [GCC/Clang ASan/UBSan #43550432893](https://github.com/benefactor-cc/benefactor-e2e/actions/runs/43550432893). | No ORC-generated Atto function version, async continuation-lifetime code retirement or OTLP end-to-end proof. |
| **.NET Native AOT** | [.NET draft PR #512](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/512): policy + version-pinned host dispatch, W3C logical scope, same-process dormant boundary probe toggle, thread migration/retirement and cross-tenant denial. A four-blob private test carrier verified SHA-identical source head `493eccb8e31570f293ea526445f2e8f29e51246b`; [CI #43550856941](https://github.com/benefactor-cc/benefactor-e2e/actions/runs/43550856941) **passed** actual managed .NET 10 and Native AOT x64 ELF execution, each with 48 new tracing checks + 169 existing W3C continuation checks, including OFF/ON/OFF/ON and dynamic policy revocation. | The .NET compiler still deliberately **rejects** `using telemetry.span`; no guest-CIL lowering, independently compiled native JIT provider, real signed hot-load, or guest OTLP proof. Runtime policy revocation has host-only executed evidence; guest codegen parity remains unimplemented. |

## Initial local execution on 2026-11-23

| Backend | Git commit and tree | Executed result |
|---|---|---|
| Java | `11fb02c8a39b3ced00ff74c07bd1deadecaa8e9d`, tree `4e8dd2056de5c9495980c11d5154cda8a1b29f41` | 50 JUnit cases passed with zero skips, covering lexical spans, same-target toggling, suspension, task and actor context, and HTTP tracing. The local GraalVM runtime used interpreter fallback. |
| LLVM | `6a427a7306953525444144910e0ee977e4c07bde`, tree `6a321ac18edf893e8a8f35fe4d7f01c4657900ff` | All three CTests passed on macOS arm64 and Debian arm64 with LLVM 19.1.7, including the ORC hybrid guest and the standalone AOT toggle using the same `.atto` fixture at O0/O2. Debian built a local archive of the exact commit. The hybrid case passed 25 repeat runs on macOS. Removing the generated lexical close from the JIT input failed at the LIFO assertion. Receipt `LLVM_AOT_ORC_SCOPED_TELEMETRY_PASS`. |
| .NET | `1c0f49f2a59f93cb18219ba8f7e78a11c0df4c96`, tree `9008606682636c9dbb3006d12fe2671f147df08c` | SDK 10.0.404, `osx-arm64`. The NativeAOT host probe reported zero bytes allocated over 50,000 disabled probes and executed 512 enabled host spans. A NativeAOT compiler emitted CIL for a scalar control, and the statically linked guest printed `42`. The same compiler returned `E_TELEMETRY_SCOPE_UNSUPPORTED` for the portable Atto scope and produced no guest artifact. |
| Rust | `d4c8298a33b78417d9e4a757bf114192afe97dac`, tree `9640225c923a3a4c669b5108f974c710cb7b40c1` | `attoc` produced a Wasm scalar control that returned `42`. The portable scope failed with `E_UNSUPPORTED` before emitting Wasm. |
| Cranelift | `938458056638320bc867bd28c985910c42d40179`, tree `48b951363bf6949c91d3293cf61b73ed1753fe5f` | The stage-0 scalar JIT returned `42` for its control. The portable scope failed during parsing, with no CLIF output. The strict AOT CLI denial tests passed. |
| Forge | `87e1da060c5fedaedeea3ccdcf20d8a460af4b5b`, tree `ead6f682354c08916d145213a973009eaa2607ec` | The scalar compiler emitted C++ for a control and the Clang-linked binary printed `42`. The portable scope failed during source admission with no C++ emitted. |

The ORC fixture recompiles compiler-emitted guest IR and observes the new
call span, the existing lexical span, and code retirement after detach.
The hierarchy proven here is the synchronous carrier-local span stack.
Production manifest authentication, W3C parent IDs, suspension and actor
migration remain required for release evidence.

## Four-backend scoped guest execution on 2026-11-23

The same `scoped-nested.atto` source (SHA-256
`a05d36a3d1c9606df7fb06815a9ac3f01570d2b3bb01636fd7dda5cefeb308dd`)
returned `42` on all four backends with recording off and on. With recording
on, the fallthrough scope closed first and the nested scopes closed inside
out, in the order `finished`, `payment`, `checkout`. No scopes remained live.
The three native programs linked the LLVM C telemetry runtime.

| Backend | Git commit and tree | Executed result |
|---|---|---|
| LLVM | `6a427a7306953525444144910e0ee977e4c07bde`, tree `6a321ac18edf893e8a8f35fe4d7f01c4657900ff` | The Clang-linked guest passed the shared scope oracle. All three LLVM scope CTests passed again, including the ORC test. |
| Rust | `b054db3bfe26550a2aee04c81cf24e3824cc756b`, tree `a57f56eabd39d70bab9886d4e292de07a6b67e3d` | Native and browser-hosted compilers emitted identical Wasm for the shared fixture. Node executed it in both recording modes, checking close order and the payment span's parent. Separate guest regressions passed for `?`, caught exceptions, fatal trap retirement, and alias denial. |
| Cranelift | `fbb9c17a78bf3299f69ea848f8bf9e7a86629d80`, tree `e94e0235e6f2640f6a0c5109e8ae7f85de0cacf3` | The statically linked object passed the shared oracle. Trusted native JIT execution produced the same close order and parent relationship. The linked-object and JIT regressions both checked cleanup before a checked arithmetic failure. |
| Forge | `c631e934f1d45ec18197602efb21ec9dc1f3d68f`, tree `34228d4528c954e250d862f3f5f54f09e2750130` | C++ emitted by `forge_scalar` linked and passed the shared oracle. The generated guest pipeline verified normal return, disabled recording, and scope cleanup on checked overflow. |

This execution covers synchronous lexical scopes. Macro-expanded names
have LLVM guest evidence. Rust, Cranelift and Forge still need macro
admission, live JIT probe insertion, and continuation-owned spans.

## Required promotion gates

- **Real guest source execution:** the same portable `.atto` fixture compiles through each native source compiler and produces equivalent span lifecycle, trace IDs/parent relation and unchanged output/exit code.
- **Closure and actor ownership:** test return, `?`, throw/raise/panic, cancellation, supervisor restart, `await`, `rt cooperate`, tenant transfer denial, and physical carrier migration. Do not promote .NET or LLVM while scope suspension is unsupported.
- **Runtime activation:** OFF→ON→OFF→ON in one unchanged production image, with no runtime compiler falsely reported on dormant probe tests.
- **True deep JIT:** verify generated code rather than test supplied function pointer/delegate; check IR signature/typed ownership, ABI fingerprints, permission/tenant authorization, code memory W^X, quota, safe code retirement and adverse reconfiguration races.
- **Real OpenTelemetry:** HTTP SERVER → actor mailbox → async continuation → HTTP CLIENT → bounded OTLP collector, with W3C propagation, privacy exclusions, no exporter recursion, no actor blocking.
- **CI provenance:** prefer source-org Actions; if unable to admit jobs, use an explicitly approved **private** alternate org and exact SHA Git-blob mirror without cross-org token/secrets; distinguish subset mirror from whole-tree mirror. Require nonzero executed steps, no skipped cases and exact source SHA.
- Keep Java, LLVM and .NET draft or unpromoted for any mode without its own concrete executed evidence. Java guest tests must not certify LLVM or .NET guest parity; a .NET Native AOT host test must not certify guest CIL.

## NativeAOT security note

The .NET and LLVM dispatch prototypes take trusted/verifier result flags from a host-only control plane. Production activation must bind those flags to independently authenticated manifests and compiler-produced artifacts before admitting requests from untrusted tenants. The .NET host recorder allocates span and scope objects when enabled. A process-wide zero-GC claim requires production workload measurements.
