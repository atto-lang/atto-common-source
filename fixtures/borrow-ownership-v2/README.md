# Borrow and ownership conformance v2

**Status:** byte-pinned shared source contract; backend test **obligations**, not confirmed compiler execution.

This is a deliberately narrow continuation of [native guest v1](../native-guest-v1/README.md). It does not change the v1 manifest or source blobs.

## Actual v2 cases

| Source | Required LLVM compiler behavior | Java/Graal status |
| --- | --- | --- |
| borrow-mut-scalar.ores | Compile genuine checked exclusive class borrow, execute native main() returning 42 | Pending exact source run |
| borrow-overlap-reject.ores | Reject simultaneous mutable/shared borrow of the same owner, nonzero status, **zero IR** | Pending |
| borrow-shared-write-reject.ores | Reject mutation through shared borrow, nonzero status, **zero IR** | Pending |

The source corpus is verified by `python3 scripts/verify_borrow_v2_contract.py` and `python3 -m unittest discover -s tests -p 'test_borrow_v2_contract.py' -v`.

The LLVM compiler counterpart is [draft PR #670](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/670), which now registers an executable `native_shared_borrow_v2_real_compiler` CTest that uses the same SHA-256-pinned sources and rejects borrowed aliasing without emitting LLVM IR. The gate is also critical in the CTest inventory audit. No CI result is claimed until the **exact PR HEAD** runs on a real runner.

## This is NOT the requested complete owned-array + Result fixture

The v2 scalar borrow case demonstrates only a restricted *ordinary scalar-field class*, not an exclusive borrow of a class that owns a heap or array. The [LLVM ownership tracker #45](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/45) still governs class-owned Array fields, region pinning, CFG lifetime proof, and suspension.

The next **v3 executable** milestone must prove the following as a *single* identical source program, using the **existing Java canonical import grammar** and one shared nominal Result/exception contract:

1. `import fnc make from "./library.ores";` resolves and links a second module using canonical, project-contained file identities. Imports must never execute guest functions, constructors, or actor hooks.
2. A constructed class contains an owned `Array<int>`. Its exclusive borrow must maintain owner/field provenance. Rejected overlapping borrows produce no IR.
3. A checked mutation yields a typed nominal `Result<Value, Error>`. A success return and a recoverable allocation/bounds failure must be distinguishable **in guest code**, not merely by a host C++ Result structure or a low-level i32 status.
4. Normal, exceptional, failed construction and early-return exits drop initialized fields in reverse order **exactly once**, with the owner remaining live until all loans physically retire. Tests observe the cleanup trace as well as the result.
5. Run the same source through LLVM native AOT and the real Java guest compiler. Graal compiled application guest AOT is a distinct pending target; Native Image of a guest interpreter is not equivalent.

Until these five are implemented, **v3 is pending**; neither syntactic acceptance, a host runtime test, nor LLVM's current restricted array operations may be counted as full parity.

CI policy: no "green" claims on a queued/zero-step job; no private source export to another organization without reviewed authorization. Existing v1 exact-source runner records remain unauthenticated without independent workflow/binary provenance checks.
