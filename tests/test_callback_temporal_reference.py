import unittest
from scripts.callback_temporal_reference import InvalidFacts, analyze

def example(timing="mixed", register_first=False):
    launch = {"id": "launch", "kind": "launch", "api": "doMore", "timing": timing,
              "publishes": [{"emitter": "randie", "event": "done"}], "next": []}
    sub = {"id": "sub", "kind": "subscribe", "emitter": "randie", "event": "done", "next": []}
    if register_first:
        sub["next"] = ["launch"]
        entry = "sub"
    else:
        launch["next"] = ["sub"]
        entry = "launch"
    return {"version": "ores-callback-facts/v0", "procedures": [
        {"id": "foo", "entry": entry, "nodes": [launch, sub]}]}

class CallbackTests(unittest.TestCase):
    def test_zalgo_and_late_registration(self):
        self.assertEqual([r["rule"] for r in analyze(example())], ["ORES-CB-001", "ORES-CB-002"])
    def test_always_async_still_races(self):
        self.assertEqual([r["rule"] for r in analyze(example("deferred"))], ["ORES-CB-002"])
    def test_register_first(self):
        self.assertEqual(analyze(example("deferred", True)), [])
    def test_zalgo_even_when_registered(self):
        self.assertEqual([r["rule"] for r in analyze(example("mixed", True))], ["ORES-CB-001"])
    def test_one_branch_unregistered(self):
        doc = example("deferred", True)
        doc["procedures"][0]["nodes"].append({"id":"entry","kind":"noop","next":["sub","launch"]})
        doc["procedures"][0]["entry"] = "entry"
        self.assertEqual([r["rule"] for r in analyze(doc)], ["ORES-CB-002"])
    def test_unrelated_emitter_is_not_subscription(self):
        doc = example("deferred", True)
        for n in doc["procedures"][0]["nodes"]:
            if n["kind"] == "subscribe":
                n["emitter"] = "other"
        self.assertEqual(analyze(doc), [])  # no matching required subscriber modeled
    def test_invalid_api_rejected(self):
        doc = example()
        doc["procedures"][0]["nodes"][0]["timing"] = "magic"
        with self.assertRaises(InvalidFacts):
            analyze(doc)

if __name__ == "__main__":
    unittest.main()
