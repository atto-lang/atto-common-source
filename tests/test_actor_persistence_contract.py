"""Static integrity checks for target-only Atto actor persistence interfaces.

These tests intentionally do NOT execute an AttoLang parser/compiler or filesystem runtime.
"""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class ActorPersistenceContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.api = (ROOT / "interfaces" / "actor_persistence_v1.atto").read_text()
        cls.contract = json.loads((ROOT / "contracts" / "actor-persistence-interfaces-v1.json").read_text())

    def test_modes_are_disjoint_and_not_claimed_as_verified(self):
        c = self.contract
        self.assertEqual(c["status"], "TARGET_API_ONLY_NOT_BACKEND_EXECUTED")
        self.assertEqual(c["mutualExclusion"], ["persistent", "durable"])
        self.assertEqual(c["modifiers"]["persistent"]["storage"], "developer-hooks")
        self.assertEqual(c["modifiers"]["durable"]["storage"], "runtime-managed-os-disk")
        self.assertEqual(c["modifiers"]["durable"]["requires"], [])
        self.assertTrue(all(x == "NOT_EXECUTED" for x in c["backendStatus"].values()))

    def test_trait_and_store_contracts_match_declared_source(self):
        api = self.api
        for name in ("Persistable", "ActorPersistence<State>", "ActorCheckpointStore<State>"):
            self.assertIn(name, api)
        for trait in self.contract["traits"] + self.contract["interfaces"]:
            self.assertEqual(len({m["name"] for m in trait["methods"]}), len(trait["methods"]))
            for m in trait["methods"]:
                args = ", ".join(m["params"])
                signature = f'{m["effect"]} fnc {m["name"]}({args}): {m["returns"]};'
                self.assertIn(signature, api)
        self.assertEqual(
            self.contract["modifiers"]["persistent"]["requires"],
            ["ActorPersistence.load_state", "ActorPersistence.save_state"]
        )

    def test_no_user_durable_trait_or_unsafe_heap_claim(self):
        self.assertNotIn("define pub trait DurableActor", self.api)
        self.assertIn("No user-implementable DurableActor trait", self.api)
        self.assertIn("no continuation/stack/sockets/active loans", self.contract["invariants"]["lifetime"])
        self.assertIn("no runtime claim", self.contract["modifiers"]["persistent"]["guarantee"])
        self.assertIn("without repeating constructor side effects", self.contract["invariants"]["restore"])

if __name__ == "__main__":
    unittest.main()
