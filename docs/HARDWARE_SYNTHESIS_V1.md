# Synthesizable Oreslang FPGA/ASIC target — proposed v1 contract

**Status: design proposal only.** This repository contains no shared compiler implementation. No Oreslang-to-RTL compiler, FPGA bitstream, ASIC netlist, or silicon execution is demonstrated by this document.

## Goal and non-goal

A **bounded, statically elaborated Oreslang subset** compiles to synthesizable SystemVerilog / Verilog, then the *same RTL* can enter FPGA and ASIC toolchains. The normal Oreslang actor runtime, BEAM-like dynamic process model, arbitrary GC/heap, hot reload and unrestricted async are not synthesized. Hardware units may be called by CPU/GPU/embedded Oreslang code through explicit bounded hardware ports.

Important distinction: HDL output is **not** an ASIC. A netlist, placed/routed GDSII, signoff and fabrication are separate gates.

## Target topology and repository ownership

- `oreslang-common-source`: normative semantics, fixed-width types, effects/ownership restrictions, HIR/MIR contracts, conformance fixtures. Do not lower generic LLVM IR into hardware as a semantic shortcut.
- `oreslang-target-profiles`: add declared `fpga` and `asic` profiles, immutable toolchain/capability constraints and manifests, after schema review. `embedded` is a CPU/microcontroller profile, not synonymous with FPGA.
- `oreslang-source.llvm`: first practical **frontend reuse** (typed AST / verified subset) and an adapter emitting typed hardware IR; no claim native LLVM IR is automatically synthesizable.
- Proposed future `oreslang-source.hdl` or `oreslang-hardware` repository: CIRCT/MLIR-to-SystemVerilog emission, target-specific timing/clock memory mapping, hardware examples, simulator and synthesis wrappers. Creating the repo requires a separate authorized action.
- `oreslang-platform-conformance`: real compiler, Verilator/Icarus simulation, Yosys synthesis, nextpnr FPGA P&R, and OpenROAD ASIC flow evidence per exact revision.

### Conceptual pipeline

```
Oreslang source + explicit hardware target entry
    -> existing frontend + type/effect/ownership checks
    -> hardware eligibility verifier (reject all unknown features)
    -> typed fixed-width HW/HLS IR (static dataflow, FSM/datapath)
    -> CIRCT hw/comb/seq/fsm/handshake as suitable
    -> SystemVerilog / synthesizable Verilog RTL
    -> simulation, lint, differential model checks, formal verification
    +--> Yosys -> FPGA technology mapping -> nextpnr -> bitstream for an explicitly supported board
    +--> Yosys -> mapped standard cells -> OpenROAD flow -> routed GDSII + timing/DRC/LVS reports
```

CIRCT provides hardware-specific IR and Verilog emission; using CIRCT does not by itself synthesize Oreslang control flow or prove timing. A temporary direct RTL emitter is allowed for an *isolated combinational smoke* as long as it is labeled experimental, tests exact truth-table / numeric behavior, and is not promoted into a general language compiler.

## Admission v0 (deliberately small)

Allowed, after verified implementation:
- `bool`, `u1..u64` / `i1..i64` or equivalent exact bit-vector types; bitwise ops and selected arithmetic with **declared** overflow, carry, sign, shift and truncation rules. General `int` (currently i64 in native backend) is not implicitly hardware portable.
- Compile-time constants, fixed-size arrays, bounded tuples/records and field access; statically known memory depth, port count and read-during-write policy.
- Pure functions, finite for-loops statically unrolled or scheduled, if/match over closed enums, static call graph. Fixed recursion only if compiler explicitly unrolls it with a verified bound; v0 rejects recursion.
- Externally visible fixed-width combinational inputs/outputs with bitwise-equivalent software reference implementation.

Rejected by v0:
- `any`, dynamic collections/strings/closures, floating point/complex numbers unless an explicitly specified IP core and rounding model exists, dynamic allocation/GC, unbounded loops/recursion, reflection, exceptions, OS I/O/FFI, dynamic actor spawning, implicit async/await/select, runtime hot reload, pointers to general addresses, mutable shared regions, network capabilities.
- No silent fallback to CPU execution, host functions, or JIT when target says hardware. Unsupported types/effects are *compile errors with locations*.

