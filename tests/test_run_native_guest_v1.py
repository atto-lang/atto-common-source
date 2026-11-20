"""Runner failure-path model tests only; NOT actual Oreslang compilation."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import run_native_guest_v1 as runner


class RunnerFailClosed(unittest.TestCase):
    def test_no_fictional_graal_guest_native_aot(self):
        with self.assertRaisesRegex(runner.ContractError, 'does NOT implement'):
            runner.gather('graal-native-guest-aot', ROOT, ROOT, Path('/bin/true'))

    def test_compiler_root_without_real_checkout_denied(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaisesRegex(runner.ContractError, 'real Git checkout'):
                runner.gather('llvm-native-aot', ROOT, Path(td), Path('/bin/true'), clang=Path('/bin/true'))

    def test_process_fail_closed_on_bad_command(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(FileNotFoundError):
                runner.bounded(['/definitely/not/a/compiler'], cwd=Path(td))

    def test_digest_rejects_missing_artifact(self):
        with self.assertRaises(runner.ContractError):
            runner.digest_file(Path('/nonexistent/native-guest-aot-binary'))


if __name__ == '__main__':
    unittest.main()
