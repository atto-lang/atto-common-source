#!/usr/bin/env python3
"""Fail-closed core-math execution parity *record* verifier.

Reads separately fetched GitHub run/job JSON and captured backend result files.
Does not authenticate those JSON bytes, artifacts, or the producing identity:
obtain them independently from GitHub and verify the artifact provenance.
Synthetic fixtures used in unit tests are never runtime proof receipts.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

CONTRACT_GIT_BLOB = "58d2b64a137ede4700593f855e1f0504ff744f90"
JAVA_GUEST_GIT_BLOB = "2d12b8632ad77c8dee34235ecfacfca6a0fa553f"
LLVM_GUEST_GIT_BLOB = "f1bf58f3e28c2b5a76553f96e23839a9a520a0a4"
SHA = re.compile(r"[0-9a-f]{40}")
DECIMAL = re.compile(r"(?:0|-?[1-9][0-9]*)")
MIN, MAX = -(1 << 63), (1 << 63) - 1
FUNCTIONS = {"min_int": 2, "max_int": 2, "clamp_int": 3}
RUN_IDENTITY = {
    "graal": ("ores-truffle-oreslang/oreslang-source.java",
              ".github/workflows/typed-scalar-smt.yml",
              "Typed Oreslang AST to SMT core proof"),
    "llvm": ("ores-truffle-oreslang/oreslang-source.llvm",
             ".github/workflows/native-checked-scalar-smt.yml",
             "Native checked scalar SMT pilot"),
}
JOBS = {
    "graal": ("graal-guest-core-math",
              ("Require exact reviewed source and contract snapshots",
               "Run all 24 real Oreslang guest cases")),
    "llvm": ("native-aot-core-math",
             ("Pin exact AOT fixture, source and shared semantic contract",
              "Execute all 24 full signed-i64 guest cases and negative control")),
}

class EvidenceError(ValueError):
    pass

def require(ok, message):
    if not ok:
        raise EvidenceError(message)

def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate JSON member: " + str(key))
        result[key] = value
    return result

def read_json(path):
    data = Path(path).read_bytes()
    require(len(data) <= 2_000_000, "oversized evidence JSON")
    try:
        return json.loads(data.decode("utf8"), object_pairs_hook=unique_pairs,
                          parse_constant=lambda _: require(False, "nonfinite JSON number"))
    except (ValueError, UnicodeError, TypeError) as e:
        raise EvidenceError("invalid JSON: " + str(e)) from e

def i64_decimal(value):
    require(type(value) is str and DECIMAL.fullmatch(value) is not None,
            "noncanonical signed-i64 decimal")
    number = int(value)
    require(MIN <= number <= MAX, "signed-i64 outside domain")
    return number

def contract_oracle(function, args):
    if function == "min_int":
        return min(args)
    if function == "max_int":
        return max(args)
    value, lower, upper = args
    return lower if lower > upper else min(max(value, lower), upper)

def contract_cases(data, raw):
    require(type(data) is dict and set(data) ==
            {"schemaVersion","contract","integerDomain","statement","sourceOfTruth","cases"},
            "unexpected contract shape")
    require(data["schemaVersion"] == 1 and
            data["contract"] == "ores-core-math-signed-i64-v1" and
            data["integerDomain"] == "signed-i64",
            "wrong core semantic contract")
    require(type(data["cases"]) is list and len(data["cases"]) == 24,
            "24 exact cases required")
    actual_blob = hashlib.sha1(
        f"blob {len(raw)}\0".encode("ascii") + raw).hexdigest()
    require(actual_blob == CONTRACT_GIT_BLOB, "unreviewed contract Git blob")
    cases = {}
    for case in data["cases"]:
        require(type(case) is dict and
                set(case) == {"id","function","args","expected"}, "invalid case shape")
        ident, func, args = case["id"], case["function"], case["args"]
        require(type(ident) is str and re.fullmatch(r"[a-z][a-z0-9-]{1,80}",ident)
                and ident not in cases, "invalid or duplicate case id")
        require(type(func) is str and func in FUNCTIONS and type(args) is list
                and len(args) == FUNCTIONS[func], "invalid function or arity")
        actual = contract_oracle(func, [i64_decimal(x) for x in args])
        expected = i64_decimal(case["expected"])
        require(actual == expected, "independent oracle mismatch: " + ident)
        cases[ident] = case["expected"]
    for required in ("min-int64-lowest","max-int64-highest",
                     "clamp-inverted-returns-lower","clamp-all-extreme",
                     "min-large-precise"):
        require(required in cases,"missing mandatory boundary: " + required)
    return cases

def validate_java(result, cases):
    require(type(result) is dict and set(result) ==
            {"contractGitBlob","guestSourceGitBlob","executedCases","results","evidenceKind"},
            "unrecognized Graal result format")
    require(result["contractGitBlob"] == CONTRACT_GIT_BLOB and
            result["guestSourceGitBlob"] == JAVA_GUEST_GIT_BLOB and
            result["evidenceKind"] == "captured-guest-stdout-not-authenticated-run",
            "Graal contract or evidence type mismatch")
    require(type(result["executedCases"]) is int and
            result["executedCases"] == 24 and
            type(result["results"]) is list and len(result["results"]) == 24,
            "missing Graal guest observations")
    seen = {}
    for item in result["results"]:
        require(type(item) is dict and set(item) == {"id","observed"},
                "invalid Graal observation")
        ident = item["id"]
        require(type(ident) is str and ident in cases and ident not in seen,
                "Graal unknown or duplicate observation")
        require(i64_decimal(item["observed"]) == i64_decimal(cases[ident]),
                "Graal guest mismatch: " + ident)
        seen[ident] = item["observed"]
    require(set(seen) == set(cases),"Graal missing expected guest cases")

def validate_llvm(result, cases):
    require(type(result) is dict and set(result) ==
            {"contract_git_blob","native_fixture_git_blob","backend","kind",
             "cases","negative_control_exit_by_optimization","executed"},
            "unrecognized LLVM result format")
    require(result["contract_git_blob"] == CONTRACT_GIT_BLOB and
            result["native_fixture_git_blob"] == LLVM_GUEST_GIT_BLOB and
            result["backend"] == "llvm-native-host" and
            result["kind"] == "actual-compiled-guest", "LLVM provenance mismatch")
    require(type(result["executed"]) is int and result["executed"] == 48 and
            type(result["cases"]) is list and len(result["cases"]) == 24,
            "incomplete LLVM compiled executions")
    controls = result["negative_control_exit_by_optimization"]
    require(type(controls) is dict and set(controls) == {"O0","O2"} and
            all(type(v) is int and v == 1 for v in controls.values()),
            "missing LLVM negative controls")
    seen = set()
    for case in result["cases"]:
        require(type(case) is dict and
                set(case) == {"id","expected","guest_exit_by_optimization"},
                "invalid LLVM execution record")
        ident = case["id"]
        require(type(ident) is str and ident in cases and ident not in seen,
                "LLVM duplicate or unknown execution id")
        require(i64_decimal(case["expected"]) == i64_decimal(cases[ident]),
                "LLVM compiled guest expected wrong value")
        exits = case["guest_exit_by_optimization"]
        require(type(exits) is dict and set(exits) == {"O0","O2"}
                and all(type(v) is int and v == 0 for v in exits.values()),
                "LLVM guest mismatch or skipped optimization")
        seen.add(ident)
    require(seen == set(cases), "LLVM missing required guest executions")

def validate_run(backend, run, jobs):
    require(type(run) is dict and type(jobs) is dict
            and type(jobs.get("jobs")) is list,"missing GitHub run/job JSON")
    require(type(run.get("id")) is int and run["id"] > 0 and
            type(run.get("run_attempt")) is int and run["run_attempt"] > 0
            and type(run.get("head_sha")) is str
            and SHA.fullmatch(run["head_sha"]) is not None,
            "invalid run identity")
    require(run.get("status") == "completed" and run.get("conclusion") == "success",
            "GitHub workflow not successful")
    repository, workflow_path, workflow_name = RUN_IDENTITY[backend]
    require(type(run.get("repository")) is dict and
            run["repository"].get("full_name") == repository and
            type(run.get("head_repository")) is dict and
            run["head_repository"].get("full_name") == repository and
            run.get("name") == workflow_name and run.get("path") == workflow_path and
            run.get("event") in ("pull_request", "workflow_dispatch"),
            "wrong GitHub repository, workflow or event")
    target_name, required_steps = JOBS[backend]
    matching = [j for j in jobs["jobs"] if type(j) is dict and j.get("name") == target_name]
    require(len(matching) == 1, "missing/duplicate actual job: " + target_name)
    job = matching[0]
    require(type(job.get("id")) is int and job["id"] > 0 and
            type(job.get("run_id")) is int and job["run_id"] == run["id"] and
            job.get("head_sha") == run["head_sha"] and
            type(job.get("runner_id")) is int and job["runner_id"] > 0,
            "unassigned/stale/mismatched job")
    require(job.get("status") == "completed" and job.get("conclusion") == "success",
            "job did not succeed")
    require(type(job.get("run_attempt")) is int and
            job["run_attempt"] == run["run_attempt"],
            "missing or stale job attempt")
    steps = job.get("steps")
    require(type(steps) is list and steps,"zero executed job steps")
    names = set()
    for step in steps:
        require(type(step) is dict and type(step.get("name")) is str,
                "invalid job step")
        require(step["name"] not in names, "duplicate step label")
        names.add(step["name"])
    for name in required_steps:
        selected = [s for s in steps if s["name"] == name]
        require(len(selected) == 1 and selected[0].get("status") == "completed"
                and selected[0].get("conclusion") == "success",
                "unexecuted/failed required step: " + name)
    return {"run_id": run["id"],"job_id":job["id"],
            "runner_id":job["runner_id"],"head_sha":run["head_sha"]}

def compare(contract_raw, java, llvm, java_run, java_jobs, llvm_run, llvm_jobs,
            expected_java_head, expected_llvm_head):
    for identity, head in (("java", expected_java_head), ("llvm", expected_llvm_head)):
        require(type(head) is str and SHA.fullmatch(head) is not None,
                "missing exact expected " + identity + " source head")
    require(expected_java_head != expected_llvm_head,
            "same source head supplied for distinct compiler repositories")
    try:
        parsed = json.loads(contract_raw.decode("utf8"), object_pairs_hook=unique_pairs)
    except (ValueError, UnicodeError) as e:
        raise EvidenceError("invalid contract JSON") from e
    cases = contract_cases(parsed, contract_raw)
    validate_java(java,cases)
    validate_llvm(llvm,cases)
    j = validate_run("graal",java_run,java_jobs)
    l = validate_run("llvm",llvm_run,llvm_jobs)
    require(j["head_sha"] == expected_java_head and
            l["head_sha"] == expected_llvm_head,
            "run does not match independently checked exact compiler source heads")
    return {"contract_git_blob":CONTRACT_GIT_BLOB, "cases":len(cases),
            "graal":j,"llvm":l,"status":"record-consistent-not-cryptographically-attested"}

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("contract","java-results","llvm-results","java-run","java-jobs",
                 "llvm-run","llvm-jobs"):
        parser.add_argument("--"+name,required=True,type=Path)
    parser.add_argument("--expected-java-head", required=True)
    parser.add_argument("--expected-llvm-head", required=True)
    opts=parser.parse_args(argv)
    try:
        result=compare(opts.contract.read_bytes(),read_json(opts.java_results),
                       read_json(opts.llvm_results),read_json(opts.java_run),
                       read_json(opts.java_jobs),read_json(opts.llvm_run),
                       read_json(opts.llvm_jobs),
                       opts.expected_java_head, opts.expected_llvm_head)
    except (EvidenceError,OSError,UnicodeError,ValueError) as e:
        print("CORE_MATH_PARITY_UNVERIFIED: "+str(e),file=sys.stderr)
        return 1
    print(json.dumps(result,sort_keys=True))
    print("NOTE: validate run/artifact authenticity independently against GitHub before certification")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
