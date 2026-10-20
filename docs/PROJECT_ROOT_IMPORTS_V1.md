# Oreslang project-root imports: cross-backend contract v1

Status: **normative language design**, not a claim that all backends implement it.

## Canonical spelling

```ores
import module telemetry from "+/lib/telemetry";
import module store from "+/lib/store";
```

Exactly `+/` anchors a quoted source-import path to the **current Oreslang project's
root**. `+lib/telemetry` is invalid and MUST NOT be normalized silently.
The plus prefix distinguishes project-local imports from bare package imports,
relative `./` and `../` imports, sealed `std/` imports and host imports.

## Project ownership and root discovery

1. With an explicit `--project-root=DIR` CLI option, select `DIR` and
   require a recognized manifest there. `--project-root` overrides the
   `ORES_PROJECT_ROOT` environment setting.
2. Otherwise, when `ORES_PROJECT_ROOT` is set, select its directory and
   require a recognized manifest. A missing/invalid override is an error.
3. Otherwise, starting at the entry source file's directory (not the process
   working directory), walk upward to the **nearest directory** containing
   `.ores.pkg.toml` or legacy `.oreslangc.cfg.toml`. When both exist in that
   directory, prefer `.ores.pkg.toml`. If no entry file was given, start
   discovery at the process working directory.
4. The package filesystem root is the `[project].root` directory declared
   in the discovered manifest, resolved from that manifest's directory.
   An absent `[project].root` defaults to `.`.
5. Manifest schema validation and project-root selection MUST complete before
   loading project-relative modules. A `+/` import without a recognized
   manifest MUST fail, even if an identically named bare package is available.

The explicit override selects a **manifest directory**; it does not rewrite
the `[project].root` field inside that manifest. Source-file names in the
manifest remain root-relative, consistent with the existing Java manifest.

## Modern manifest configured-root admission

When a modern `.ores.pkg.toml` selects `[project].root`, the value is
`.` or a canonical nonempty, forward-slash-only relative path within the
manifest's directory. Reject absolute paths, parent traversal, redundant
dot/empty components, backslashes, colon/control characters, missing roots,
and physical symlink escapes. Nested modern or legacy package manifests
along either the spelled or physically resolved selected-root path must
not inherit parent authority. A modern manifest with an incorrectly typed
known field is invalid, not an instruction to apply default values.

Legacy-manifest migration semantics may remain a separately tracked
compatibility profile; they must not silently weaken modern package
isolation. Hosts which lack safe physical-path verification should reject
unsupported roots before loading source. The new cases in the shared
`namespace_parity_cases` corpus capture these decisions, including
dangling nested legacy markers.

## Nearest manifest and alternate source namespace isolation

**Choose the closest directory containing either manifest marker first.**
Within that one directory, `.ores.pkg.toml` overrides the legacy marker.
An ancestor modern manifest **cannot** override a nearer legacy package.
Malformed nearest-directory markers fail closed; do not search higher
ancestors to change package ownership.

This physical/lexical package boundary applies to all filesystem import
namespaces, not only `+/`. `./`, `../`, and bare source-root imports
must reject a source inside a nested package owned by another manifest.
If a source is spelled through the owning project's root, a symlink to an
outside file cannot turn it into a legitimate bare import. An unrelated
explicit ambient search root may have its own ownership and is not silently
granted this project's authority.

The shared matrix includes positive nearest-legacy and same-level-modern
priority, negative nearest-invalid fallback, bare/relative nested-package
denials and a bare-source symlink escape. Mark unsupported backends
`admission-only` or `resolver-only`; do not treat Wasm's refusal to publish
an unresolved graph as an executed imported function.

## Manifest-marker shadowing and failure rules

A discovered `.ores.pkg.toml` marker has precedence over a same-directory
legacy `.oreslangc.cfg.toml` marker **by existence, not parse success**.
If the modern path exists but is a directory, symlink (including dangling
or same-directory aliases), unreadable file, or invalid manifest, discovery
must fail closed. It must not silently fall back to legacy config, an
ancestor manifest, bare-package import resolution, or a manifestless project.

