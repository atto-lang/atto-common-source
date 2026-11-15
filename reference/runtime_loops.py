"""Deterministic AttoLang reactor/scheduler/supervisor/mailman reference oracle.

SOURCE-FREE: not a real selector, thread scheduler, compiled .atto guest,
security sandbox or proof of all possible concurrent interleavings.
"""
from collections import deque
from dataclasses import dataclass, field


class LoopError(RuntimeError):
    pass


def require(ok, error):
    if not ok:
        raise LoopError(error)


@dataclass(frozen=True, eq=False)
class ActorRef:
    name: str
    generation: int


@dataclass(eq=False)
class Payload:
    owner: ActorRef
    data: bytes


@dataclass(frozen=True, eq=False)
class IoRef:
    actor: ActorRef
    fd: int
    generation: int


@dataclass(frozen=True, eq=False)
class TurnRef:
    actor: ActorRef
    message_id: int


@dataclass
class Actor:
    ref: ActorRef
    capacity: int
    inbox: deque = field(default_factory=deque)
    accepting: bool = True
    fenced: bool = False
    retired: bool = False
    scheduled: bool = False
    in_flight: TurnRef | None = None
    admitted: int = 0
    completed: int = 0
    failed: int = 0
    abandoned: int = 0


@dataclass
class Registration:
    ref: IoRef
    armed: bool = True
    pending: bool = False


