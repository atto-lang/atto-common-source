"""Reference control-flow model for the *proposed* postfix '?' contract.

Not an Oreslang frontend, runtime, type checker, or positive backend gate.
Every backend must execute identical guest fixtures before claiming parity.
"""
import json
from pathlib import Path
import unittest

CASES = Path(__file__).resolve().parents[1] / (
    "contracts/v1/elm-composition-reactive/postfix-question.json")
PRIORITY = {"FATAL": 5, "CANCEL": 4, "PANIC": 3,
            "RAISE": 2, "THROW": 1}


def interpret(case):
    events = ["operand-evaluated"]
    family = case["operand"]
    state = case["state"]
    ret = case["returns"]
    throws = case["throws"]
    matched = case["matching_error"]
    derived = case["error_derived"]
    incoming = case.get("preexisting")
    if family == "Result" and ret == "Result" and matched:
        routing = "RETURN_ERR"
    elif family == "Option" and ret == "Option":
        routing = "RETURN_NONE"
    else:
        routing = "REJECT"
    if family not in ("Result", "Option"):
        routing = "REJECT"
    if routing == "REJECT":
        return "REJECT", events, []
    if family == "Result" and state == "ok" or family == "Option" and state == "some":
        routing = "VALUE"
    if incoming:
        # Pre-existing exceptional control cannot be captured by '?'.
        routing = incoming
    events.append("route:" + routing)
    suppressed = []
    for label in reversed(case.get("defers", [])):
        events.append("defer:" + label)
    cleanup_failure = case.get("cleanup_failure")
    if cleanup_failure:
        if routing in PRIORITY and PRIORITY[routing] >= PRIORITY[cleanup_failure]:
            suppressed.append(cleanup_failure)
        else:
            routing = cleanup_failure
    return routing, events, suppressed


class PostfixQuestionReferenceContract(unittest.TestCase):
    def test_vectors_are_unique_and_typed(self):
        vectors = json.loads(CASES.read_text(encoding="utf-8"))
        self.assertEqual(vectors["version"], 1)
        ids = [v["id"] for v in vectors["tests"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertGreaterEqual(len(ids), 20)
        for case in vectors["tests"]:
            with self.subTest(case=case["id"]):
                self.assertIn(case["operand"], ("Option", "Result", "Future",
                                                "Stream", "Observable", "Channel"))
                self.assertIn(case["returns"], ("Result", "Option", "scalar"))
                self.assertIsInstance(case["throws"], bool)
                self.assertIsInstance(case["matching_error"], bool)

    def test_deterministic_route_and_single_evaluation(self):
        vectors = json.loads(CASES.read_text(encoding="utf-8"))
        for case in vectors["tests"]:
            with self.subTest(case=case["id"]):
                outcome, events, _ = interpret(case)
                self.assertEqual(outcome, case["expect"])
                self.assertEqual(events.count("operand-evaluated"), 1)
                self.assertEqual(
                    [e for e in events if e.startswith("defer:")],
                    ["defer:" + label for label in reversed(case.get("defers", []))])
                self.assertFalse(any(e.startswith("next-callback") for e in events))
                self.assertEqual(interpret(case), (outcome, events, interpret(case)[2]))

    def test_error_type_mismatch_cannot_fall_back_to_throw(self):
        case = {"operand": "Result", "state": "err", "returns": "Result",
                "throws": True, "matching_error": False, "error_derived": True}
        self.assertEqual(interpret(case)[0], "REJECT")

    def test_result_question_never_implicitly_throws(self):
        # A throws declaration never permits Result-to-exception coercion.
        # The enclosing callable must return a compatible Result<T,E>.
        for derived in (True, False):
            case = {"operand": "Result", "state": "err", "returns": "scalar",
                    "throws": True, "matching_error": True, "error_derived": derived}
            self.assertEqual(interpret(case)[0], "REJECT")

    def test_returned_err_is_not_a_caught_throw(self):
        case = {"operand": "Result", "state": "err", "returns": "Result",
                "throws": True, "matching_error": True, "error_derived": True,
                "defers": ["outer", "inner"]}
        outcome, events, suppressed = interpret(case)
        self.assertEqual(outcome, "RETURN_ERR")
        self.assertEqual(events[-2:], ["defer:inner", "defer:outer"])
        self.assertFalse(suppressed)

    def test_panic_and_raise_survive_cleanup(self):
        for preexisting, cleanup in (("PANIC", "RAISE"), ("RAISE", "THROW"),
                                     ("CANCEL", "PANIC"), ("FATAL", "CANCEL")):
            case = {"operand": "Result", "state": "err", "returns": "Result",
                    "throws": False, "matching_error": True, "error_derived": True,
                    "preexisting": preexisting, "defers": ["a", "b"],
                    "cleanup_failure": cleanup}
            outcome, _, suppressed = interpret(case)
            self.assertEqual(outcome, preexisting)
            self.assertEqual(suppressed, [cleanup])


if __name__ == "__main__":
    unittest.main()
