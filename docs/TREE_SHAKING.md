# Tree shaking and reachability contract

Status: proposed cross-backend contract. This document defines what Oreslang builds must eventually prove; it does not claim current backend parity.

## Goal

A release build must be able to omit unreachable Oreslang code, unused core/alloc/stdlib modules, unused runtime services, unused generated metadata and unused target resources without changing observable behavior.

Tree shaking is a semantic reachability problem first and a backend/linker optimization second. Backends may remove additional target-specific material, but they must not rely on linker garbage collection as the only definition of reachability.

## Required pipeline

1. Resolve imports, names, overloads, types, ownership/effects and target admission.
2. Construct a typed reachability graph over semantic identities.
3. Seed explicit roots.
4. Follow direct calls, dispatch targets, actor/message entrypoints, runtime operations, serializers, reflection/FFI declarations, hot-load manifests and generated glue.
5. Remove unreachable semantic nodes before backend lowering when safe.
6. Let the backend perform target-specific DCE/linker/synthesis pruning.
7. Emit a machine-readable reachability report.
8. Verify the shaken artifact against an unshaken/reference build for the supported observable contract.

## Roots

Roots are explicit. A backend must record the reason for every root.

Typical roots include:
- executable entrypoints;
- exported ABI/library symbols required by the selected artifact kind;
- actor handlers reachable from a spawned actor type;
- supervisor/lifecycle callbacks reachable from the selected runtime profile;
- explicitly retained reflection, serialization, FFI or plugin entries;
- hot-load generation entrypoints declared by the deployment manifest;
- target startup/interrupt/reset vectors;
- tests or benchmarks only when building a test/benchmark artifact.

Source visibility alone is not always a deployment root. A compiler may retain all public symbols for a library artifact while allowing an executable closed-world build to discard unused public symbols that are not externally exported by the artifact manifest.

## Dynamic features

Dynamic behavior must never be guessed away.

- Reflection, dynamic symbol lookup, FFI registration and plugin loading require explicit bounded metadata or conservative retention.
- Hot loading retains the loader/compatibility machinery only when enabled; future generations are separate artifacts and are not silently assumed to exist in the current closed world.
- Actor dispatch roots the concrete handlers that can receive messages under the admitted actor/protocol graph.
- Generic specializations are retained by instantiated semantic identity, not by generic source name alone.
- Serialization retains constructors/codecs only for admitted wire-visible types.
- Unknown dynamic reachability must fail closed for strict-minimal builds or conservatively keep the affected region.

## Runtime feature pruning

Runtime services are ordinary reachability nodes. A program that does not use a service must not be forced to retain it merely because the language supports it.

Examples include:
- actor scheduler/mailboxes/supervision;
- Tasks/async scheduler/timers/cancellation;
- heap allocator/collector or actor arena support;
- filesystem/network/TLS/HTTP;
- reflection/serialization;
- hot reload/JIT/compiler services;
- tracing/logging/metrics;
- platform capability brokers.

This requirement applies to core, alloc, stdlib, generated runtime glue and user dependencies.

## Target expectations

- JVM/HotSpot: minimize packaged guest/classes/resources and, when shipping a runtime image, use module/runtime-image pruning where applicable.
- GraalVM Native Image: combine Oreslang semantic reachability with Native Image closed-world analysis; generate required dynamic metadata explicitly.
- LLVM/native Linux/desktop/mobile: emit only reachable guest/runtime units, use function/data sections or equivalent object partitioning, then linker GC/LTO as appropriate.
- Embedded/bare metal: default to freestanding roots and omit OS, heap, scheduler and I/O services not selected by the program/profile.
- Wasm: omit unused guest functions, runtime imports and data segments; reject dynamic imports that cannot be proven/admitted.
- FPGA/ASIC: semantic reachability feeds hardware elaboration; synthesis may further remove unused logic, but the compiler must not instantiate unreachable runtime/datapath blocks.

## Reachability report

Every strict/minimal build should be able to emit a report conforming to `contracts/reachability-report.schema.json`.

The report records:
- compiler/backend/profile identity;
- artifact kind and target;
- semantic roots and reasons;
- retained nodes and at least one retention reason/path;
- removed node counts by category;
- dynamic/conservative regions;
- byte/resource measurements when the backend can measure them.

A report is an explanation artifact, not proof by itself. CI must bind it to the exact compiler/source revision and executed build.

## Correctness gates

A tree-shaking implementation is not conforming until tests demonstrate:
1. reachable behavior is unchanged;
2. unreachable guest functions disappear;
3. unreachable runtime capabilities do not appear;
4. dynamic roots remain live;
5. strict-minimal mode rejects unresolved dynamic reachability instead of producing an unsound artifact;
6. size/resource evidence is collected from the produced artifact, not estimated;
7. an unshaken/reference build and shaken build agree on required observable outputs.

## Rollout

Phase 1: direct-call function reachability plus machine-readable reports.
Phase 2: runtime feature/capability pruning and library/module reachability.
Phase 3: actor/async/serialization/hot-load dynamic roots.
Phase 4: cross-backend conformance and size/resource regression budgets.
Phase 5: target-specific mobile, embedded, realtime and HDL/ASIC resource gates.
