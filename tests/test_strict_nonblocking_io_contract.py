import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "NATIVE_IO_NAMING.md"


class StrictNonblockingIoContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = CONTRACT.read_text(encoding="utf-8")

    def test_worker_offload_is_explicitly_noncompliant(self):
        self.assertIn(
            "Worker offload is not a compliant portability fallback",
            self.text,
        )
        self.assertIn(
            "Blocking data-plane syscalls are forbidden",
            self.text,
        )

    def test_multiplexed_reactor_wait_is_allowed_but_per_operation_parking_is_not(self):
        self.assertIn("A single multiplexing reactor may sleep", self.text)
        self.assertIn("epoll_wait", self.text)
        self.assertIn("per-operation I/O worker", self.text)

    def test_bare_synchronous_aliases_are_forbidden(self):
        self.assertIn(
            "Bare synchronous I/O spellings are not compatibility aliases",
            self.text,
        )
        self.assertIn("compile-time/binding errors", self.text)

    def test_blocking_suffix_requires_real_continuation_suspension(self):
        self.assertIn(
            "may reject a canonical `*_blocking` operation entirely",
            self.text,
        )
        self.assertIn(
            "implicit continuation-suspension lowering",
            self.text,
        )
        self.assertIn(
            "same nonblocking provider",
            self.text,
        )

    def test_unsupported_targets_fail_closed(self):
        self.assertIn(
            "fail closed as unsupported",
            self.text,
        )


if __name__ == "__main__":
    unittest.main()