Likewise, an existing invalid legacy marker must never be silently ignored
as though no manifest exists. Actual file open/parse should use a trusted
source snapshot or equivalent descriptor-backed strategy when the filesystem
can be modified concurrently; path checks alone do not eliminate TOCTOU.

The `namespace_parity_cases` matrix includes directory, dangling-symlink,
same-directory symlink and invalid-legacy negative fixtures. A backend
which has no package-root resolver should reject the entire source import
before reading or publishing artifacts.

## Import-resolution invariants

* `+/segment/path` resolves ONLY under the selected project root.
* Empty path, empty segment, `.` segment, `..` segment, and backslashes
  within a `+` import are invalid. Canonical spelling is forward-slash-only.
* Do not fall back to `source.roots`, `source.import_paths`,
  `ORESLANG_PATH`, a global vendor directory or the dependency resolver.
  A missing explicit import is a compile-time error.
* Preserve Oreslang's existing file probing: exact file first, then `.ores`,
  then `.java` if no recognized source extension is present.
* Normalize the selected path and require it to remain beneath the configured
  root. For an existing candidate, also resolve symlinks and require the real
  target to remain beneath the real project root. On verification failure,
  reject. Never permit a `+/` import to bypass the source-admission limits.
* Importer depth and compiler working directory MUST NOT affect resolution.
* Record the resolved source identity in the compilation's import graph.
  Static/AOT linking and runtime loading MUST use the same mapping.
* Existing `./`, `../`, host and bare imports retain their established
  semantics. `+/` is not an implicit permission to read arbitrary files:
  compiler source-admission policy still applies.

## Nested-package boundaries and physical source identity

A project-root import must check both the **spelled path** and the
**canonical physical target** against package boundaries. For example, if
`nested/.ores.pkg.toml` exists, a parent project must reject
`+/nested/parent-alias` even when that symlink resolves to
`lib/helper.ores` in the parent package. The physical identity check
alone is insufficient. An alias within the same package remains legal
when it does not escape the physical root. A dangling or invalid nested
manifest marker must fail closed, not fall back to the parent manifest.

The machine-readable `namespace_boundary_cases` in
`contracts/project-root-import-v1.json` freeze these distinctions. The
Python source-only contract test is not backend execution evidence.

**Backend root-authority alignment remains pending:** this contract selects
`[project].root`, resolved from the selected manifest directory, as the
filesystem anchor for `+/`. The historical platform-conformance v1 issue
and LLVM PR #448 instead use the manifest directory. The retained
`root-anchor-vs-project-root` tracking item records that implementation gap,
not a second permitted interpretation. Do not mark resolver parity until
the configured-root and rejection cases execute on each backend.

## Importer-relative and dot-prefixed bare names

Explicit `./local` and `../up` resolve from the **importing source
file's directory**, independently of process CWD or `[source].roots`.
A bare name starting with a dot, such as `.hidden/helper` or
`..backup/helper`, is **not** an explicit relative import; it follows
ordinary bare-source lookup precedence. Do not implement this using a
generic `startsWith(".")` test.

The `relative_source_cases` in
`contracts/project-root-import-v1.json` pin these identities. Current
.NET/Forge experimental host resolvers can establish a restricted
within-root mapping but still lack guest import binding; Wasm's scalar
bridge must continue to reject unresolved `./` and `../` imports before
any artifact publication. Do not confuse host-only source resolution with
linked module execution or completed five-backend parity.
## Relative, bare, environment and package-boundary parity

The existing source namespaces must not be changed by a `+/` implementation:

- Only `./file` and `../file` are importer-relative. Dot-prefixed bare
  modules such as `.hidden/helper` and `..backup/helper` search ordinary
  configured paths; never treat a leading dot alone as relative authority.
