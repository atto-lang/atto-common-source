//! Deterministic bounded reference-model interleavings; not transport execution.
use super::*;

#[test]
fn credit_and_finalization_under_seeded_interleavings() {
    let mut seed = 1826_u64;
    let mut next = |bound: u64| {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        (seed >> 32) % bound
    };
    for _scenario in 0..1024 {
        let capacity = (next(5) + 1) as usize;
        let mut ledger = BoundedLedger::new(capacity).unwrap();
        let mut sequence = 1;
        for _ in 0..40 {
            if ledger.live.is_empty() || next(4) == 0 {
                let envelope = Envelope::new(
                    "tenant",
                    "sender",
                    3,
                    "receiver",
                    7,
                    next(10) + 1,
                    &format!("transport{}", next(10) + 1),
                    sequence,
                    next(5) + 1,
                    1,
                    &"a".repeat(64),
                )
                .unwrap();
                sequence += 1;
                let _ = ledger.admit(envelope);
            } else {
                let index = next(ledger.live.len() as u64) as usize;
                let envelope = ledger.live.values().nth(index).unwrap().0.clone();
                let stage = [
                    Stage::RemoteAccepted,
                    Stage::HandlerCommitted,
                    Stage::Failed,
                    Stage::Unknown,
                ][next(4) as usize];
                let _ = ledger.transition(&envelope, stage, true);
            }
            assert_eq!(ledger.invariant(), Ok(()));
            assert!(ledger.in_flight() <= capacity);
            assert!(ledger.transport_credits() <= ledger.in_flight());
        }
    }
}