class RuntimeLoops:
    """Sequential transition oracle with explicit adversarial event ordering."""
    def __init__(self, max_control=16, control_burst=4):
        require(type(max_control) is int and max_control > 0, "CONTROL_LIMIT")
        require(type(control_burst) is int and control_burst > 0, "BURST_LIMIT")
        self.actors = {}
        self.generations = {}
        self.ready = deque()
        self.control = deque()
        self.control_pending = {}
        self.control_max = max_control
        self.control_burst_max = control_burst
        self.control_streak = 0
        self.registrations = {}
        self.io_generation = 0
        self.parked = False
        self.wake_count = 0

    def spawn(self, name, capacity=8):
        require(type(name) is str and bool(name), "ACTOR_NAME")
        require(type(capacity) is int and capacity > 0, "MAILBOX_CAP")
        require(name not in self.actors or self.actors[name].retired, "ACTOR_LIVE")
        generation = self.generations.get(name, 0) + 1
        self.generations[name] = generation
        ref = ActorRef(name, generation)
        self.actors[name] = Actor(ref, capacity)
        return ref

    def actor(self, ref):
        require(type(ref) is ActorRef, "ACTOR_REF")
        state = self.actors.get(ref.name)
        require(state is not None and state.ref is ref and not state.retired, "STALE_ACTOR")
        return state

    def allocate(self, sender, data):
        self.actor(sender)
        require(type(data) is bytes, "PAYLOAD_TYPE")
        return Payload(sender, data)

    def read(self, owner, payload):
        self.actor(owner)
        require(type(payload) is Payload and payload.owner is owner, "NOT_OWNER")
        return payload.data

    def _enqueue(self, recipient, payload):
        state = self.actor(recipient)
        require(state.accepting and not state.fenced, "MAILBOX_CLOSED")
        require(len(state.inbox) < state.capacity, "MAILBOX_FULL")
        state.admitted += 1
        state.inbox.append((state.admitted, payload))
        self._schedule(state)
        return state.admitted

    def send(self, sender, recipient, payload):
        self.actor(sender)
        require(type(payload) is Payload and payload.owner is sender, "NOT_OWNER")
        # All admission checks precede the single ownership transition.
        message_id = self._enqueue(recipient, payload)
        payload.owner = recipient
        return message_id

    def _schedule(self, state):
        if state.inbox and not state.scheduled and state.in_flight is None and not state.fenced:
            state.scheduled = True
            self.ready.append(state.ref)

    def post_control(self, actor, kind):
        self.actor(actor)
        require(kind in ("STOP", "PANIC"), "CONTROL_KIND")
        if actor in self.control_pending:
            # PANIC outranks STOP; never lose a terminal panic behind coalescing.
            if kind == "PANIC":
                self.control_pending[actor] = "PANIC"
            return False
        require(len(self.control) < self.control_max, "CONTROL_CAPACITY")
        self.control.append(actor)
        self.control_pending[actor] = kind
        return True

    def _maybe_retire(self, state):
        if not state.accepting and state.in_flight is None and not state.inbox:
            state.retired = True
            state.scheduled = False
            # No actor memory may be released until an actual runtime proves
            # physical thread/continuation quiescence. This model has none.

    def _dispatch_control(self):
        ref = self.control.popleft()
        kind = self.control_pending.pop(ref)
        state = self.actor(ref)
        state.accepting = False
        if kind == "PANIC":
            state.fenced = True
            state.abandoned += len(state.inbox)
            state.inbox.clear()
        self._maybe_retire(state)
        self.control_streak += 1
        return ("CONTROL", ref, kind)

    def select_next(self):
        """CONTROL priority with a bounded burst so ready DATA makes progress."""
        while self.ready and (self.actors.get(self.ready[0].name) is None or
                              self.actors[self.ready[0].name].ref is not self.ready[0] or
                              self.actors[self.ready[0].name].retired or
                              not self.actors[self.ready[0].name].scheduled):
            self.ready.popleft()
        if self.control and (self.control_streak < self.control_burst_max or not self.ready):
            return self._dispatch_control()
        while self.ready:
            ref = self.ready.popleft()
            state = self.actor(ref)
            state.scheduled = False
            if state.fenced or not state.inbox or state.in_flight is not None:
                continue
            message_id, _ = state.inbox.popleft()
            turn = TurnRef(ref, message_id)
            state.in_flight = turn
            self.control_streak = 0
            return ("DATA", turn)
        if self.control:
            return self._dispatch_control()
        return None

    def settle(self, turn, failed=False):
        require(type(turn) is TurnRef, "TURN_REF")
        state = self.actor(turn.actor)
        require(state.in_flight is turn, "STALE_SETTLEMENT")
        require(type(failed) is bool, "SETTLEMENT_TYPE")
        require(not state.fenced or failed, "FENCED_TURN")
        state.in_flight = None
        if failed:
            state.failed += 1
        else:
            state.completed += 1
        self._maybe_retire(state)
        if not state.retired:
            self._schedule(state)
        self.assert_conserved(state)

    @staticmethod
    def assert_conserved(state):
        require(state.admitted == state.completed + state.failed + state.abandoned +
                len(state.inbox) + int(state.in_flight is not None), "LOST_MAIL")

    def register_io(self, actor, fd):
        self.actor(actor)
        require(type(fd) is int and fd >= 0, "INVALID_FD")
        require(fd not in self.registrations, "FD_REGISTERED")
        self.io_generation += 1
        token = IoRef(actor, fd, self.io_generation)
        self.registrations[fd] = Registration(token)
        return token

    def _registration(self, token):
        require(type(token) is IoRef, "IO_TOKEN")
        reg = self.registrations.get(token.fd)
        require(reg is not None and reg.ref is token, "STALE_IO")
        self.actor(token.actor)
        return reg

    def notify_ready(self, token):
        # A stale OS notification must NEVER be delivered to a recycled fd.
        try:
            reg = self._registration(token)
        except LoopError:
            return False
        if not reg.armed:
            return False  # One-shot, no duplicate readiness in the queue.
        reg.armed = False
        reg.pending = True
        if self.parked:
            self.parked = False
            self.wake_count += 1
        return True

    def poll_io(self, token):
        reg = self._registration(token)
        require(reg.pending, "IO_NOT_READY")
        state = self.actor(token.actor)
        if not state.accepting or state.fenced:
            reg.pending = False
            return False
        if len(state.inbox) >= state.capacity:
            # Keep the pending one-shot registration; no spin or lost event.
            return False
        self._enqueue(token.actor, Payload(token.actor, b"IO"))
        reg.pending = False
        return True

    def rearm_io(self, token):
        reg = self._registration(token)
        require(not reg.pending and not reg.armed, "IO_REARM_ORDER")
        require(self.actor(token.actor).accepting, "MAILBOX_CLOSED")
        reg.armed = True

    def cancel_io(self, token):
        try:
            self._registration(token)
        except LoopError:
            return False
        del self.registrations[token.fd]
        return True

    def park_reactor(self):
        if any(r.pending for r in self.registrations.values()):
            return False
        self.parked = True
        return True
