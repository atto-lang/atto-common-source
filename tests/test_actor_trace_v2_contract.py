#!/usr/bin/env python3
"""Check canonical v2 event vocabulary without asserting runtime parity."""
import json
from pathlib import Path
import unittest

CONTRACT = Path(__file__).resolve().parents[1] / "contracts" / "actor-trace-v2.json"

class ActorTraceV2ContractTest(unittest.TestCase):
    def test_contract_is_closed_and_versioned(self):
        obj = json.loads(CONTRACT.read_text())
        self.assertEqual((obj["schema"], obj["version"]), ("atto.actor-trace.v2", 2))
        self.assertEqual(obj["event_base_fields"],
                         ["seq", "kind", "actor_id", "generation"])
        self.assertEqual(set(obj["producer"]["required"]),
                         {"backend", "subject", "emission"})
        self.assertEqual(set(obj["events"]), {
            "actor_spawn", "send_accept", "receive_start", "receive_complete",
            "message_discard", "control_admit", "control_dispatch",
            "critical_read_enter", "critical_read_exit", "critical_write_enter",
            "critical_write_exit", "actor_close", "actor_retire"})
        self.assertEqual(obj["events"]["actor_spawn"], ["serial"])
        self.assertEqual(obj["events"]["receive_start"], ["message_id", "receiver_id"])
        self.assertIn("compiled_atto_guest", obj["producer"]["subjects"])
        self.assertIn("runtime_host", obj["producer"]["subjects"])
        self.assertIn("reference_model", obj["producer"]["subjects"])
        self.assertIn("reconstructed_after_quiescence", obj["producer"]["emissions"])

    def test_formal_guarantees_are_present_not_proof_claims(self):
        obj = json.loads(CONTRACT.read_text())
        for obligation in ("send_accept", "control_admit", "receive_start",
                           "critical_read_enter", "critical_write_enter",
                           "actor_retire", "complete"):
            self.assertTrue(obj["semantics"][obligation])
        self.assertIn("NOT_A_RUNTIME_PROOF", obj["status"])
        self.assertLessEqual(obj["max_events"], 100_000)

if __name__ == "__main__":
    unittest.main()
