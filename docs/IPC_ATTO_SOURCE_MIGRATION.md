# IPC receipt fixtures — canonical AttoLang migration

The canonical new-language files are `experiments/ipc_receipts.atto` and `tests/ipc_receipts_guest.atto`. They are intentionally source-equivalent to the legacy `.ores` fixtures introduced in common source #88, apart from the guest's import suffix.

The existing legacy `.ores` files and `scripts/run_ipc_guest_parity.sh` remain unchanged until real Java and LLVM compilers independently accept canonical `.atto` modules and execute the same 18 expected booleans. The source-only `sh tests/test_ipc_atto_migration.sh` catches drift, but **does not compile or execute any guest language program**.

Do not count compiler stubs, source/tree hashes, or source-free tests as AttoLang backend parity. Actual admission requires pinned exact-head Java/Graal and LLVM compiler invocation, source identities, negative compiler fixtures, byte-exact stdout, independently reviewed receipts and successful stepful runner execution. See the separate IPC harness hardening PR #221 for additional negative-runner checks.

No new `.ores` language fixtures should be authored as part of the rebrand. Existing legacy fixtures are retained only for migration compatibility.
