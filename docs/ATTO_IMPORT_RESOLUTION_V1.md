# AttoLang static import resolution v1

Status: **normative proposal with partial Java/Graal implementation**. This document is not a five-backend compiler parity claim. The machine-readable companion is [attolang-import-resolution-v1.json](../contracts/v1/attolang-import-resolution-v1.json).

## Separate namespaces

```atto
// The pre-existing canonical +/ operator targets the verified package project root.
import * as config from "+/src/config";

// This is an actual compile-time environment variable named "repo".
import * as config from "${repo}/src/config";

// Multiple variables may appear in one static string.
import * as math from "${ATTO_SDK}/math/${VERSION}";

// Not a project-root alias and NOT expanded as an environment variable.
import * as foo from "$repo/src/foo";
```

The forms have different authority. `+/` binds to the selected nearest package manifest's configured `[project].root`; it does not read the `repo` environment variable. The variable spellings are **`${NAME}`** only. This specification does not introduce a `$repo` shortcut or rename `+/`.

At compile time, the resolver uses an immutable, caller-supplied environment snapshot and expands each syntactically valid `${NAME}` exactly once. A variable name is ASCII `[A-Za-z_][A-Za-z0-9_]*`. Missing and empty variables, nested `${...}` in substituted values, malformed names and unterminated expressions are errors. No `sh`, `bash`, `eval`, executable substitution, default parameter expansions, percent-style interpolation, recursive expansion or silent fallbacks. The limit is 4,096 UTF-8 bytes after substitution. Error messages must identify the *variable name*, never print variable contents.

Source graph edges retain both the original import string and the canonical resolved source identity. Import-derived environment values (or secret-safe fingerprints) are compilation inputs that invalidate caches and appear in build provenance. An import with an environment-derived absolute filesystem path must still pass source admission, file identity, permission, package-boundary and symlink checks. For `+/`, substituted segments may not traverse outside the package root. The import parser should not treat environment variables as capability grants.

## Project-root manifest authority and Zed package markers

The nearest regular, non-symlinked `.ores.pkg.toml` establishes the modern
project root; if a same-directory legacy `.oreslangc.cfg.toml` also exists,
the modern marker takes precedence. A malformed modern marker **must not**
silently fall back to the legacy file.

The modern manifest admits exactly one of two identity declarations:

- Compiler schema: `schema_version = "1"`.
- Native Zed source-package marker: a validated `[package]` table containing
  a `name` string consisting of lowercase ASCII letters, digits, and hyphens,
  beginning with a letter or digit.

The second form permits installed native Zed AttoLang packages such as
`[package]\nname = "consumer"` to use `+/` without requiring an unrelated
compiler-specific schema field. Invalid, missing, or conflicting identities
must not silently establish import authority. A strict native parser may admit
only a documented subset of TOML and must reject unsupported constructs
affecting the configured root rather than defaulting to CWD.

A plain `[project].root = "application"` is a path relative to the physical
manifest directory. It must remain inside the manifest's package boundary,
must be independently verified after filesystem normalization, and must
respect nested package markers. A `+/` import resolves **relative to that
configured root**, not the process CWD or `${repo}`.

For an environment-expanded absolute import, the required authority is a
physical source identity inside the importing package's configured project
root, or inside a source root explicitly permitted by its manifest. Merely
exporting `ATTO_PATHS` does **not** grant authorization to import an arbitrary
external absolute pathname. At present, the Java PR implements explicit
manifest import paths, while the LLVM PR only permits the importing physical
package root; the common external-path policy remains a **known parity gap**.

## Search paths

`ATTO_PATHS` is the canonical, OS-path-separated list for unbound filesystem imports. For compatibility, a compiler may read `ORES_PATHS` and then `ORESLANG_PATH` **only when** the higher-priority variable is absent; an explicitly empty `ATTO_PATHS` disables legacy fallbacks. Never turn empty components into the current directory or change the resolution of a pinned package based on ambient paths.

Project source roots and explicitly configured project import paths precede environment fallbacks. Zed package names are resolved by the package lock and verified dependency graph, never by guessing the first name found on the host filesystem. A checked-in `vendor/` folder is optional, but vendor entries must have declared, integrity-checked identities, not arbitrary shadowing. The user-level `zpkg` store is the shared artifact authority; `.atto` is compiler/toolchain state. **Do not** implicitly scan `~/.zed`, `~/.zpkg` or `~/.atto` for unresolved imports.

## HTTPS sources (not implemented by this contract)

The eventual syntax may be:

```atto
import * as util from "https://modules.example.org/v1/util.atto";
```

A compiler must **reject** remote source imports unless the resolver supports explicitly admitted HTTPS origins, locked immutable digests, bounded redirects/bytes, network capability checks, an offline/frozen no-fetch mode, and exact source-identity cache keys. Do not claim Deno-style remote imports are already supported. Download/cache policy belongs in Zed, and the compiler consumes a verified source graph; runtime network permissions are a separate capability.

## Execution gates

The feature ships when an identical `.atto` import corpus compiles, links and executes on Java/GraalVM, LLVM, Wasm, Forge and .NET/Native AOT. For each backend, preserve the input specifier, resolved paths, project root, environment bindings, source SHA, compiler SHA and generated guest outcome. LLVM native execution is not proof of Wasm guest parity; Forge/.NET host-only parsing is not an executable import implementation. Source fixtures and model tests must remain reported as **source-only** until real guest execution completes.

The first implementation phase should add `${NAME}` expansion to an existing compiler resolver, preserve `+/` behavior, and prove a real imported `.atto` helper call. The next phase enforces Zed lock authority and package cache provenance, then admits HTTPS behind a separate security/transport conformance contract.
