# Six-backend scalar conformance admission, v1

The current source implementations are independent: Java/Graal, LLVM, Wasm,
Cranelift, .NET NativeAOT, and Forge. Cranelift is an intentionally restricted,
trusted native-JIT scalar subset, **not** Forge, a general Oreslang compiler,
or an actor runtime. Unsupported is never a pass.

This source-free host evidence gate checks that every backend declares a result
for six minimal scalar candidate cases and that a separately supplied job
observation agrees on exact head SHA, run ID and job ID, has an assigned
runner and executed steps. It rejects missing/unsupported/skipped statuses
being promoted to green. It does not execute a compiler, validate Oreslang
source, authenticate arbitrary JSON, attest a live GitHub check, or authorize
private source mirroring.

`assertExecutedSixBackendScalarParity()` intentionally **never** certifies
parity from untrusted JSON. An authorized reviewer must verify each source tree,
fixture Git blob and actual executable test case from GitHub Actions logs or
approved source-local runner reports. Record failures and negative admission
separately, and maintain Cranelift's documented unsupported feature list.

No compilation or cross-org export is performed by this gate.
