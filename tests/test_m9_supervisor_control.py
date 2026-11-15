"""M9 supervisor notice shape and safety policy contract tests; not executable actor evidence."""
import json,pathlib,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class M9SupervisorContract(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.c=json.loads((ROOT/"contracts/m9-supervisor-control-v1.json").read_text())
 def test_notice_fields_and_faults(self):
  n=self.c["notice"]
  self.assertEqual(set(n["required"]),{"kind","actor_id","generation","supervisor_id","message_id","fault_code","reason"})
  self.assertEqual(n["kind"],["STOP","PANIC"])
  self.assertEqual(n["fault_codes"]["checked_add_overflow"],1)
  self.assertEqual(n["fault_codes"]["worker_exit"],100)
 def test_bounded_data_and_independent_control(self):
  self.assertEqual(self.c["limits"]["mailbox"]["max"],10000)
  self.assertEqual(self.c["limits"]["control_slots"]["max"],4)
  self.assertTrue(any("independent of bounded DATA" in x for x in self.c["host_rules"]))
 def test_panic_settlement(self):
  rules="\n".join(self.c["host_rules"])
  for word in ("current DATA as FAILED","queued DATA as ABANDONED","at most one PANIC","STOP-to-PANIC","fences new DATA"):
   self.assertIn(word,rules)
 def test_stale_and_forged_worker_handling(self):
  rules="\n".join(self.c["host_rules"])
  self.assertIn("stale actor generation",rules)
  self.assertIn("workers must physically quiesce",rules)
 def test_conservation_and_yield(self):
  rules="\n".join(self.c["host_rules"])
  self.assertIn("accepted = completed + failed + abandoned + queued + in_flight",rules)
  self.assertIn("YIELD retains one accepted",rules)
 def test_nonclaims(self):
  self.assertFalse(self.c["scope"]["general_actor"])
  self.assertFalse(self.c["scope"]["await_select"])
  self.assertFalse(self.c["scope"]["hard_real_time"])
  self.assertIn("not a pooled scheduler",self.c["limits_nonclaims"])
if __name__=="__main__":unittest.main()
