# Freestanding core / alloc / std candidate source audit

Related normative specification: atto-lang/atto-spec PR #42. Integrated candidate for atto-common-source PR #30 from freestanding guard PR #23. The initial canonical `stdlib/core/identity.atto` stays unmodified; the canonical source byte manifest still independently pins its SHA and the other six `.atto` modules.

## Boundary

| Layer | May depend on | Never implicitly depends on |
| --- | --- | --- |
| `core` | other core modules; target primitives | allocator, std, OS, libc, foreign host library, stdio or scheduler |
| `alloc` | core, alloc, explicitly supplied allocator | std, OS, libc, host malloc |
| `std` | core, alloc, hosted adapters | portability without per-target capability approval |

All `stdlib/**/*.atto` files must have a manifest entry with the exact canonical path, layer, direct imports, capability requests and `NOT_EXECUTED` evidence state. A missing, duplicate or unclassified .atto source, undeclared import or upward dependency fails the structural gate. Import declarations are accepted only in the current conservative canonical forms `import module alias from "stdlib/layer/file.atto";` or `import "stdlib/layer/file.atto";`. Unknown forms are rejected pending an AST-aware resolver, not silently allowed.

The lexical guard ignores ordinary comments and string literals, but it is **not a compiler parser or a substitute for typed effect/linker analysis**. It catches a narrow banned set of host and allocator forms. Future compiler implementations must reject equivalent aliases, macros, dynamic/foreign imports, re-exports and generated calls, and verify the **final image**'s undefined symbols, relocations, host imports, startup, scheduler and panic handler. A mere import-free Wasm module or AOT build is not bare-metal guest proof.

## Structural tests

```sh
node --test tests/library-layers.test.mjs
node src/library-layers.mjs .
```

The test corpus contains successful core / alloc / std import graphs and mutation-driven rejection of upward dependencies, cyclic same-layer/self imports, host calls, missing inventory, malformed import syntax, implicit dynamic allocation, NUL/BOM source, symlinked library roots, unclosed source, and forged execution claims. These tests run on **host Node**, not on a real compiled Atto guest.

## Outstanding implementation gates

1. Link an Atto core-only image without libc, OS, host allocator or implicit runtime on a known Cortex-M/RISC-V target and execute it under QEMU/device.
2. Add a separate alloc-enabled test image with a platform-supplied bounded allocator and deterministic exhaustion.
3. Implement compiler graph and typed effect admission plus exact diagnostic/no-binary tests for all backends; guard actual compiler-emitted objects against unapproved undefined/host symbols.
4. Record per-backend source/tree SHA, toolchain, target, emitted binary, executable guest results and explicit NOT_EXECUTED/UNSUPPORTED status. Do not relabel structural tests as five-backend parity.

Current status: **seven-module structural candidate**. `freestandingGuestProved=false`, `backendParityCertified=false`. The seven canonical sources are uncompiled candidates; no `OwnedBytes` runtime guest or cross-backend AOT parity has been verified.

## Integration with the existing ByteBuffer candidate

[atto-common-source #30](https://github.com/atto-lang/atto-common-source/pull/30) proposes additional canonical `.atto` source files under `core`, `alloc`, and `std`. These remain draft source candidates; no actual guest/runtime parity is inferred. This guard's repository test now loads the checked-in layer manifest instead of assuming that `identity.atto` is forever the sole module. **This combined PR #30 candidate registers all seven checked-in `.atto` paths**, capabilities and actual direct imports in `contracts/library-layers-v1.json`. Both the SHA-256 canonical source manifest and structural guard must pass at the combined exact head before review or merge. An unlisted file is a hard failure; merely changing the test expectation is not acceptable.

Current cycle detection is structural; macros, generated imports, and final linker edges still require compiler-side admission. Root symlinks, UTF-8 BOM, NUL source and same-layer cycles are rejected conservatively before any freestanding proof can be claimed.

### Lexical and manifest admission hardening (2026-11-21)

The narrow structural scanner now handles balanced nested `/* ... */` comments up to depth 64 and ignores inert exact keyword **string literal tokens** (e.g. `"ffi"`, `"new"`). Real host/actor/allocator calls outside comments and strings are still rejected. Unsupported/unclosed/deeper comment forms fail closed. The layer selector rejects inherited prototype names (`constructor`, `toString`, `__proto__`), and manifest object/array checks reject hidden or accessor-backed metadata, including extra symbol keys. This prevents forged structural source/manifest shapes without implying AST-aware compiler effects, artifact linking, or Atto guest execution.

## Allocation-free measurement and sign refinement candidate

`stdlib/core/measure.atto` defines seven SI base dimensions, common exact linear units and an independent Information dimension with decimal/binary storage units. Its signed int/i32 interval aliases use the existing file-local Verified Core syntax. It is a shared reference prelude, not yet an importable public library: nominal cross-package identity, public type exports, generic and non-interval refinements, compound named units, absolute/affine temperature, and real guest execution are separately gated. No allocator or host dependency is required. Never add a sign as a dimension or unit. Production backend implementations remain independently owned. See atto-spec proposals/verified-core-quantities-v1.md and proposals/verified-core-refinements-v1.md. The byte and layer checks remain HOST_ONLY.
