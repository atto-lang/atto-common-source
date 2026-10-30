# Package-scoped multi-file namespaces and single-import aggregation — v1 proposal

**Status:** normative proposal and source-free reference checks only. No backend currently has verified end-to-end support for this import form. Do not present these reference tests as compiler, runtime, NativeAOT, or Wasm execution evidence.

## Required behavior

A verified package of ten files can contribute four files to `billing`, three to `identity`, and three to `telemetry`. Each file begins with the existing flat source header (for example, `namespace billing;`). All declarations publicly exported by the four `billing` files are reachable through **one** static namespace import. This is true from another file within the package **and** from a separately resolved dependent package. An imported namespace is compile-time linking metadata; it is not an instantiated Oreslang module or a runtime reflection object.

Example package manifest (proposed `.ores.pkg.toml` schema v2, reusing the manifest from `PACKAGE_VISIBILITY_AND_MULTIFILE_V1.md`):

```toml
schema_version = "2"
[project]
name = "checkout-project"
root = "."

[packages.checkout]
files = [
  "src/billing/invoice.ores", "src/billing/charges.ores",
  "src/billing/refunds.ores", "src/billing/ledger.ores",
  "src/identity/accounts.ores", "src/identity/sessions.ores",
  "src/identity/policies.ores",
  "src/telemetry/events.ores", "src/telemetry/metrics.ores",
  "src/telemetry/traces.ores",
]
```

Provider source:

```ores
// src/billing/charges.ores
namespace billing;

pub fnc charge(int cents): int { return cents; }
pub[pkg] fnc calculate_fee(int cents): int { return cents; }
```

Within the same **verified checkout package**, one file imports all four billing providers without enumerating filenames:

```ores
namespace identity;
import namespace billing from "+/";

pub fnc demo(): int {
  return billing.charge(42) + billing.balance();
}
```

From a different package, `checkout` must be a pinned dependency alias that resolves to **one exact package instance**, not a disk directory scan, repository name, or unversioned package-name guess:

```ores
namespace client;
import namespace billing as payments from "checkout";

pub fnc demo(): int {
  return payments.issue() + payments.refund();
}
```

The precise `import namespace` grammar, same-package `"+/"` locator, and dependency-alias lookup above are the **new feature under proposal**; they are not claims about parser support on `main`. Existing `import module`, `import fnc`, and file-based `import * as alias from "./file"` retain their own semantics.

## Resolution invariants

1. **Package authority first.** Use the canonical `.ores.pkg.toml` manifest's explicit `[packages.<key>].files` entries and pinned dependency instance. Unlisted files are singleton packages and cannot silently join an aggregate. Do not discover membership by scanning a folder, sharing a namespace string, or following `ORES_PATHS` into a different project.
2. **Aggregate by (PackageInstanceId, namespace).** A namespace header identifies membership *within one verified package only*. Four files with `namespace billing;` in one package aggregate; a same-named namespace in another package does not.
3. **One import, exact symbol providers.** The import binds a single local namespace alias, whose member table consists of all eligible declarations from the package's files with that header. Calls, types, classes, actors and explicit modules must be resolved to a specific canonical source-unit provider before lowering. No implicit re-export of imports.
4. **Visibility.** Public declarations can cross package boundaries. `pub[pkg]` may be accessed only inside the same exact package instance. `pub[file]` and private members do not become other-file visible by namespace aggregation. Visibility of a module member also intersects the containing module's visibility.
5. **Reject ambiguity.** A duplicate symbol in the same namespace and name/kind domain is a build error, except for statically proven legal overload families with distinct supported arities. Distinct package instances never merge; different namespaces within one package never merge. Local alias collisions reject.
6. **Build safety.** Snapshot the complete verified file set before graph linking. Canonicalize each physical source identity, reject duplicate membership/aliases, symlink escapes, traversal, nested manifest boundary crossing, missing files and header mismatches. A declared `project.root` subdirectory must not contain another `.ores.pkg.toml` at its own root or in any provider ancestor, including a dangling manifest-marker symlink. An exact dependency source-set digest must include **all and only** the manifest-listed canonical provider files, exactly once; sorted paths ensure the hash does not depend on enumeration order. Reject omitted, duplicate and unlisted digest inputs. Set strict file, source-size, declaration, import-depth and graph budgets. An import does not perform I/O after admission or run guest initialization.
7. **Dependency/ABI safety.** The namespace ABI is a deterministic fingerprint over package-instance ID, normalized namespace, provider canonical source ID, symbol identity, effective visibility and public type/effect signatures. Changes to *any* contributing file's public ABI invalidate dependent namespace imports. Private-only edits must not widen authority; hot reload cannot retain a stale public export table.
8. **Runtime and backend parity.** Namespace import resolution must be statically equivalent in Java/Graal, LLVM, .NET and Wasm, with fail-closed unsupported diagnostics until each native linked path is implemented. A parser-only pass and reference-model pass are not proof of execution parity.

## Conformance matrix

The accompanying `contracts/package-namespace-multifile-v1.json` enumerates ten provider files spread across three namespaces and verifies same-package and external-package access, all four billing files behind one import, package-private denial, wrong namespace, nonexistent namespace, and separation between two same-named but differently pinned dependency package instances. The negative mutation matrix tests duplicate public exports, inconsistent headers, duplicate file membership, traversal, and unlisted files.

Source-free reference command (after adding the verification script):

```sh
python3 scripts/verify_package_namespace_multifile_contract.py
```

**Promotion gate:** Only an exact-head, executed positive runtime fixture and corresponding negative compiler fixtures can promote backend status to `linked`/`executed`. Until then, the Java source namespace label and single-file import are *not* a working multi-file namespace import, and LLVM source graph support remains limited. Do not mirror private source across GitHub organizations absent independently approved destination authorization.

Related: `docs/PACKAGE_VISIBILITY_AND_MULTIFILE_V1.md`, `docs/PROJECT_ROOT_IMPORTS_V1.md`, Java namespace/module boundary draft PR #2169, LLVM experimental source import draft PR #492.
