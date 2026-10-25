use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtocolViolation {
    InvalidIdentity,
    InvalidIncarnation,
    InvalidPayloadDigest,
    MismatchedIdentity,
    UnknownEvent,
    IllegalTransition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReceiptPhase {
    LocalAdmitted,
    RemoteReceived,
    TurnCompleted,
    TurnFailed,
    OutcomeUnknown,
}

fn token64(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn token96(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 96
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
}
fn sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Receipt {
    pub session_id: String,
    pub incarnation: u64,
    pub request_id: String,
    pub payload_sha256: String,
    pub phase: ReceiptPhase,
}
impl Receipt {
    pub fn new(
        session_id: &str,
        incarnation: u64,
        request_id: &str,
        payload_sha256: &str,
    ) -> Result<Self, ProtocolViolation> {
        if !token64(session_id) || !token64(request_id) {
            return Err(ProtocolViolation::InvalidIdentity);
        }
        if incarnation == 0 {
            return Err(ProtocolViolation::InvalidIncarnation);
        }
        if !sha256(payload_sha256) {
            return Err(ProtocolViolation::InvalidPayloadDigest);
        }
        Ok(Self {
            session_id: session_id.into(),
            incarnation,
            request_id: request_id.into(),
            payload_sha256: payload_sha256.into(),
            phase: ReceiptPhase::LocalAdmitted,
        })
    }
    pub fn advance(
        &self,
        event: ReceiptPhase,
        session_id: &str,
        incarnation: u64,
        request_id: &str,
        payload_sha256: &str,
    ) -> Result<Self, ProtocolViolation> {
        if (session_id, incarnation, request_id, payload_sha256)
            != (
                self.session_id.as_str(),
                self.incarnation,
                self.request_id.as_str(),
                self.payload_sha256.as_str(),
            )
        {
            return Err(ProtocolViolation::MismatchedIdentity);
        }
        let allowed = matches!(
            (self.phase, event),
            (ReceiptPhase::LocalAdmitted, ReceiptPhase::RemoteReceived)
                | (ReceiptPhase::RemoteReceived, ReceiptPhase::TurnCompleted)
                | (ReceiptPhase::RemoteReceived, ReceiptPhase::TurnFailed)
                | (ReceiptPhase::LocalAdmitted, ReceiptPhase::OutcomeUnknown)
                | (ReceiptPhase::RemoteReceived, ReceiptPhase::OutcomeUnknown)
        );
        if !allowed {
            return Err(ProtocolViolation::IllegalTransition);
        }
        let mut next = self.clone();
        next.phase = event;
        Ok(next)
    }
    pub fn can_automatically_replay(&self) -> bool {
        false
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdmissionError {
    InvalidToken,
    InvalidCounter,
    InvalidDigest,
    InvalidCapacity,
    MixedStream,
    StaleSequence,
    RouteRollback,
    CapabilityRollback,
    CapacityFull,
    Unauthenticated,
    MissingOrMismatchedReceipt,
    IllegalTransition,
    InvariantViolation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    LocalAdmitted,
    RemoteAccepted,
    HandlerCommitted,
    HandlerFailed,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Envelope {
    pub sender_domain: String,
    pub sender_actor: String,
    pub sender_incarnation: u64,
    pub destination_actor: String,
    pub destination_incarnation: u64,
    pub route_epoch: u64,
    pub transport_session: String,
    pub message_sequence: u64,
    pub frame_sequence: u64,
    pub capability_generation: u64,
    pub payload_sha256: String,
}
impl Envelope {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        sender_domain: &str,
        sender_actor: &str,
        sender_incarnation: u64,
        destination_actor: &str,
        destination_incarnation: u64,
        route_epoch: u64,
        transport_session: &str,
        message_sequence: u64,
        frame_sequence: u64,
        capability_generation: u64,
        payload_sha256: &str,
    ) -> Result<Self, AdmissionError> {
        if [
            sender_domain,
            sender_actor,
            destination_actor,
            transport_session,
        ]
        .iter()
        .any(|s| !token96(s))
        {
            return Err(AdmissionError::InvalidToken);
        }
        const MAX: u64 = i64::MAX as u64;
        if [
            sender_incarnation,
            destination_incarnation,
            route_epoch,
            message_sequence,
            frame_sequence,
            capability_generation,
        ]
        .iter()
        .any(|v| *v == 0 || *v > MAX)
        {
            return Err(AdmissionError::InvalidCounter);
        }
        if !sha256(payload_sha256) {
            return Err(AdmissionError::InvalidDigest);
        }
        Ok(Self {
            sender_domain: sender_domain.into(),
            sender_actor: sender_actor.into(),
            sender_incarnation,
            destination_actor: destination_actor.into(),
            destination_incarnation,
            route_epoch,
            transport_session: transport_session.into(),
            message_sequence,
            frame_sequence,
            capability_generation,
            payload_sha256: payload_sha256.into(),
        })
    }
    fn stream_key(&self) -> (String, String, u64, String, u64) {
        (
            self.sender_domain.clone(),
            self.sender_actor.clone(),
            self.sender_incarnation,
            self.destination_actor.clone(),
            self.destination_incarnation,
        )
    }
}

pub struct BoundedLedger {
    capacity: usize,
    stream: Option<(String, String, u64, String, u64)>,
    last_seq: u64,
    last_route_epoch: u64,
    last_capability_generation: u64,
    live: BTreeMap<u64, (Envelope, Stage)>,
    transport_credits: usize,
}
impl BoundedLedger {
    pub fn new(capacity: usize) -> Result<Self, AdmissionError> {
        if !(1..=65536).contains(&capacity) {
            return Err(AdmissionError::InvalidCapacity);
        }
        Ok(Self {
            capacity,
            stream: None,
            last_seq: 0,
            last_route_epoch: 0,
            last_capability_generation: 0,
            live: BTreeMap::new(),
            transport_credits: 0,
        })
    }
    pub fn in_flight(&self) -> usize {
        self.live.len()
    }
    pub fn transport_credits(&self) -> usize {
        self.transport_credits
    }
    pub fn last_sequence(&self) -> u64 {
        self.last_seq
    }
    pub fn admit(&mut self, envelope: Envelope) -> Result<Stage, AdmissionError> {
        let stream = envelope.stream_key();
        if self.stream.as_ref().is_some_and(|s| *s != stream) {
            return Err(AdmissionError::MixedStream);
        }
        if envelope.message_sequence <= self.last_seq {
            return Err(AdmissionError::StaleSequence);
        }
        if envelope.route_epoch < self.last_route_epoch {
            return Err(AdmissionError::RouteRollback);
        }
        if envelope.capability_generation < self.last_capability_generation {
            return Err(AdmissionError::CapabilityRollback);
        }
        if self.live.len() >= self.capacity {
            return Err(AdmissionError::CapacityFull);
        }
        self.stream = Some(stream);
        self.last_seq = envelope.message_sequence;
        self.last_route_epoch = envelope.route_epoch;
        self.last_capability_generation = envelope.capability_generation;
        self.live
            .insert(envelope.message_sequence, (envelope, Stage::LocalAdmitted));
        self.transport_credits += 1;
        Ok(Stage::LocalAdmitted)
    }
    pub fn transition(
        &mut self,
        envelope: &Envelope,
        stage: Stage,
        authenticated: bool,
    ) -> Result<Stage, AdmissionError> {
        if !authenticated {
            return Err(AdmissionError::Unauthenticated);
        }
        let Some((stored, previous)) = self.live.get(&envelope.message_sequence).cloned() else {
            return Err(AdmissionError::MissingOrMismatchedReceipt);
        };
        if stored != *envelope {
            return Err(AdmissionError::MissingOrMismatchedReceipt);
        }
        match (previous, stage) {
            (Stage::LocalAdmitted, Stage::RemoteAccepted) => {
                self.live.insert(envelope.message_sequence, (stored, stage));
                self.transport_credits -= 1;
            }
            (Stage::RemoteAccepted, Stage::HandlerCommitted | Stage::HandlerFailed) => {
                self.live.remove(&envelope.message_sequence);
            }
            (Stage::LocalAdmitted, Stage::Failed) => {
                self.live.remove(&envelope.message_sequence);
                self.transport_credits -= 1;
            }
            (Stage::LocalAdmitted, Stage::Unknown) => {
                self.live.remove(&envelope.message_sequence);
                self.transport_credits -= 1;
            }
            (Stage::RemoteAccepted, Stage::Unknown) => {
                self.live.remove(&envelope.message_sequence);
            }
            _ => return Err(AdmissionError::IllegalTransition),
        }
        Ok(stage)
    }
    pub fn invariant(&self) -> Result<(), AdmissionError> {
        if self.transport_credits > self.live.len() || self.live.len() > self.capacity {
            return Err(AdmissionError::InvariantViolation);
        }
        let expected = self
            .live
            .values()
            .filter(|(_, s)| *s == Stage::LocalAdmitted)
            .count();
        if expected != self.transport_credits {
            return Err(AdmissionError::InvariantViolation);
        }
        Ok(())
    }
    pub fn can_replay(&self, _envelope: &Envelope) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn receipt() -> Receipt {
        Receipt::new("session_1", 7, "req_1", &"a".repeat(64)).unwrap()
    }
    fn env(seq: u64, route: u64, session: &str, cap: u64, dest_inc: u64) -> Envelope {
        Envelope::new(
            "tenantA",
            "parent",
            4,
            "child",
            dest_inc,
            route,
            session,
            seq,
            1,
            cap,
            &"a".repeat(64),
        )
        .unwrap()
    }

    #[test]
    fn receipt_milestones_and_fail_closed_replay() {
        let local = receipt();
        let remote = local
            .advance(
                ReceiptPhase::RemoteReceived,
                "session_1",
                7,
                "req_1",
                &"a".repeat(64),
            )
            .unwrap();
        let done = remote
            .advance(
                ReceiptPhase::TurnCompleted,
                "session_1",
                7,
                "req_1",
                &"a".repeat(64),
            )
            .unwrap();
        assert_eq!(local.phase, ReceiptPhase::LocalAdmitted);
        assert_eq!(remote.phase, ReceiptPhase::RemoteReceived);
        assert_eq!(done.phase, ReceiptPhase::TurnCompleted);
        assert!(!done.can_automatically_replay());
    }
    #[test]
    fn receipt_rejects_early_failure_stale_identity_duplicates_and_bad_construction() {
        let local = receipt();
        assert_eq!(
            local.advance(
                ReceiptPhase::TurnFailed,
                "session_1",
                7,
                "req_1",
                &"a".repeat(64)
            ),
            Err(ProtocolViolation::IllegalTransition)
        );
        assert_eq!(
            local.advance(
                ReceiptPhase::RemoteReceived,
                "session_1",
                8,
                "req_1",
                &"a".repeat(64)
            ),
            Err(ProtocolViolation::MismatchedIdentity)
        );
        assert!(Receipt::new("../outside", 7, "req_1", &"a".repeat(64)).is_err());
        assert!(Receipt::new("session_1", 0, "req_1", &"a".repeat(64)).is_err());
        assert!(Receipt::new("session_1", 7, "req_1", &"0".repeat(40)).is_err());
        let remote = local
            .advance(
                ReceiptPhase::RemoteReceived,
                "session_1",
                7,
                "req_1",
                &"a".repeat(64),
            )
            .unwrap();
        assert_eq!(
            remote.advance(
                ReceiptPhase::RemoteReceived,
                "session_1",
                7,
                "req_1",
                &"a".repeat(64)
            ),
            Err(ProtocolViolation::IllegalTransition)
        );
    }
    #[test]
    fn disconnect_is_unknown_not_failed() {
        for current in [
            receipt(),
            receipt()
                .advance(
                    ReceiptPhase::RemoteReceived,
                    "session_1",
                    7,
                    "req_1",
                    &"a".repeat(64),
                )
                .unwrap(),
        ] {
            let unknown = current
                .advance(
                    ReceiptPhase::OutcomeUnknown,
                    "session_1",
                    7,
                    "req_1",
                    &"a".repeat(64),
                )
                .unwrap();
            assert_eq!(unknown.phase, ReceiptPhase::OutcomeUnknown);
            assert!(unknown
                .advance(
                    ReceiptPhase::TurnCompleted,
                    "session_1",
                    7,
                    "req_1",
                    &"a".repeat(64)
                )
                .is_err());
        }
    }
    #[test]
    fn ledger_milestones_credit_and_commit() {
        let mut l = BoundedLedger::new(2).unwrap();
        let m = env(1, 8, "sessionA", 2, 3);
        assert_eq!(l.admit(m.clone()), Ok(Stage::LocalAdmitted));
        assert_eq!(l.transport_credits(), 1);
        assert_eq!(
            l.transition(&m, Stage::RemoteAccepted, true),
            Ok(Stage::RemoteAccepted)
        );
        assert_eq!(l.transport_credits(), 0);
        assert_eq!(
            l.transition(&m, Stage::HandlerCommitted, true),
            Ok(Stage::HandlerCommitted)
        );
        assert_eq!(l.in_flight(), 0);
        assert_eq!(l.invariant(), Ok(()));
    }
    #[test]
    fn ledger_rejects_mismatch_duplicate_and_fake_auth() {
        let mut l = BoundedLedger::new(1).unwrap();
        let m = env(1, 8, "sessionA", 2, 3);
        l.admit(m.clone()).unwrap();
        let hostile = env(1, 9, "sessionA", 2, 3);
        assert_eq!(
            l.transition(&hostile, Stage::RemoteAccepted, true),
            Err(AdmissionError::MissingOrMismatchedReceipt)
        );
        assert_eq!(
            l.transition(&m, Stage::RemoteAccepted, false),
            Err(AdmissionError::Unauthenticated)
        );
        l.transition(&m, Stage::RemoteAccepted, true).unwrap();
        assert_eq!(
            l.transition(&m, Stage::RemoteAccepted, true),
            Err(AdmissionError::IllegalTransition)
        );
        assert_eq!(l.invariant(), Ok(()));
    }
    #[test]
    fn ledger_capacity_denial_does_not_consume_sequence() {
        let mut l = BoundedLedger::new(1).unwrap();
        let one = env(1, 8, "sessionA", 2, 3);
        let two = env(2, 9, "sessionA", 2, 3);
        l.admit(one.clone()).unwrap();
        assert_eq!(l.admit(two.clone()), Err(AdmissionError::CapacityFull));
        assert_eq!(l.last_sequence(), 1);
        l.transition(&one, Stage::Unknown, true).unwrap();
        l.admit(two).unwrap();
        assert_eq!(l.last_sequence(), 2);
    }
    #[test]
    fn ledger_preserves_stream_generation_and_route_monotonicity() {
        let mut l = BoundedLedger::new(2).unwrap();
        let first = env(1, 8, "sessionA", 2, 3);
        l.admit(first.clone()).unwrap();
        assert_eq!(
            l.admit(env(2, 7, "sessionA", 2, 3)),
            Err(AdmissionError::RouteRollback)
        );
        assert_eq!(
            l.admit(env(2, 8, "sessionA", 1, 3)),
            Err(AdmissionError::CapabilityRollback)
        );
        assert_eq!(
            l.admit(env(2, 9, "sessionA", 3, 4)),
            Err(AdmissionError::MixedStream)
        );
        l.admit(env(2, 9, "sessionB", 3, 3)).unwrap();
        assert_eq!(l.invariant(), Ok(()));
    }
    #[test]
    fn ledger_failed_only_before_remote_acceptance_and_unknown_never_replays() {
        let mut l = BoundedLedger::new(1).unwrap();
        let m = env(1, 8, "sessionA", 2, 3);
        l.admit(m.clone()).unwrap();
        l.transition(&m, Stage::RemoteAccepted, true).unwrap();
        assert_eq!(
            l.transition(&m, Stage::Failed, true),
            Err(AdmissionError::IllegalTransition)
        );
        assert_eq!(
            l.transition(&m, Stage::HandlerFailed, true),
            Ok(Stage::HandlerFailed)
        );
        let mut l = BoundedLedger::new(1).unwrap();
        let m = env(1, 8, "sessionA", 2, 3);
        l.admit(m.clone()).unwrap();
        assert_eq!(l.transition(&m, Stage::Unknown, true), Ok(Stage::Unknown));
        assert!(!l.can_replay(&m));
        assert_eq!(l.invariant(), Ok(()));
    }
    #[test]
    fn envelope_rejects_overflow_and_invalid_values() {
        assert!(Envelope::new(
            "tenantA",
            "parent",
            4,
            "child",
            3,
            8,
            "sessionA",
            i64::MAX as u64 + 1,
            1,
            2,
            &"a".repeat(64)
        )
        .is_err());
        assert!(Envelope::new(
            "tenantA",
            "parent",
            0,
            "child",
            3,
            8,
            "sessionA",
            1,
            1,
            2,
            &"a".repeat(64)
        )
        .is_err());
        assert!(BoundedLedger::new(0).is_err());
        assert!(BoundedLedger::new(65537).is_err());
    }
}

#[cfg(test)]
mod ledger_stress_tests;
