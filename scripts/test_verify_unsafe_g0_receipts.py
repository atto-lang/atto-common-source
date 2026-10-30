#!/usr/bin/env python3
"""Adversarial oracle selftest; fabricated records never certify guest execution."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[0]))
from verify_unsafe_g0_receipts import GateError, SCHEMA, verify, load

BACKENDS = ("java", "llvm", "net", "wasm", "forge")


def make_records():
    contract = {
        "schema": "oreslang.unsafe-boundary.v1", "schema_version": 1,
        "status": "contract-only", "is_guest_implementation": False,
        "backends": dict.fromkeys(BACKENDS, "pending"),
        "cases": [
            {"id": "ordinary-safe-code", "expected": "accept"},
            {"id": "unsafe-stdlib-relative-dot-prefix", "expected": "reject"},
            {"id": "unsafe-stdlib-relative-parent-prefix", "expected": "reject"},
            {"id": "trusted-native-host-allowlisted-binding", "expected": "accept_after_g2"},
        ],
    }
    raw = json.dumps(contract, separators=(",", ":")).encode()
    profiles = []
    for index, backend in enumerate(BACKENDS, 1):
        obs = []
        for case in contract["cases"][:3]:
            src = 'pub fnc main():int{return 42;}' if case["expected"] == "accept" else (
                f'import module ffi from "{case["id"]}"; pub fnc main():int{{return 42;}}')
            denied = case["expected"] == "reject"
            obs.append(dict(case_id=case["id"], source=src,
                            source_sha256=hashlib.sha256(src.encode()).hexdigest(),
                            outcome="rejected" if denied else "accepted",
                            compiler_rc=1 if denied else 0,
                            diagnostic="unsafe source admission refused" if denied else "",
                            emitted_ir_bytes=0 if denied else 96,
                            emitted_binary_bytes=0))
        head, tree = f"{index:040x}", f"{index+10:040x}"
        run = dict(id=index, run_attempt=1, head_sha=head,
                   status="completed", conclusion="success")
        job = dict(id=index+100, run_id=index, run_attempt=1, head_sha=head,
                   runner_id=index, runner_name="ubuntu-24.04", status="completed",
                   conclusion="success", observed_source_tree=tree,
                   steps=[{"name":name, "status":"completed", "conclusion":"success"}
                          for name in ("Verify exact source head and tree", "Execute G0 source compiler fixtures")])
        profiles.append(dict(backend=backend, source_head=head, source_tree=tree,
                             compiler_sha256="a"*64, run=run, job=job, observations=obs))
    receipt = dict(schema=SCHEMA, contract_sha256=hashlib.sha256(raw).hexdigest(),
                   profiles=profiles)
    return contract, raw, receipt


class FailClosedReceiptGate(unittest.TestCase):
    def setUp(self):
        self.contract, self.raw, self.receipt = make_records()

    def reject(self, mutate):
        data = copy.deepcopy(self.receipt)
        mutate(data)
        with self.assertRaises(GateError):
            verify(self.contract, self.raw, data)

    def test_structurally_consistent_fake_records_still_not_attestation(self):
        self.assertEqual(verify(self.contract, self.raw, self.receipt), (5, 15))

    def test_zero_step(self):
        self.reject(lambda x: x["profiles"][0]["job"].update(steps=[]))

    def test_stale_head(self):
        self.reject(lambda x: x["profiles"][0]["run"].update(head_sha="f"*40))

    def test_wrong_tree(self):
        self.reject(lambda x: x["profiles"][0]["job"].update(observed_source_tree="f"*40))

    def test_wrong_attempt(self):
        self.reject(lambda x: x["profiles"][0]["job"].update(run_attempt=2))

    def test_runnerless(self):
        self.reject(lambda x: x["profiles"][0]["job"].update(runner_id=None))

    def test_skipped_test_step(self):
        self.reject(lambda x: x["profiles"][0]["job"]["steps"][1].update(conclusion="skipped"))

    def test_missing_required_step(self):
        self.reject(lambda x: x["profiles"][0]["job"]["steps"][1].update(name="Unrelated host test"))

    def test_missing_backend(self):
        self.reject(lambda x: x["profiles"].pop())

    def test_duplicate_backend(self):
        self.reject(lambda x: x["profiles"][1].update(backend="java"))

    def test_unpinned_contract(self):
        self.reject(lambda x: x.update(contract_sha256="0"*64))

    def test_case_missing(self):
        self.reject(lambda x: x["profiles"][0]["observations"].pop())

    def test_case_duplicated(self):
        self.reject(lambda x: x["profiles"][0]["observations"][1].update(case_id="ordinary-safe-code"))

    def test_unsafe_admitted(self):
        self.reject(lambda x: x["profiles"][0]["observations"][1].update(outcome="accepted"))

    def test_rejected_with_emitted_ir(self):
        self.reject(lambda x: x["profiles"][0]["observations"][1].update(emitted_ir_bytes=1))

    def test_rejected_with_emitted_binary(self):
        self.reject(lambda x: x["profiles"][0]["observations"][1].update(emitted_binary_bytes=1))

    def test_rejected_without_specific_diagnostic(self):
        self.reject(lambda x: x["profiles"][0]["observations"][1].update(diagnostic=""))

    def test_forged_fixture_digest(self):
        self.reject(lambda x: x["profiles"][0]["observations"][1].update(source_sha256="0"*64))

    def test_boolean_exit_code(self):
        self.reject(lambda x: x["profiles"][0]["observations"][1].update(compiler_rc=True))

    def test_blanket_denial_of_safe_positive(self):
        self.reject(lambda x: x["profiles"][0]["observations"][0].update(outcome="rejected"))

    def test_promote_g2_case_into_g0(self):
        self.reject(lambda x: x["profiles"][0]["observations"].append(
            copy.deepcopy(x["profiles"][0]["observations"][1])))

    def test_duplicate_json_object_key(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/"duplicate.json"
            p.write_text('{"schema":1,"schema":2}')
            with self.assertRaises(GateError):
                load(p)

    def test_json_nonfinite(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/"nan.json"
            p.write_text('{"schema":NaN}')
            with self.assertRaises(GateError):
                load(p)


if __name__ == "__main__":
    unittest.main()
