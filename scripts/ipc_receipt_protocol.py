"""Conservative IPC actor receipt state model (not a transport implementation).

An authenticated local queue admission, remote receipt and guest-turn terminal
are separate events. A lost acknowledgement cannot be called a failed turn.
"""
from dataclasses import dataclass, replace
from enum import Enum
import re

_TOKEN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class ProtocolViolation(ValueError):
    """A receipt may not advance a different request/session/incarnation."""


class Phase(str, Enum):
    LOCAL_ADMITTED = "LOCAL_ADMITTED"
    REMOTE_RECEIVED = "REMOTE_RECEIVED"
    TURN_COMPLETED = "TURN_COMPLETED"
    TURN_FAILED = "TURN_FAILED"
    OUTCOME_UNKNOWN = "OUTCOME_UNKNOWN"


@dataclass(frozen=True)
class Receipt:
    session_id: str
    incarnation: int
    request_id: str
    payload_sha256: str
    phase: Phase = Phase.LOCAL_ADMITTED

    def __post_init__(self):
        if not all(type(v) is str and _TOKEN.fullmatch(v) for v in
                   (self.session_id, self.request_id)):
            raise ProtocolViolation("invalid immutable IPC correlation identity")
        if type(self.incarnation) is not int or self.incarnation < 1:
            raise ProtocolViolation("invalid actor incarnation")
        if type(self.payload_sha256) is not str or not _SHA256.fullmatch(self.payload_sha256):
            raise ProtocolViolation("payload must bind to an exact SHA-256 digest")
        if type(self.phase) is not Phase:
            raise ProtocolViolation("unknown receipt phase")

    def advance(self, event, *, session_id, incarnation, request_id, payload_sha256):
        """Transition only after comparing the full authenticated request identity.

        This model does NOT grant replay, native delivery, or exactly-once execution.
        """
        if (session_id, incarnation, request_id, payload_sha256) != (
            self.session_id, self.incarnation, self.request_id, self.payload_sha256
        ) or any(type(v) is not t for v, t in [
            (session_id, str), (incarnation, int),
            (request_id, str), (payload_sha256, str)
        ]):
            raise ProtocolViolation("stale or mismatched IPC receipt identity")
        try:
            step = event if type(event) is Phase else Phase(event)
        except (ValueError, TypeError):
            raise ProtocolViolation("unrecognized IPC receipt event") from None
        if step is Phase.REMOTE_RECEIVED and self.phase is Phase.LOCAL_ADMITTED:
            return replace(self, phase=step)
        if step in (Phase.TURN_COMPLETED, Phase.TURN_FAILED) and (
            self.phase is Phase.REMOTE_RECEIVED
        ):
            return replace(self, phase=step)
        if step is Phase.OUTCOME_UNKNOWN and self.phase in (
            Phase.LOCAL_ADMITTED, Phase.REMOTE_RECEIVED
        ):
            return replace(self, phase=step)
        raise ProtocolViolation(f"illegal IPC transition {self.phase.value} -> {step.value}")

    def can_automatically_replay(self):
        # Reconciliation/deduplication has not been negotiated: fail closed.
        return False
