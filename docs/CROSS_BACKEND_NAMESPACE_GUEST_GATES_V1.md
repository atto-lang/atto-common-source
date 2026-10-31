# Cross-backend multi-file namespace guest gate v1 (proposal)

**Status: authored source corpus, NOT compiler-backed execution evidence.**

This draft adds `contracts/conformance/namespace-guest-gates-v1.json` (a closed 12-source-unit inventory: ten `foo@1` providers across flat namespaces `a`/`b`/`c` with counts 3/4/3, one `other@1` collision, one `app@1` entry). One expected positive compiles/executes with exit 43. An **additional unpromoted positive** `all-provider-exit-53` now calls namespace `b`'s four functions (1+2+3+4) in addition to the original `a`/`c` path, so all ten provider units contribute to observable work. This extension is not one of the 16 original conformance cases; it has separate explicit `compiler_executed=false` and `guest_executed=false` markers. Fifteen negative mutation/pin cases must be classified **by a real compiler**, with no emitted artifact in the pinned-scalar profile. Twelve are portable semantic/security rejections; three are explicitly **profile_capability** rejections (provider cycles, provider initialization, named-argument call ABI). Do not generalize those three as language bans. The corpus is self-contained source bytes, not parsed from a private carrier.

## Explicit grammar conflict

Two draft language profiles currently exist:

| Profile | Example | Ongoing work |
|---|---|---|
| Pinned `ns` | `import ns a from "pkg:foo";` | common-source #189; Java #2255; LLVM #1224 |
| Manifest `namespace` | `import namespace billing as payments from "checkout";` | common-source #188; Java #2258/#2263 |

Both must derive namespace identity from **(PackageInstanceId, NamespaceName)**. They do **not** have identical source spelling, alias semantics, or manifest admission mechanisms. This new corpus tests only the pinned `ns` profile. Ratify one grammar or explicit dual-grammar semantics before cross-backend parity certification. Do not quietly convert one into the other.

**Recommended migration direction (pending independent language-contract approval):**
Use `import ns a from "pkg:foo";` as the canonical exact-pinned form. The
`pkg:foo` selector must be a manifest/lockfile-resolved package alias owned
by the importing package, not a filesystem location, global package name, or
compiler-supplied guessed module. Preserve `import namespace` only as an
explicitly documented draft/compatibility profile until its dependency-graph
semantics can be reconciled; do not silently reinterpret existing code.
A local alias, if later admitted, must be an explicitly type-checked lexical
binding that cannot shadow imports, locals, functions or reserved names.
No existing compiler is claimed to support this migration automatically.


## Source-free authoring checks

```sh
node --test tests/namespace-guest-gates-v1.test.mjs
node tools/materialize-namespace-guest-case.mjs ns-exit-43
node tools/materialize-namespace-guest-case.mjs provider-cycle
```

`materialize` creates a fresh private temporary directory, writes 12 immutable guest files plus a pinned-alias metadata file, and prints a JSON locator. The alias file is **test input metadata**, not evidence of a trusted production manifest or proof that a compiler accepted the source. Consumers must remove the temporary directory afterwards.

## Authorized local Node 22 execution when Actions admission is blocked

From a **clean, authorized checkout of this exact PR head**, run:

```bash
bash tools/verify-namespace-authoring-offline.sh "$(git rev-parse HEAD)"
```

For independent verification, pass the reviewed exact 40-character PR commit
instead of deriving it from the local checkout. The script fails closed if the
Git worktree is dirty, `HEAD` differs from the supplied commit, Node is not
version 22, or any of the five source corpus/test blobs differs from `HEAD`.
It prints each Git blob SHA, the exact Git tree and Node version, runs the
**actual** `node --test` suite, then prints
`NAMESPACE_AUTHORING_PASS ... scope=NOT_COMPILER_OR_GUEST` only after success.

This path uses no cross-repository checkout, network access, plugin secrets,
external package manager or GitHub Actions minutes. Its output can serve as a
*locally executed source-free Node receipt* when accompanied by a reviewed
exact checkout and captured exit status. It is **never** JUnit, CTest, native
guest, manifest/lockfile authentication, or runner-admission evidence. The
script was separately syntax-checked and exercised with two synthetic Node
fixtures in a disposable clean Git repository; this is not a run of the
real Oreslang source suite.

