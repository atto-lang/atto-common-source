"""Adversarial *synthetic* checks of offline core-math result consistency.

No test here establishes a real GitHub run or actual backend execution.
"""
import copy
import hashlib
import importlib.util
import json
import sys
import unittest
from pathlib import Path

FILE = Path(__file__).resolve().parents[1] / "scripts/verify_core_math_execution.py"
spec = importlib.util.spec_from_file_location("core_math_parity", FILE)
checker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = checker
spec.loader.exec_module(checker)

class OfflineParityEvidenceTests(unittest.TestCase):
    def setUp(self):
        cases = []
        mandatory = ["min-int64-lowest", "max-int64-highest",
                     "clamp-inverted-returns-lower", "clamp-all-extreme",
                     "min-large-precise"]
        for i in range(24):
            name = mandatory[i] if i < len(mandatory) else f"case-{i:02d}"
            fn = ("min_int", "max_int", "clamp_int")[i % 3]
            args = [str(i-12), str(i+3)]
            if fn == "clamp_int":
                args = [str(i-12),str(i-2),str(i-5)]
            value = checker.contract_oracle(fn,[int(x) for x in args])
            cases.append({"id":name,"function":fn,"args":args,"expected":str(value)})
        self.contract = json.dumps({
            "schemaVersion":1,"contract":"ores-core-math-signed-i64-v1",
            "integerDomain":"signed-i64",
            "statement":"clamp_int returns lower when lower > upper",
            "sourceOfTruth":"independent mathematical reference; not compiler output",
            "cases":cases},separators=(",",":")).encode()
        checker.CONTRACT_GIT_BLOB = hashlib.sha1(
            f"blob {len(self.contract)}\0".encode() + self.contract).hexdigest()
        self.java={"contractGitBlob":checker.CONTRACT_GIT_BLOB,
                   "executedCases":24,
                   "results":[{"id":c["id"],"observed":c["expected"]} for c in cases],
                   "evidenceKind":"captured-guest-stdout-not-authenticated-run"}
        self.llvm={"contract_git_blob":checker.CONTRACT_GIT_BLOB,
                   "native_fixture_git_blob":checker.LLVM_GUEST_GIT_BLOB,
                   "backend":"llvm-native-host","kind":"actual-compiled-guest",
                   "executed":48,
                   "negative_control_exit_by_optimization":{"O0":1,"O2":1},
                   "cases":[{"id":c["id"],"expected":c["expected"],
                             "guest_exit_by_optimization":{"O0":0,"O2":0}}
                            for c in cases]}
        self.java_run={"id":100,"run_attempt":1,"head_sha":"a"*40,
                       "status":"completed","conclusion":"success"}
        self.llvm_run={"id":200,"run_attempt":1,"head_sha":"b"*40,
                       "status":"completed","conclusion":"success"}
        for backend, run in (("graal", self.java_run), ("llvm", self.llvm_run)):
            repository, workflow_path, workflow_name = checker.RUN_IDENTITY[backend]
            run.update({"repository":{"full_name":repository},
                        "head_repository":{"full_name":repository},
                        "path":workflow_path,"name":workflow_name,
                        "event":"pull_request"})
        self.java_jobs={"jobs":[self.make_job("graal",self.java_run,101)]}
        self.llvm_jobs={"jobs":[self.make_job("llvm",self.llvm_run,201)]}

    def make_job(self,backend,run,job_id):
        name,required=checker.JOBS[backend]
        return {"id":job_id,"run_id":run["id"],"head_sha":run["head_sha"],
                "run_attempt":1,"runner_id":50 if backend=="graal" else 60,
                "name":name,"status":"completed","conclusion":"success",
                "steps":[{"name":s,"status":"completed","conclusion":"success"}
                         for s in required]}

    def check(self):
        return checker.compare(self.contract,self.java,self.llvm,
                               self.java_run,self.java_jobs,self.llvm_run,self.llvm_jobs)

    def test_synthetic_records_are_consistent_but_never_attested(self):
        self.assertEqual(self.check()["status"],
                         "record-consistent-not-cryptographically-attested")

    def test_missing_step_or_zero_runner_is_not_passable(self):
        for alteration in ("runner_id", "steps", "conclusion"):
            with self.subTest(alteration=alteration):
                old=copy.deepcopy(self.llvm_jobs)
                job=self.llvm_jobs["jobs"][0]
                if alteration=="runner_id": job["runner_id"]=0
                elif alteration=="steps":job["steps"]=[]
                else:job["conclusion"]="skipped"
                with self.assertRaises(checker.EvidenceError):self.check()
                self.llvm_jobs=old

    def test_wrong_head_and_wrong_run_status_reject(self):
        self.java_jobs["jobs"][0]["head_sha"]="0"*40
        with self.assertRaises(checker.EvidenceError):self.check()
        self.java_jobs["jobs"][0]["head_sha"]=self.java_run["head_sha"]
        self.java_run["conclusion"]="failure"
        with self.assertRaises(checker.EvidenceError):self.check()

    def test_any_missing_wrong_or_double_observation_rejects(self):
        for mutation in ("missing-java","wrong-java","extra-llvm",
                         "missing-opt","nonzero-opt","missing-mutant","bad-mutant"):
            java,llvm=copy.deepcopy(self.java),copy.deepcopy(self.llvm)
            if mutation=="missing-java":java["results"].pop()
            if mutation=="wrong-java":java["results"][0]["observed"]="1234"
            if mutation=="extra-llvm":llvm["cases"].append(copy.deepcopy(llvm["cases"][0]))
            if mutation=="missing-opt":del llvm["cases"][0]["guest_exit_by_optimization"]["O2"]
            if mutation=="nonzero-opt":llvm["cases"][0]["guest_exit_by_optimization"]["O0"]=1
            if mutation=="missing-mutant":del llvm["negative_control_exit_by_optimization"]["O2"]
            if mutation=="bad-mutant":llvm["negative_control_exit_by_optimization"]["O2"]=0
            with self.subTest(mutation=mutation):
                with self.assertRaises(checker.EvidenceError):
                    checker.compare(self.contract,java,llvm,self.java_run,
                                    self.java_jobs,self.llvm_run,self.llvm_jobs)

    def test_wrong_repository_or_workflow_identity_rejects(self):
        for field, new_value in (("name","Impostor run"),
                                 ("path",".github/workflows/other.yml"),
                                 ("event","schedule")):
            prior=self.java_run[field]
            self.java_run[field]=new_value
            with self.subTest(field=field):
                with self.assertRaises(checker.EvidenceError):self.check()
            self.java_run[field]=prior
        repo=self.llvm_run["repository"]
        self.llvm_run["repository"]={"full_name":"other/other"}
        with self.assertRaises(checker.EvidenceError):self.check()
        self.llvm_run["repository"]=repo

    def test_bool_ids_duplicate_json_and_tampered_manifest_reject(self):
        self.llvm_run["id"]=True
        with self.assertRaises(checker.EvidenceError):self.check()
        self.llvm_run["id"]=200
        with self.assertRaises(checker.EvidenceError):
            checker.unique_pairs([("id",1),("id",2)])
        raw=self.contract.replace(b'"schemaVersion":1',b'"schemaVersion":2')
        with self.assertRaises(checker.EvidenceError):
            checker.compare(raw,self.java,self.llvm,self.java_run,self.java_jobs,
                            self.llvm_run,self.llvm_jobs)

    def test_noncanonical_and_out_of_range_i64_reject(self):
        for value in ("-0","+1","01","9223372036854775808",
                      "-9223372036854775809", "", 1, True):
            with self.subTest(value=value):
                with self.assertRaises(checker.EvidenceError):
                    checker.i64_decimal(value)

if __name__ == "__main__":
    unittest.main()
