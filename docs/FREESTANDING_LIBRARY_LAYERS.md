# Freestanding core / alloc / std candidate source audit

Related normative specification: atto-lang/atto-spec PR #42. This guard is stacked on atto-common-source PR #6, whose initial canonical file is `stdlib/core/identity.atto`. It does **not** rewrite that source or weaken its SHA-pinned byte-identity gate.

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

Current status: **structural candidate**. `freestandingGuestProved=false`, `backendParityCertified=false`, and only the single initial canonical identity module is present on the stacked branch.

## Integration with the existing ByteBuffer candidate

[atto-common-source #30](https://github.com/atto-lang/atto-common-source/pull/30) proposes additional canonical `.atto` source files under `core`, `alloc`, and `std`. These remain draft source candidates; no actual guest/runtime parity is inferred. This guard's repository test now loads the checked-in layer manifest instead of assuming that `identity.atto` is forever the sole module. **Before #30 and #23 are merged together**, all added source paths, capabilities and actual direct imports must appear in `contracts/library-layers-v1.json`, and both the exact-byte canonical manifest and structural guard must pass on the integrated tree. An unlisted file is a hard failure; merely changing the test expectation is not acceptable.

Current cycle detection is structural; macros, generated imports, and final linker edges still require compiler-side admission. Root symlinks, UTF-8 BOM, NUL source and same-layer cycles are rejected conservatively before any freestanding proof can be claimed.
