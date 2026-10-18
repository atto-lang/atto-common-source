"""Deterministic bounded IPC ledger interleaving regression.

Reference-model only; not a transport crash injector or formal proof.
"""
import random
import unittest
from scripts.ipc_delivery_ledger import AdmissionError, BoundedLedger, Envelope, Stage


class LedgerStressTests(unittest.TestCase):
    def test_credit_and_finalization_under_seeded_interleavings(self):
        random_source = random.Random(1826)
        for scenario in range(1024):
            ledger = BoundedLedger(capacity=random_source.randint(1, 5))
            sequence = 1
            for _ in range(40):
                try:
                    if not ledger._live or random_source.randrange(4) == 0:
                        envelope = Envelope(
                            "tenant", "sender", 3, "receiver", 7,
                            random_source.randint(1, 10),
                            "transport" + str(random_source.randint(1, 10)),
                            sequence, random_source.randint(1, 5),
                            1, "a" * 64,
                        )
                        sequence += 1
                        ledger.admit(envelope)
                    else:
                        envelope, _state = random_source.choice(
                            list(ledger._live.values())
                        )
                        stage = random_source.choice((
                            Stage.REMOTE_ACCEPTED,
                            Stage.HANDLER_COMMITTED,
                            Stage.FAILED,
                            Stage.UNKNOWN,
                        ))
                        ledger.transition(envelope, stage, authenticated=True)
                except AdmissionError:
                    pass
                with self.subTest(scenario=scenario):
                    self.assertTrue(ledger.invariant())
                    self.assertLessEqual(ledger.in_flight, ledger.capacity)
                    self.assertLessEqual(
                        ledger.transport_credits, ledger.in_flight
                    )


if __name__ == "__main__":
    unittest.main()
