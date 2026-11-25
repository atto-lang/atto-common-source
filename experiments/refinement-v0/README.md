# Standalone refinement normalizer experiment

This small zero-dependency Node.js reference model exercises annotation, `with`, `where` (restricted pure comparison subset) and checked nominal newtype syntax. Run `node experiments/refinement-v0/refinement.test.mjs`.

**Not integrated with the Oreslang lexer, parser, AST, typechecker, runtime, actor serialization or LLVM.** The parser supports only string/int and rejects other types, arbitrary `where` functions and dynamic Oreslang programs. Java/Graal compiler admission must continue to reject refinements until proven correct at every boundary. The model returns JS objects for `tryFrom`, not Oreslang runtime values.

Reference implementation limits and fail-closed rejection are intentional; see [`docs/REFINEMENT_TYPES.md`](../../docs/REFINEMENT_TYPES.md).
