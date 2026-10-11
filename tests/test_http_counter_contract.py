import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from http_counter_contract import (
    CounterContractError, verify_counter_observations,
)

CASES = {
    "main()": 43,
    "counter_response(-1)": -43,
    "counter_response(0)": 0,
    "counter_response(1)": 43,
    "counter_response(2)": 86,
    "counter_response(7)": 301,
}


class HttpCounterContractTest(unittest.TestCase):
    def test_canonical_semantics(self):
        self.assertEqual(6, verify_counter_observations(CASES))

    def test_identically_wrong_backends_cannot_pass(self):
        bad = dict(CASES, **{"counter_response(1)": 44})
        with self.assertRaisesRegex(CounterContractError, "expected 43"):
            verify_counter_observations(bad)

    def test_no_missing_required_probes(self):
        for case in ("main()", "counter_response(0)", "counter_response(-1)"):
            with self.subTest(case=case):
                bad = dict(CASES)
                del bad[case]
                with self.assertRaisesRegex(CounterContractError, "missing"):
                    verify_counter_observations(bad)

    def test_reject_unrecognized_cases(self):
        for case in ("arbitrary()", "counter_response(01)", "counter_response(+1)",
                     "counter_response(1) trailing", "counter_response(-0)"):
            with self.subTest(case=case):
                with self.assertRaises(CounterContractError):
                    verify_counter_observations(dict(CASES, **{case: 1}))

    def test_reject_overflow_inputs(self):
        for argument in (2**63, -(2**63) - 1, 2**63 // 43):
            with self.subTest(argument=argument):
                with self.assertRaises(CounterContractError):
                    verify_counter_observations(dict(CASES, **{
                        f"counter_response({argument})": 0
                    }))

    def test_reject_boolean_outputs(self):
        with self.assertRaises(CounterContractError):
            verify_counter_observations(dict(CASES, **{"main()": True}))


if __name__ == "__main__":
    unittest.main()
