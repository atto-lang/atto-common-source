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

The test corpus contains successful core / alloc / std import graphs and mutation-driven rejection of upward dependencies, host calls, missing inventory, malformed import syntax, implicit dynamic allocation, unclosed source, and forged execution claims. These tests run on **host Node**, not on a real compiled Atto guest.

## Outstanding implementation gates

1. Link an Atto core-only image without libc, OS, host allocator or implicit runtime on a known Cortex-M/RISC-V target and execute it under QEMU/device.
2. Add a separate alloc-enabled test image with a platform-supplied bounded allocator and deterministic exhaustion.
3. Implement compiler graph and typed effect admission plus exact diagnostic/no-binary tests for all backends; guard actual compiler-emitted objects against unapproved undefined/host symbols.
4. Record per-backend source/tree SHA, toolchain, target, emitted binary, executable guest results and explicit NOT_EXECUTED/UNSUPPORTED status. Do not relabel structural tests as five-backend parity.

Current status: **structural candidate**. `freestandingGuestProved=false`, `backendParityCertified=false`, and only the single initial canonical identity module is present on the stacked branch.
