import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "fixed-buffer-pool-v1.json"

class FixedBufferPoolContractTest(unittest.TestCase):
    def setUp(self):
        self.c = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_contract_identity_and_allocation_policy(self):
        self.assertEqual(self.c["schema"], "atto.fixed-buffer-pool.v1")
        self.assertEqual(self.c["source_extension"], ".atto")
        self.assertEqual(self.c["status"], "PROPOSED_NOT_GUEST_EXECUTED")
        self.assertTrue(self.c["hot_path"]["requires_preallocation"])
        self.assertEqual(self.c["hot_path"]["max_dynamic_allocations"], 0)
        self.assertEqual(self.c["hot_path"]["policy"], "fixed_capacity_fail_closed")
        self.assertGreaterEqual(self.c["evidence"]["minimum_operations"], 100000)

    def test_fail_closed_and_borrow_invariants(self):
        required = {
            "exhaustion_no_growth", "double_release_rejected",
            "sender_inaccessible_after_transfer", "sender_inaccessible_in_escrow",
            "failed_send_restores_sender_lease", "live_mutable_loan_exclusive",
            "live_read_loan_blocks_recycle", "stale_generation_rejected",
            "generation_overflow_fails_closed", "pool_retirement_rejects_admission",
            "outstanding_lease_pins_storage", "tenant_reuse_zeroized",
            "io_completion_pin_required", "actor_incarnation_generation_required",
            "cross_tenant_transfer_rejected", "mailbox_credit_retained_until_release",
            "unacknowledged_delivery_fail_closed",
            "sender_resource_handoff_ticket_settled",
            "receiver_registry_loan_retained_until_physical_ack",
            "retired_receiver_denies_admission",
            "dropped_unacknowledged_delivery_blocks_registry_reclaim",
        }
        self.assertTrue(required.issubset(set(self.c["invariants"])))
        self.assertEqual(self.c["resource"]["ownership"], "affine")
        self.assertEqual(self.c["resource"]["external_identity"], "trusted_runtime_only")
        self.assertEqual(self.c["resource"]["owner_identity"],
                         ["tenant_id", "actor_id", "actor_generation"])
        self.assertEqual(self.c["resource"]["cross_tenant_transfer"], "denied_v1")
        self.assertEqual(self.c["resource"]["authenticated_host_zero_allocation"],
                         "NOT_PROVEN_dynamic_activity_ticket_nodes")
        self.assertEqual(set(self.c["evidence"]["backend_targets"]), {"java","llvm","net"})

    def test_no_guest_proof_from_host_only_coverage(self):
        self.assertEqual(self.c["evidence"]["host_runtime"], "HOST_ONLY")
        self.assertEqual(self.c["evidence"]["compiled_guest"], "NOT_EXECUTED")
        self.assertIn("leased", self.c["transitions"]["available"])
        self.assertNotIn("leased", self.c["transitions"]["retired"])

if __name__ == "__main__":
    unittest.main()