- For bare imports, search `[source].roots`, then
  `[source].import_paths`, then colon-separated `ORES_PATHS`, then
  host-native-delimited `ORESLANG_PATH`. Duplicate roots keep the first
  occurrence. Empty ambient path components never grant implicit cwd.
- Omitted `[source].roots` defaults to `["."]`; explicitly written
  `roots = []` disables that implicit search root. The distinction must
  survive discovery, linking, native builds and validation.
- A parent package's `+/` cannot enter a child package containing
  `.ores.pkg.toml` **or** `.oreslangc.cfg.toml`. Test both spelled and
  canonical physical paths: a symlink alias into a child must not launder
  access across the namespace boundary. In-root noncrossing symlink aliases
  must retain a single canonical source identity.
- The `[project].root` directory can be a subdirectory of its manifest
  directory: `[project] root = "app"` means `+/src/helper` resolves to
  `app/src/helper.ores`, not to the manifest directory's `src/helper.ores`.
  A backend that does not support that value must reject it explicitly;
  silently ignoring it violates the contract.

The `namespace_parity_cases` array in the shared JSON is a normative
**scenario description**. Backends may implement audited adapters, and must
report `unsupported`, `admission-only`, `resolver-only`, `linked` or
`executed` separately. An accepted import preamble, a passing parser test,
a source-free CI run, or a zero-step GitHub Actions job cannot demonstrate
an executed imported function or real wasm32 source graph. Runtime release
evidence must be tied to a verified exact candidate tree and source graph.

## Backend parity and admission gates

The v1 contract applies to .java, .llvm, .net, .wasm and .forge, but
implementation declarations must be capability-specific.

* **.java:** implement filesystem module resolution, import graph recording,
  check/run CLI and test executable import from deeply nested source.
* **.llvm:** implement parsing, importing source units, root selection and AOT
  link; no success may be claimed by accepting a string without actually
  linking its target.
* **.net:** implement source module graph, CLI root selection and CIL/AOT import
  binding; the existing scalar-only source parser cannot claim parity.
* **.wasm:** use the source compiler's graph and enforce the same root and
  source identity through artifact packaging; guest Wasm imports are a
  separate capability boundary. No host filesystem access is granted to
  the guest by this syntax.
* **.forge:** implement source graph and module linkage before treating
  `+/` as supported; the bootstrap single-function parser must fail closed
  until that work is present.

Each backend must execute the shared fixtures at
`contracts/project-root-import-v1.json` (or supply an equivalent audited
adapter), distinguishing **resolve**, **reject**, and **compile+link+execute**
evidence. An unimplemented backend should reject the source explicitly rather
than silently interpreting `+/` as a package import.

## CI release criterion

1. Resolve and link the deeply nested fixture at the same source identity.
2. Explicitly reject all invalid prefix/traversal/symlink/no-manifest cases.
3. Verify override precedence and nearest-manifest behavior.
4. Pass same-tree CI including native distribution/AOT modes where supported.
5. Report per-backend status as unsupported / resolver-only / linked / executed
   rather than a single misleading green parity badge.

Companion work: Java `oreslang-source.java#1082`. Existing private-repo CI
mirror safeguards still apply; never copy private trees into a public carrier
to obtain CI minutes.

## Modern-manifest newline integrity

The modern package manifest follows TOML's LF and CRLF line endings. A lone
CR is not a line separator and must **fail closed** before choosing the
`[project].root` authority. In particular, a parser which splits only on
LF but greedily ignores the rest of a `#` comment might otherwise miss a
second `[project]` table or a conflicting root after a hidden CR.

The shared `namespace_parity_cases` now includes an invalid bare-CR
comment with a hidden root, an invalid bare-CR at EOF, and a positive CRLF
configured-root case. Java must use its full TOML parser or an equivalent
strict validator; .NET, Forge and native LLVM must reject unsupported
manifest encodings rather than silently defaulting to the manifest parent.
Wasm must continue to deny an unresolved source graph prior to artifact
publication. Passing resolver checks remains `resolver-only`, **not**
linked/native/AOT import parity.