## Repeatable cross-backend source identity gate (not a guest run)

Given **independently authorized local checkouts** of the Java and LLVM source
branches, compare their embedded exact guest fixture bytes without network,
GitHub tokens or cross-organization source export:

```sh
node tools/compare-namespace-backend-corpus.mjs \
  /authorized/java/src/test/java/dev/oreslang/PinnedNamespaceSharedCorpusTest.java \
  /authorized/llvm/tests/native_pinned_namespace_ir_test.cpp
```

The tool rejects unlisted, duplicated, re-owned, or changed source units. It also rejects any byte drift in the independently authored Java/LLVM extended exit-53 guest source. A
successful response is explicitly `SOURCE_IDENTITY_ONLY_NOT_COMPILER_OR_GUEST`;
it does **not** establish compiled or executed parity. The source-only synthetic
tests are `tests/namespace-backend-source-identity.test.mjs` and must not be
counted as checking an actual backend checkout. The source snippets were
verified as 12/12 Java and 12/12 LLVM source/path/owner byte matches against
the shared contract Git blob
`34b2f245000bc5965371e0b03f64ea8af0e5d78f`; repeat at every new head.

## Real backend promotion recipe (not implemented by the source-free materializer)

1. Select the independently reviewed grammar profile and exact backend PR head/tree. Pin the actual production compiler binary/build provenance.
2. Build a source-owned **closed package inventory** and exact dependency manifest/lockfile pins. Reject any input not included by these pins, regardless of file or namespace name.
3. Compile the untouched `ns-exit-43` case through the shipping backend entry point, not a source-free oracle. Link and execute the generated guest; assert process exit 43, no unexpected output, and no alternate host-executed implementation. Then compile the extended positive independently and assert guest exit 53. Neither positive may rely on source-authored or host-computed exit values.
4. For all 15 negative cases, enforce appropriate compiler-owned rejection code and no emitted executable. Wrong package pin, private/duplicate exports, wrong arity/type, ambient paths, and lexical binding collisions must fail closed as portable semantics. Named-argument ABI, provider initialization, and provider cycles are restricted scalar-profile failures only; a full language compiler may support those constructs with checked semantics.
5. Repeat with source input order permuted; compare observable results and deterministic ABI/public symbol identities. ABI change in any public provider invalidates dependent cache fingerprints.
6. Record exact source PR head, source tree SHA, compiler source SHA, binary identity, workflow run+attempt, job IDs, runner IDs, executed steps, actual compiler/native/Wasm/NativeAOT output, and independent review. Source-free authoring checks and zero-step workflow failures never promote `compiler_executed`/`guest_executed`.

## Backend gaps

- **Java/Graal**: #2255 implements a pinned `ns` frontend/linker, while #2258 → #2263 implements the other `import namespace` profile. Neither is a proven unified grammar; confirm actual Graal guest execution and full package authority on the pinned source tree.
- **LLVM**: #1162 host graph → #1224 real pinned scalar lowering, limited to a closed inventory and scalar positional int/bool calls. Production filesystem loader remains fail-closed. Native fixture and CTest steps still need real runners.
- **.NET Native AOT**: [issue #275](https://github.com/ores-truffle-oreslang/oreslang-source.net/issues/275) specifies native CIL guest execution and negative gates.
- **Wasm**: [issue #211](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/issues/211) requires exact pinned LLVM-to-wasm32 code and Wasmtime execution.
- **Forge**: [issue #158](https://github.com/ores-truffle-oreslang/oreslang-source.forge/issues/158) requires verified source codegen/native execution.

## Security boundaries

No global search by namespace spelling. No implicit cross-package access. No reusing root dependency aliases in provider packages. No source-file symlink/dangling marker authority, unlisted source byte admission, caller-selected executable path fallback, or stale digest/ABI cache acceptance. Keep runtime and compiler tests within the source organization until independently approved private CI policies authorize otherwise.

**No branch promotion, merge readiness, compiled parity, or source-transfer authorization is claimed by this proposal.**
