# AttoLang package/archive/binary import parity v1

**Status: proposed and SOURCE-FREE ONLY. No compiler, binary linker, or guest execution is certified here.**

Machine-readable fixtures: [package-binary-import-v1.json](../contracts/conformance/package-binary-import-v1.json)
Executable reference tests: [package-binary-import-v1.test.mjs](../tests/package-binary-import-v1.test.mjs)

## Objective and compatibility

Importing one resolved package must expose the same qualified public API whether it is a source directory, verified source archive, or backend-specific compiled payload. The external consumer must never depend on the provider's original file layout.

Preserve existing rules in ATTO_IMPORT_RESOLUTION_V1, PROJECT_ROOT_IMPORTS_V1, PACKAGE_VISIBILITY_AND_MULTIFILE_V1 and NAMESPACE_MULTIFILE_PACKAGE_JS_V1. The Java experimental `.oresi` export envelope should be safely versioned and extended, **not replaced with a competing `.atmi` binary interface**.

## Proposed syntax (not yet ratified across compilers)

```atto
import pkg bar from "pkg:bar";
import module parser from "pkg:bar";
import namespace network from "pkg:bar";
import module local from "./local.atto";
import module project from "+/src/project.atto";
```

The `pkg` import provides a qualified API handle only. It does not inject unqualified names, eagerly initialize everything, or grant permissions. `import ns` versus `import namespace`, explicit `as` aliases, and self-package namespace selectors remain separately proposed grammar choices: do not treat these as equivalent until ratified and parsed by real frontends.

## Normative identity/admission proposal

1. `pkg:bar` resolves only through an explicit manifest alias and immutable lock entry to exactly one PackageInstanceId and public interface digest. Ambient search paths and directory names must never shadow a pinned dependency. Import is not package installation.
2. Namespace identity is `(PackageInstanceId, flat NamespaceName)`. Module identity is separately `(PackageInstanceId, ModuleName)`. Verified source inventories can contribute multiple files to one package-local namespace, never merge across packages.
3. `pub` exports are accessible only if all enclosing declarations are public. `pub[pkg]`, `pub[file]` and private declarations are never leaked through binary metadata, wildcard imports or namespace facades.
4. Physical relative paths (`./`, `../`, `+/`) resolve inside the owning verified source package. For a source archive, logical archive paths replace physical disk paths. External importers use public logical selectors, never `pkg:bar/src/internal.atto`. A compiled-only dependency has no relative-source-path fallback.
5. Source archives must have bounded bytes, a closed verified inventory, canonical forward-slash names, no traversal, duplicate/casefold collision, symlink/hardlink/special files or nested-package escape. Production loaders must additionally handle tar PAX overrides, decompression bombs, descriptor-safe reads and TOCTOU; these model tests do not parse actual tar bytes.
6. Compiled payloads must bind exact immutable package identity, independently verified interface digest, compiler/target ABI and payload digest. Neither a Java JAR nor .NET CIL nor a Wasm component is automatically usable by another target. Backend-native code and portable public interfaces are distinct.
7. Source or verified portable IR may be recompiled only by a compiler that actually supports and checks that representation. No silent host fallback, guest privilege elevation, actor-state access, global singleton sharing, or automatic capability grant arises from import.
8. Existing `.atto.pkg.toml` and `.ores.pkg.toml` manifest conventions require fail-closed precedence/migration reconciliation. Do not silently change existing source roots or legacy imports.

## Interface digest scopes and first compiler implementation

The common reference vector's `interface_sha256` is an **abstract proposed target-neutral semantic export fingerprint**, not the actual SHA-256 of Java's `.oresi` v1 bytes. Existing `.oresi` v1 includes compiler-version, target ABI and feature-policy strings; consequently the actual envelope hash changes by target and compiler profile. A future cross-backend semantic digest must be separately specified and independently derived from resolved exported types, effects, nominal identities and visibility. It is **NOT_IMPLEMENTED**.

Initial real compiler metadata admission drafts: [Java #2880](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2880) and [LLVM #1699](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1699) read the existing target-specific `.oresi` v1 envelope, with a frozen test fixture hash `8db5681e1e41c389e2358f9e0cd5c46e78b5b33519ed4769056268a240847f3d`. Those drafts do not yet wire the real `pkg:` import grammar, trusted package archive, object linker or Atto guest execution. Do not label their host-only tests cross-backend language parity.

## Promotion gates for all nine repositories

| Repository suffix | Required actual compiler/runtime proof |
| --- | --- |
| `.java` | Linked imports on JVM and no-fallback Graal Native Image, versioned `.oresi` |
| `.llvm` | Native relocatable link, O0/O2 AOT, ASan/UBSan and ownership diagnostics |
| `.net` | Typed CIL import binding and independently run Native AOT guest |
| `.wasm` | Verified wasm32 multi-package link and executed guest, not scalar bridge or stub |
| `.forge` | Real Forge module/namespace link, full AOT and JIT where applicable |
| `.js` | Verified ESM facade and explicitly authorized trusted package execution |
| `.rs` | Rust backend's real compiled guest path with typed import resolution |
| `.cranelift` | Independently compiled Cranelift guest, not Rust host-only tests |
| `.hdl` | Defined restricted hardware profile, explicit feature rejection without full-language parity claims |

Every backend acceptance receipt must bind exact input/source SHA, PR head SHA, compiler SHA, package interface SHA, target ABI, output digest, real CI step count and guest exit. An authored test or host-only model is **NOT_EXECUTED** for guest parity. Different target payloads may share an interface only when the independently executed public API/ownership/visibility results match.

## Tests

The source-free Node suite validates 28 positive/negative vectors, including source versus compiled export identity, package shadowing, `pub[pkg]` leaks, path-based external imports, archive traversal, symlink/duplicate/unlisted members, target ABI mismatches, missing target payloads and zero-step receipt rejection. These are metadata/reference assertions only, not real archive extraction, compiler parsing or linker execution.

First real promotion fixture: compile the same two public symbols using (a) source, (b) verified tar archive source, and (c) target-compatible precompiled binary; compare guest exit/observable behavior. Negative tests must fail before partial artifact publication.
