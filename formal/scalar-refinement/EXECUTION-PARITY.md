# Core signed-i64 execution evidence gate v1

The **shared versioned mathematical contract** is
`contracts/library/v1/core-math-i64.json` (Git blob
`58d2b64a137ede4700593f855e1f0504ff744f90`).
The existing Java/Graal and LLVM draft proof pipelines now produce
**different** observable shapes:

- Java/Graal [#1885](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1885)
  writes `target/formal-typed-scalar/guest/observed-results.json` after
  checking actual guest stdout. This has all 24 full signed-i64 observations
  and both the exact shared contract blob and the checked guest Oreslang
  source blob (`2d12b8632ad77c8dee34235ecfacfca6a0fa553f`).
- LLVM [#857](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/857)
  writes `build/core-math-execution/aot-core-math-execution.json`
  after compiling and executing each case at both Clang `-O0` and `-O2`.
  Every guest performs full signed-i64 comparison **inside Oreslang**, so
  the host observes success/failure exit values, **not the 64-bit numeric
  result**. There are 48 successful compiled guest case executions and 2
  expected-failure negative controls.

`scripts/verify_core_math_execution.py` is a **strict offline record
consistency gate** over those artifacts and independently retrieved GitHub
workflow-run and jobs JSON. It rejects contract drift, duplicate case ids,
non-canonical/out-of-range decimals, wrong Java source identity, incorrect Java numeric results, missing
or nonzero LLVM optimization statuses, missing LLVM negative controls,
stale/failed workflow heads, zero runner IDs, missing job steps and missing
successful required steps. Both jobs must be from their distinct expected
backend repositories. A `runner_id=0` and `steps=[]` result always fails.

Example invocation (after independently fetching authenticated GitHub REST
run/job responses and downloading artifacts from their exact-head runs):

```sh
python3 scripts/verify_core_math_execution.py \
  --contract contracts/library/v1/core-math-i64.json \
  --java-results evidence/java/observed-results.json \
  --llvm-results evidence/llvm/aot-core-math-execution.json \
  --java-run evidence/java/run.json \
  --java-jobs evidence/java/jobs.json \
  --llvm-run evidence/llvm/run.json \
  --llvm-jobs evidence/llvm/jobs.json
```

**This script does not fetch GitHub or authenticate arbitrary JSON provided
as input.** The caller must independently verify raw GitHub API provenance,
repository identity, source trees, exact PR head SHA, job attempt, artifact
origin, and integrity before accepting a result. A self-consistent forged
record could pass this offline structural validator. Its result is explicitly
`record-consistent-not-cryptographically-attested`, **never a formal
certificate**. Do not fabricate records from fixtures or model outputs.

The native and Java source files differ because their supported syntax
subsets differ. Passing these gates demonstrates the observed 24-function
behavior at each tested backend target/profile, **not** identical-source
compiler equivalence, ownership safety, zero-GC, or arbitrary native/JVM
AOT correctness. Solver/AST proof and actual guest execution remain
separate requirements.

The unit tests in `tests/test_core_math_execution_evidence.py` build
**synthetic records** specifically to test rejection paths. A passing unit
test is not backend proof evidence. Execute with:

```sh
python3 -m unittest discover -s tests -p test_core_math_execution_evidence.py -v
```

The next promotion gate is a working approved private runner, with real
Java/LLVM compilation, Z3, actual guest execution, independently retrieved
GitHub run/jobs metadata, artifact integrity validation and human review.
