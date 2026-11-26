# Native/Wasm refinement supplement to the checked-shifts contract

The merged [operator specification](https://github.com/atto-lang/atto-spec/blob/main/language/bitwise-and-stream-operators-v1.md) requires full-width signed shift count in 0..63, wrapping bit-pattern left shift, logical zero-fill right shift and arithmetic sign-fill right shift. The unsigned guard n < 64 is equivalent to the signed range; masking before checking is not. The existing checked-shifts contract remains canonical. This supplementary model proves safe count substitution and widened shift equivalence for all bit patterns.

Run from this directory with a trusted Z3 4.13.3 executable, Clang with native and wasm32 targets plus wasm-ld, and Node:
`python3 verify-native-wasm.py --solver /path/to/z3 --clang clang --node node`.
Omit both compiler arguments for model-only replay. SHA-256 pins the exact model and the solver transcript is checked. Local actual libz3 4.13.3.0 via CLI adapter: seven UNSAT obligations, three SAT mutation controls, four SAT reachability controls, five invalid replays rejected. Exact model and runner Git blobs c2ecd967fd58053f06df9747f3cf46337aa2cf09 and 2594c9978087cba9d50cc7a430ec0fb1217271c3.

Clang 17 Linux native and wasm32, Node 22.16.0: 100,825 operand/count pairs per operation and per target/optimization (50,704 admitted, 50,121 denied with output unchanged); total 1,209,900 representative native/Wasm checks at O0/O2. Python unbounded arithmetic is the shared independent oracle; decimal strings preserve full width in the Wasm host. The test invokes handwritten LLVM IR, not Atto compilation. The status/output ABI is a test convention, not Atto Error ABI. The trusted compiler, solver and host are assumed; no general proof of LLVM, Wasm or Atto implementation.
