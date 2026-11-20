# Abstract flat FSM trace contract — review candidate v0

**Status: DRAFT / finite fixture-only reference semantics. Not a production
Symbol serialization format, backend implementation, or evidence that Java and
LLVM execute identical Oreslang guest code.**

This belongs in the shared source-contract repository so Java/Graal and LLVM
can consume exactly one versioned observable trace envelope. It complements:
[LLVM draft #730](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/730),
[Java draft #1522](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1522),
[Java draft #1638](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1638),
and [design patterns #7](https://github.com/ores-truffle-oreslang/oreslang-design-patterns/pull/7).

## Contract boundary

- Pure finite logical states 0=Idle, 1=Running, 2=Done;
  event integers 0=Start, 1=Tick, 2=Finish, 3=Reset. Other events reject.
  Effect IDs 1..4 describe *intended postcommit effects*, **not** actual I/O.
- A successful self-edge is **accepted** and increments `version` once.
  Guard misses, unhandled events, invalid state/ticks and exhausted version
  reject with unchanged state/version and no effects.
- Events are sequenced per entity. Five-entity examples do not imply ECS,
  actors, parallelism or any physical layout. AoS/SoA/AoSoA are **absent**
  from the semantic schema.
- A separate atomic batch/outbox contract will be needed for parallel ECS
  admission, bounded effect buffering and durable commits. Do not model a
  failed whole batch as individually committed transitions.
- Numeric tags are **fixture-local ordinals only**, never canonical
  `Symbol` identities or authorizations. Production cross-trust export
  requires trusted nominal IDs, versioned schemas and explicit capabilities.

## Executable oracle and evidence

`trace_v0.py` implements a no-I/O finite oracle and strict semantic replay
validator. `trace.v0.schema.json` provides JSON Schema Draft 2020-12 shape
constraints; shape validation alone cannot prove transition semantics.
`tests/test_fsm_trace_contract.py` enumerates **5,461** input event words
(length 0..6), plus malformed-effect, admission, replay/order and layout
leakage mutations. The verifier checks exact versions, effects, reasons,
sequence numbering, and per-entity state continuity.

```sh
python3 -m unittest discover -s tests -p test_fsm_trace_contract.py -v
```

The finite oracle **does not run either backend**. Guest consumers must
compile the *same* Oreslang fixture with current Java and LLVM toolchains,
record exact source blob, compiler executable, emitted artifact hash,
complete outcomes, and fail closed on missing binaries, skipped tests and
negative tests that emit partial executable output.

No new `fsm` keyword, actor dependency, runtime code or authorized Symbol
export format is implied by this proposal.
