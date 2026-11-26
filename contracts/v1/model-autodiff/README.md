# Model/autodiff/actor pipeline v1 candidate conformance

Status: **proposal only**, no compiled guest execution yet.

Authoritative language/runtime contract: [MODEL_ACTOR_AUTODIFF_V1.md](../../../docs/MODEL_ACTOR_AUTODIFF_V1.md).

- `cases.json` contains prospective positive and negative source cases with a canonical diagnostic class and explicit `guest_execution: NOT_EXECUTED`.
- `fixtures/*.ores` are proposed new language syntax and intentionally must **not** be counted as executable guest tests on compilers without `define model`.
- Host-only integrity checks verify identifiers, fixture existence, expected diagnostic categories and that no case claims guest validation. Those checks are not lexer/parser/optimizer tests.
- Full implementation belongs in Java/Graal and LLVM compiler frontends plus pure Oreslang Tensor/Autograd/ML packages. The contract does not replace `oreslang-ml-conformance` numerical oracles.

Existing value pipe `|>` and actor pipe `pipe` semantics are unchanged.
