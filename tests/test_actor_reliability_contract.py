#!/usr/bin/env python3
import json, pathlib, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
DATA=json.loads((ROOT/"contracts/runtime/v1/actor-reliability.json").read_text())
class ReliabilityContract(unittest.TestCase):
    def test_all_capacity_classes_are_bounded(self):
        self.assertTrue(all(DATA["bounded"].values()))
    def test_no_ambiguous_success_or_hidden_retry(self):
        s=DATA["semantics"]
        for key in ("silentDropAllowed","implicitRetryAllowed","unboundedRestartAllowed",
                    "sendReceiptMeansProcessing","acceptedWorkRetractedByCallerCancel",
                    "staleIncarnationCanReply","duplicateReplyCanWin"):
            self.assertIs(s[key],False,key)
    def test_supervision_is_controlled_and_replayable(self):
        self.assertTrue(all(DATA["supervision"].values()))
    def test_diagnostics_are_bounded_and_payload_free(self):
        o=DATA["observability"]
        self.assertIs(o["payloadCaptureAllowed"],False)
        self.assertIs(o["arbitraryLabelsAllowed"],False)
        self.assertIs(o["overwrittenEventCountRequired"],True)
        self.assertIs(o["monotonicSequenceRequired"],True)
        self.assertIs(o["monotonicTimeRequired"],True)
    def test_failure_matrix_covers_production_incidents(self):
        gates=set(DATA["requiredGates"])
        for g in ("mailbox-saturation","reply-timeout-cancel-race","crash-loop",
                  "control-under-data-overload","scheduler-fairness","shutdown-race",
                  "bounded-observability","deterministic-fault-injection"):
            self.assertIn(g,gates)
if __name__=="__main__": unittest.main()