Sequential v1 (after combinational proof):
- Stateful registers, explicit clock + reset (reset polarity/type, start-up state), finite-state machines, fixed-depth SRAM/FIFO, ready/valid streaming handshake with stable data under backpressure.
- Bounded static actors can *be elaborated as communicating circuits* only when topology, buffer capacities, schedule and clock domain assumptions are fixed. An OTP actor/supervisor restart is **not** mapped 1:1 to a physical logic gate; resets/watchdogs are independent hardware policies.
- Explicit resource budget (LUT/BRAM/DSP on FPGA; cells/area on ASIC), latency/throughput/clock constraints and clock-domain-crossing verification.
- Software-to-hardware bridge is explicit: MMIO/DMA/PCIe or board protocol, size/endian/alignment/lifetime/cancel and DMA ownership fences, authenticated capability admission where applicable.

## Proposed CLI (contract, not implemented)

```sh
oreslang check --target=fpga --entry=add8 examples/add8.ores
oreslang build --target=fpga --entry=add8 --emit=systemverilog
oreslang build --target=asic --entry=add8 --emit=systemverilog
```

Real CLI parsing should use the existing flags-2-env integration policy, not a separate ad hoc parser.

### Example: candidate combinational benchmark (DESIGN ONLY)

```ores
// Contract needs an exact unsigned bit-width type before this is valid.
pub fnc add8(u8 a, u8 b): u8 {
    return a + b;
}
```

Semantics are `(a + b) mod 256`; the produced module has an 8-bit a, 8-bit b, and 8-bit output. No clock. Test **all 65,536** input pairs and compare guest source interpreter/compiled software reference to Verilog simulation. Do not claim the Oreslang compiler already parses this fixed-width spelling.

Sequential follow-up: 8-bit counter with synchronous reset/enable, then 2-entry ready/valid FIFO and a finite hardware state machine.

## Acceptance milestones and evidence

H0 — Finalize target profile schema + hardware-subset syntax/typing/effect rules; deterministic negative fixtures. No RTL claims.
H1 — **Real** Oreslang source `add8` -> emitted valid Verilog -> exhaustive 65,536-vector simulation -> Yosys synth. Record source/tool hashes, raw logs, generated RTL digest.
H2 — Stateful counter/FIFO -> Verilator simulation, overflow/reset/backpressure and bounded formal invariants; no inferred latches or X-dependent behavior.
H3 — One named board/family with pin constraints -> nextpnr placement/routing, timing report and bitstream, followed by **actual board execution** and output comparison. A bitstream alone is not measured board execution.
H4 — Same RTL and clock/reset assumptions -> ASIC technology-mapped cell netlist + OpenROAD placement/route using a named legal PDK; publish area, worst path/timing slack, DRC/LVS and signoff status. GDSII generation does not imply fabricated silicon.
H5 — Oreslang actor/native driver -> dedicated interface to hardware block, ownership/capability/transport tests; runtime software supervisor remains off-chip or in a separately designed soft-core.

## Required negative and adversarial fixtures

Wrong-width arithmetic, signed/unsigned accidental coercions, divide-by-zero policy, shifts >= width, unsupported dynamic `Array` and `Map`, unbounded recursion, actor spawn, await, exception unwinding, non-static loop, nonsynthesizable foreign calls, unexpected latch, clock crossing without synchronizer, reset mismatch, handshake deadlock, IO pin constraint mismatch, WNS/area budget rejection, toolchain missing vs actual test failures.

## References and existing groundwork

- `oreslang-source.llvm` freestanding Cortex-M proof is **CPU machine-code execution**, not HLS or FPGA synthesis.
- `oreslang-source.llvm/docs/TYPED_ACCELERATOR_LOWERING_V0.md` and CPU/GPU regions offer adjacent accelerator IR ideas but must not be relabeled as FPGA-ready.
- CIRCT hardware/comb/sv dialects: https://circt.llvm.org/docs/Dialects/
- Yosys synthesis: https://yosyshq.net/yosys/
- nextpnr routing: https://github.com/YosysHQ/nextpnr
- OpenROAD physical implementation: https://github.com/The-OpenROAD-Project/OpenROAD-flow-scripts

Source confidentiality: no private compiler trees in unapproved cross-org/public CI mirrors. Artifact provenance and runtime behavior must be independently verified.
