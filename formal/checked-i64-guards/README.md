# Checked signed-i64 guard contract

Status: MODEL_PROVED, not source-proved or backend-refined.

Run with Z3 4.13.3: `z3 -smt2 formal/checked-i64-guards/model.smt2`. Require P01-P10 UNSAT, M01-M05 SAT, R01-R03 SAT in order; reject unknown, errors, timeout, missing or extra output. The locally executed model Git blob is `a99cfa0e1c5599d52e899f15fc8d9a01d8bd38d6` (10 UNSAT, 8 SAT). Each query is independent. The sign tests are compared with widened exact signed addition/subtraction; the division/remainder guard is transcribed from atto-source.llvm#911 at head `7293b7fd613571a3506a849500d7c7fa6abe73b8` (not generated from compiler IR).

P07 and P09 cover both reachable and rejected paths, including the constant-folded invalid divisor cases. P08 and P10 ensure substitution is identity on admitted operands (for remainder, excluding -1). The model does not prove quotient truncation, signed modulo policy, multiplication, remainder result equivalence for -1, error identity/ABI, source typing, evaluation order, LLVM poison propagation or compiler correctness. It assumes the declared BV64 semantics and specified invalid operand pairs. SAT mutant obligations establish existence of a disagreement, not runtime execution.

## Backend acceptance

Java, LLVM, Forge, .NET, Wasm, Cranelift, Rust and JS should separately derive each guard from actual typed IR and compare it with this independent contract. HDL is applicable only to the corresponding implemented integer profile. For each backend record exact source and compiler revision, solver version, obligation ID, generated IR and solver transcript, negative mutations and actual compiled guest results (including min/-1, zero, signed extremes). Do not promote model results to backend pass. Unknown, unsupported, timed-out and unexecuted checks remain unverified. No cross-org source transfer is required for this standalone model.
