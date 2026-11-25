# Oreslang real-time execution contract

Status: normative target and fail-closed admission contract. This document does not claim that either backend is already hard real-time certified.

## Profiles

Oreslang defines execution profiles independently from trust and actor isolation:

- `native-hard-rt`: full guest AOT, no tracing GC in the shipped execution path, bounded runtime services, and hard-real-time admission.
- `java-hard-rt`: full guest AOT where the selected real-time Java implementation supports it, no managed-heap access from the certified path, scoped/off-heap actor state, and hard-real-time admission.
- `graal-aot`: Native Image deployment with explicit allocation/GC evidence; hard real-time is not implied.
- `java-standard`: ordinary JVM/Graal execution without hard-real-time guarantees.

AOT, zero-GC, hard real-time, trust, and process isolation are independent properties.

## Hard-real-time admission

A hard-real-time unit is a function, task, actor handler, or scheduler group whose entire transitive call graph is admitted under a declared target profile.

The compiler must reject a hard-real-time unit if any reachable operation has an unbounded or unknown effect that can influence its deadline.

Required transitive effects:

- `allocates_managed`
- `tracing_collector_can_pause`
- `allocates_region`
- `may_block`
- `may_suspend`
- `may_spawn`
- `may_lock`
- `may_throw`
- `may_page_fault`
- `uses_dynamic_dispatch`
- `has_unbounded_loop`
- `has_unbounded_cleanup`
- `uses_unknown_ffi`
- `uses_untrusted_code`
- `requires_jit`

Unknown effects fail closed in hard-real-time profiles. A tracing collector may exist outside the certified domain only when the selected runtime establishes that it cannot suspend or otherwise interfere with the certified execution path.

## Memory rules

### native-hard-rt

The certified path must not require a tracing collector, collector safepoint, hidden managed heap, or interpreter/JIT fallback.

Runtime memory used after admission must come from one of:

1. stack/static storage with statically bounded size;
2. a preallocated actor/task region with bounded allocation cost;
3. a preallocated fixed-capacity pool with bounded allocation/free cost;
4. an explicitly admitted shared immutable region.

General-purpose malloc/new, reference-counting with unbounded destruction cascades, `std::shared_ptr`, blocking mutexes, and page-faulting growth are not automatically hard-RT admissible merely because they are deterministic in the usual language sense.

Actor-region teardown must have a declared bound. O(1) pointer reset is sufficient only when destructor/resource cleanup has already completed or is separately bounded.

### java-hard-rt

The certified path must not allocate or dereference ordinary managed-heap objects if the selected real-time JVM can pause that heap independently of the real-time execution contract.

Actor state must use a runtime mechanism whose timing and lifetime semantics are established for the selected VM: RTSJ scoped/no-heap memory, explicitly managed off-heap layouts, or another qualified mechanism.

Java wrapper objects, Truffle nodes, futures, exceptions, collections, reflection, logging, and runtime metadata are outside the certified path unless allocation and pause behavior are proven bounded for that deployment.

## Scheduling rules

A hard-RT scheduler domain is separate from the general work-stealing/JIT domain.

Every admitted workload declares:

- period or minimum inter-arrival time where applicable;
- relative deadline;
- WCET evidence identifier;
- maximum blocking time;
- maximum release jitter;
- memory budget;
- queue/mailbox capacity;
- cleanup/cancellation bound;
- target CPU/runtime profile.

Admission must prove schedulability for the configured policy. Initial policies are fixed-priority scheduling and EDF.

A watchdog is diagnostic evidence, not a deadline guarantee. Detecting a 4 ms overrun cannot satisfy a 1 ms deadline.

## Cooperation and preemption

Oreslang supports both cooperative and preemptive mechanisms.

Trusted cooperative code may be admitted only when the compiler proves a finite maximum work interval between scheduler cooperation points. Untrusted or unproven code cannot enter the certified domain.

OS/runtime preemption is still required where the declared deadline cannot tolerate the maximum cooperative interval.

## AOT contract

`full-aot` means all reachable guest code for the selected artifact is compiled before deployment. The artifact must not require a guest interpreter, guest JIT, or runtime code generation to execute admitted paths.

Compiling the Java/Truffle host implementation with Native Image while interpreting Oreslang guest code does not satisfy this contract.

Precompiled hot-reload modules may be staged outside the RT domain and activated only at a bounded safe point with a validated ABI/state-migration contract.

## Source-level direction

Illustrative syntax; exact grammar is not frozen:

```ores
@realtime(
  mode: #hard,
  deadline: 1.ms,
  period: 10.ms,
  wcet: 500.us,
  max_memory: 64.KiB
)
pub fnc control_step(rt borrow mut Controller c, rt borrow const SensorFrame f): void
  c.update(f);
end
```

The annotation is an assertion to verify, not proof by itself.

## Required diagnostics

The shared semantic layer should reserve stable diagnostic categories:

- `RT001_UNBOUNDED_ALLOCATION`
- `RT002_UNBOUNDED_BLOCKING`
- `RT003_WCET_UNPROVEN`
- `RT004_MANAGED_HEAP_ESCAPE`
- `RT005_DYNAMIC_CODE`
- `RT006_UNBOUNDED_CLEANUP`
- `RT007_UNKNOWN_FFI`
- `RT008_UNBOUNDED_LOOP`
- `RT009_SCHEDULING_UNPROVEN`
- `RT010_PAGE_FAULT_RISK`
- `RT011_COLLECTOR_INTERFERENCE`

Backends may provide more detail, but must normalize to these categories for cross-backend conformance.

## Evidence

A hard-RT claim must identify exact source revision, compiler/runtime revision, target CPU, OS/RTOS or JVM, scheduler policy, affinity/interrupt configuration, memory-locking policy, WCET method, workload, and observed timing distribution.

Repeated successful timing tests are useful evidence but do not replace a bound.

The release gate is fail closed: if a required bound or platform property is unknown, produce a non-certified build or reject hard-RT admission.
