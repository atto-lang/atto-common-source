# Unsafe language boundary v1

Status: proposal only. No compiler, runtime, or native executable support is claimed.

Oreslang should provide explicit `unsafe` scopes and `unsafe fnc` declarations for operations whose safety invariants the compiler cannot prove. Unsafe syntax is not OS permission, memory authority, ownership transfer, or permission to bypass actor state sealing.

This design extends `docs/POINTER_CAPABILITY_CONTRACT.md` and its proposed `unsafe.memory` effect. `Pointer<T>` remains a separate owning pointer, and raw pointers remain non-owning, provenance-checked capabilities. The conflicting public-pointer wording in `docs/OWNERSHIP_SYNTAX.md` must be reconciled before enabling pointers.

The initial implementation should reserve unsupported syntax and reject it before code generation. Parser, effects, native grants, execution, and backend parity are later gates.
