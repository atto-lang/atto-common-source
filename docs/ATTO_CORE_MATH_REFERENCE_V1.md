# AttoLang canonical core signed-i64 reference vectors

This corpus is an independently reviewed mathematical **reference oracle**, not LLVM/Java/.NET/Wasm/Cranelift guest execution. It targets canonical `numeric.atto` and `core.atto`: `min_int`, `max_int`, and `clamp_int`, with eager evaluation, signed-i64 extreme values and the specified rule that an inverted clamp window returns the lower bound. The oracle uses Python integer arithmetic for input/output derivation and rejects all values outside signed i64.

Only compiled guest execution of the *same source* can claim backend parity. The 300+ pinned reference cases are a future compiler input/expected-output corpus; they do not prove any backend returns these values. This source-free gate denies altered SHA-256 corpus bytes, duplicate or malformed JSON, booleans masquerading as integers, overflow, missing-case shrinkage, forged guest-execution claims and symlinked fixtures.

Run:

    python3 -I tests/check_atto_core_math_vectors.py
    python3 -I -m unittest discover -s tests -p 'test_atto_core_math_vectors.py' -v

The source-owning repository must execute real native guest tests under the appropriate runner before any `PARITY_PASS` claim. No private source tree is exported to an unapproved alternate organization.
