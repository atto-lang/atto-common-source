"""Offline validator tests. Synthetic reports NEVER establish real compiler execution."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / 'scripts/native_guest_parity_gate.py'
spec = importlib.util.spec_from_file_location('native_guest_gate', MODULE)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class NativeGuestV1Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.digest, cls.cases = gate.load_manifest(ROOT)

    def record(self, profile):
        observations = {}
        for name, case in self.cases.items():
            if case['readiness'][profile] != 'required':
                continue
            expected = case['expectation']
            if expected['kind'] == 'return':
                obs = {'fixture_sha256': case['sha256'], 'stage': gate.STAGES[profile],
                       'exit_code': expected['exit_code'], 'linked_guest': True}
            else:
                obs = {'fixture_sha256': case['sha256'], 'stage': 'compiler-reject',
                       'compiler_rc': 1, 'emitted_ir_bytes': 0,
                       'diagnostic': expected['diagnostic']}
            observations[name] = obs
        kind, lowering = {
            'llvm-native-aot': ('linked-native-guest-binary', 'llvm-ir'),
            'graal-jvm-guest': ('jvm-guest-launcher', 'truffle-guest'),
            'graal-native-guest-aot': ('application-specific-native-image', 'compiled-guest-methods')
        }[profile]
        return {'schema_version': 1, 'profile': profile, 'manifest_sha256': self.digest,
                'source_tree': 'a' * 40, 'compiler_sha': 'b' * 40,
                'run_id': 101, 'job_id': 201, 'run_attempt': 1, 'runner_id': 301,
                'artifact_sha256': 'c' * 64, 'artifact_kind': kind,
                'guest_lowering': lowering, 'fallback': 'none', 'conclusion': 'success',
                'observed': observations}

    def test_contract_and_supported_intersection(self):
        llvm, jvm = self.record('llvm-native-aot'), self.record('graal-jvm-guest')
        gate.validate(llvm, self.digest, self.cases)
        gate.validate(jvm, self.digest, self.cases)
        self.assertEqual(gate.compare(llvm, jvm, self.cases), 1)

    def test_native_graal_aot_is_still_pending(self):
        a = self.record('graal-native-guest-aot')
        with self.assertRaisesRegex(gate.ContractError, 'no required executed'):
            gate.validate(a, self.digest, self.cases)
        with self.assertRaisesRegex(gate.ContractError, 'no certified common'):
            gate.compare(a, self.record('llvm-native-aot'), self.cases)

    def test_no_unearned_pending_case_or_fake_guest_aot(self):
        a = self.record('graal-native-guest-aot')
        a['observed']['scalar-main'] = self.record('llvm-native-aot')['observed']['scalar-main']
        with self.assertRaises(gate.ContractError):
            gate.validate(a, self.digest, self.cases)
        a = self.record('llvm-native-aot')
        a['guest_lowering'] = 'interpreter'
        with self.assertRaises(gate.ContractError):
            gate.validate(a, self.digest, self.cases)

    def test_no_zero_step_or_false_positive(self):
        for key, bad in [('job_id', 0), ('run_attempt', False), ('conclusion', 'skipped'),
                         ('fallback', 'interpreter')]:
            a = self.record('llvm-native-aot')
            a[key] = bad
            with self.subTest(key=key), self.assertRaises(gate.ContractError):
                gate.validate(a, self.digest, self.cases)

    def test_exact_expected_values_and_rejection(self):
        for name, field, bad in [('scalar-main', 'exit_code', 43),
                                 ('owned-array-main', 'linked_guest', False),
                                 ('private-array-negative', 'emitted_ir_bytes', 200),
                                 ('private-array-negative', 'compiler_rc', 0)]:
            a = self.record('llvm-native-aot')
            a['observed'][name][field] = bad
            with self.subTest(name=name,field=field), self.assertRaises(gate.ContractError):
                gate.validate(a, self.digest, self.cases)

    def test_manifest_or_fixture_tampering(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / 'fixtures/native-guest-v1').mkdir(parents=True)
            src = ROOT / 'fixtures/native-guest-v1'
            for file in src.iterdir():
                (root / 'fixtures/native-guest-v1' / file.name).write_bytes(file.read_bytes())
            gate.load_manifest(root)
            (root / 'fixtures/native-guest-v1/scalar-main.ores').write_text('return 43;\n')
            with self.assertRaisesRegex(gate.ContractError, 'fixture bytes'):
                gate.load_manifest(root)

    def test_duplicate_json_keys_denied(self):
        with self.assertRaises(gate.ContractError):
            gate.json_load(b'{"run_id":1,"run_id":2}')


if __name__ == '__main__':
    unittest.main()
