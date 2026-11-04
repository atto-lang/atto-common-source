# Proposal: Native guest Error/effect lowering ABI v1

Status: PROPOSED. This is a compiler/runtime lowering contract, not a network or
serialization wire format and not proof that any backend has completed typed
unwinding.

## Goals

Oreslang guest errors must have the same observable identity and control-flow
semantics across Java/GraalVM, LLVM, WebAssembly, .NET Native AOT and Forge
without requiring host exceptions, process signals, WebAssembly traps, GC
allocation, or a platform unwinder on the native hot path.

The stable error identities live in `contracts/v1/numeric-error-abi.json`.
For the initial numeric slice, `ArithmeticOverflowError <: Error` is code
`0x00010001` (65537).

## Language semantics

Default checked fixed-width arithmetic overflow begins as:

`throw ArithmeticOverflowError`

Therefore:

1. the nearest matching ordinary `try/catch` may consume it;
2. if no catch consumes it, `throw` promotes to `raise`;
3. the nearest `recover` may consume a `raise`;
4. an unrecovered `raise` promotes to `panic`;
5. actor panic is never catchable by the actor and is delivered to the
   supervisor on the runtime CONTROL path;
6. a top-level non-actor unhandled panic terminates the guest invocation with a
   non-success host/process result, but that host exit code is not guest Error
   identity.

Explicit Result-returning checked helpers may consume the same Error identity
without throwing. A `trap` expression uses a private error continuation/slot
and converts a trappable guest error to its declared Result/Option form; it must
not expose a Java exception, POSIX signal, CLR exception type or Wasm trap as
the language value.

## NativeErrorSlotV1

Native/freestanding implementations MAY lower the semantics through one hidden
mutable slot passed through fallible guest calls. The slot is actor/task-local
or stack-owned; it is never a process-global "last error".

Logical fields:

- `code: u32` — 0 means no guest error; nonzero values come from a reviewed
  shared registry.
- `effect: u8` — 0 none, 1 throw, 2 raise, 3 panic.
- `flags: u8` — reserved capability bits; unknown set bits fail closed.
- `reserved: u16` — must be zero in v1.
- `payload: u64` — 0 when no payload is required; otherwise an
  implementation-defined actor/task-owned handle whose lifetime is validated
  by the backend.

A C-compatible representation may therefore occupy exactly 16 bytes:

```c
struct OresNativeErrorSlotV1 {
    uint32_t code;
    uint8_t effect;
    uint8_t flags;
    uint16_t reserved;
    uint64_t payload;
};
```

The exact in-memory layout is required only for backends that advertise
`ores.native.error-slot.v1` interoperability. Java/.NET implementations may
use ordinary runtime objects/exceptions internally if guest-observable behavior
and registered identity are identical.

## Required lowering rules

- A fallible native guest call receives a hidden pointer/reference to the
  current slot or an equivalent SSA error continuation.
- The caller must not consume the normal return value when `code != 0`.
  The normal return bits are unspecified on the exceptional edge.
- A caught error clears the consumed slot before normal execution resumes.
- Propagation preserves `code` and `payload`; only the effect transition
  `throw -> raise -> panic` may change as mandated by language semantics.
- Arithmetic overflow initially writes code `65537`, effect `throw`,
  flags/reserved/payload zero.
- Unknown nonzero error codes must propagate or fail closed; they must never be
  reclassified as a known Error.
- A panic edge must bypass ordinary catch handlers.
- No ErrorSlot operation may allocate solely to represent payload-free
  arithmetic overflow.
- Stack traces are not captured by default. Trace capture is a separate,
  explicit facility and must not change Error identity.
- Native signals (`SIGILL`, `SIGABRT`), CLR/Java host exception classes,
  process exit codes and Wasm traps are implementation/fail-closed mechanisms,
  not valid substitutes for the slot's guest identity.

## Optimization and real-time requirements

The slot or equivalent SSA continuation may be optimized away when the compiler
proves the call cannot fail or proves the handler locally. Such optimization
must preserve the same observable catch/raise/panic behavior.

For hard-real-time LLVM profiles, payload-free arithmetic overflow handling must
be bounded, allocation-free and lock-free. A backend must not claim hard-RT
typed-error parity if its selected lowering requires an unbounded allocator or
platform unwinder.

## Initial conformance

For each of `i64.add`, `i64.sub`, `i64.mul`, `i64.neg`,
`Math.abs` and `Math.neg`:

- normal values produce the exact numeric result;
- overflow is catchable as `ArithmeticOverflowError`;
- the same value is catchable as root `Error`;
- the stable code is 65537;
- `trap` observes guest error identity rather than a host exception;
- uncaught behavior follows throw -> raise -> panic;
- optimizer/AOT/JIT modes do not change identity;
- native/Wasm trap-only behavior is explicitly reported as incomplete until
  this contract is implemented.

No backend may claim this proposal is implemented merely because it contains
the constants or the JSON registry.
