"""Bounded reference oracle for authenticated IPC actor admission and receipts.

Reference-only: DOES NOT authenticate packets, store durable dedup state, dispatch
handlers, implement an actor, or prove at-most-once transport on Java/LLVM.
"""
from dataclasses import dataclass
from enum import Enum
import re

TOKEN = re.compile(r"^[A-Za-z0-9_.-]{1,96}$", re.ASCII)
DIGEST = re.compile(r"^[0-9a-f]{64}$", re.ASCII)
MAX_SEQ = 2**63 - 1


class AdmissionError(ValueError):
    pass


class Stage(str, Enum):
    LOCAL_ADMITTED = "LOCAL_ADMITTED"
    REMOTE_ACCEPTED = "REMOTE_ACCEPTED"
    HANDLER_COMMITTED = "HANDLER_COMMITTED"
    HANDLER_FAILED = "HANDLER_FAILED"
    FAILED = "FAILED"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class Envelope:
    sender_domain: str
    sender_actor: str
    sender_incarnation: int
    destination_actor: str
    destination_incarnation: int
    route_epoch: int
    transport_session: str
    message_sequence: int
    frame_sequence: int
    capability_generation: int
    payload_sha256: str

    def __post_init__(self):
        for key in ("sender_domain", "sender_actor", "destination_actor",
                    "transport_session"):
            val = getattr(self, key)
            if type(val) is not str or not TOKEN.fullmatch(val):
                raise AdmissionError(f"invalid {key}")
        for key in ("sender_incarnation", "destination_incarnation",
                    "route_epoch", "message_sequence",
                    "frame_sequence", "capability_generation"):
            val = getattr(self, key)
            if type(val) is not int or not 1 <= val <= MAX_SEQ:
                raise AdmissionError(f"invalid/overflow {key}")
        if type(self.payload_sha256) is not str or not DIGEST.fullmatch(self.payload_sha256):
            raise AdmissionError("noncanonical payload SHA-256")


class BoundedLedger:
    """Tracks a single logical sender stream with bounded uncompleted messages.

    Monotonic sequence never resets during the instance's lifetime, including
    route/session changes. A new sender incarnation requires a new ledger.
    """
    def __init__(self, *, capacity):
        if type(capacity) is not int or not 1 <= capacity <= 65536:
            raise AdmissionError("invalid correlation capacity")
        self.capacity = capacity
        self._stream = None
        self._last_seq = 0
        self._last_route_epoch = 0
        self._last_capability_generation = 0
        self._live = {}
        self._transport_credits = 0

    @property
    def in_flight(self):
        return len(self._live)

    @property
    def transport_credits(self):
        return self._transport_credits

    def admit(self, envelope):
        if type(envelope) is not Envelope:
            raise AdmissionError("typed canonical envelope required")
        stream = (envelope.sender_domain, envelope.sender_actor,
                  envelope.sender_incarnation, envelope.destination_actor,
                  envelope.destination_incarnation)
        if self._stream is not None and stream != self._stream:
            raise AdmissionError("mixed tenant/actor/incarnation stream")
        if envelope.message_sequence <= self._last_seq:
            raise AdmissionError("stale, duplicate, or reordered logical sequence")
        if envelope.route_epoch < self._last_route_epoch:
            raise AdmissionError("route epoch rollback")
        if envelope.capability_generation < self._last_capability_generation:
            raise AdmissionError("capability generation rollback")
        if len(self._live) >= self.capacity:
            raise AdmissionError("bounded correlation table full")
        self._stream = stream
        self._last_seq = envelope.message_sequence
        self._last_route_epoch = envelope.route_epoch
        self._last_capability_generation = envelope.capability_generation
        self._live[envelope.message_sequence] = [envelope, Stage.LOCAL_ADMITTED]
        self._transport_credits += 1
        return Stage.LOCAL_ADMITTED

    def transition(self, envelope, stage, *, authenticated):
        # Authentication is supplied by a real transport, NOT performed here.
        if authenticated is not True or type(stage) is not Stage or type(envelope) is not Envelope:
            raise AdmissionError("receipt must be authenticated and typed")
        record = self._live.get(envelope.message_sequence)
        if record is None or record[0] != envelope:
            raise AdmissionError("missing, stale, or mismatched receipt envelope")
        previous = record[1]
        if stage is Stage.REMOTE_ACCEPTED and previous is Stage.LOCAL_ADMITTED:
            record[1] = stage
            self._transport_credits -= 1
            return stage
        if stage in (Stage.HANDLER_COMMITTED, Stage.HANDLER_FAILED) and previous is Stage.REMOTE_ACCEPTED:
            del self._live[envelope.message_sequence]
            return stage
        if stage is Stage.FAILED and previous is Stage.LOCAL_ADMITTED:
            self._transport_credits -= 1
            del self._live[envelope.message_sequence]
            return stage
        if stage is Stage.UNKNOWN and previous in (Stage.LOCAL_ADMITTED, Stage.REMOTE_ACCEPTED):
            if previous is Stage.LOCAL_ADMITTED:
                self._transport_credits -= 1
            del self._live[envelope.message_sequence]
            return stage
        raise AdmissionError("illegal, duplicated, or premature receipt")

    def invariant(self):
        if not (0 <= self._transport_credits <= len(self._live) <= self.capacity):
            raise AssertionError("correlation/credit budget violated")
        expected = sum(state is Stage.LOCAL_ADMITTED for _, state in self._live.values())
        if expected != self._transport_credits:
            raise AssertionError("transport credit and receipt stage disagree")
        return True

    def can_replay(self, envelope):
        # No durable dedup journal / idempotency protocol: deny by default.
        return False
