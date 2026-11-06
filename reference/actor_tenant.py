"""Source-free actor and tenant ownership state machine; NOT a security sandbox.

This is a deterministic conformance oracle, not AttoLang guest execution.
Host handles here are Python objects: no real guest isolation is implied.
"""
from dataclasses import dataclass, field
import re


class IsolationError(RuntimeError):
    pass


def require(condition, reason):
    if not condition:
        raise IsolationError(reason)


@dataclass(frozen=True)
class TenantRef:
    name: str
    generation: int


@dataclass(frozen=True)
class ActorRef:
    tenant: TenantRef
    name: str
    incarnation: int


@dataclass(frozen=True)
class BufferRef:
    tenant: TenantRef
    object_id: int
    version: int
    nonce: object


@dataclass(frozen=True)
class SharedRef:
    tenant: TenantRef
    object_id: int
    version: int
    nonce: object


@dataclass(frozen=True)
class LoanRef:
    tenant: TenantRef
    object_id: int
    nonce: object
    reader: ActorRef


@dataclass(frozen=True)
class BrokerCap:
    source: TenantRef
    target: TenantRef
    nonce: object


@dataclass
class ActorState:
    ref: ActorRef
    capacity: int
    inbox: list = field(default_factory=list)
    accepting: bool = True


@dataclass
class TenantState:
    ref: TenantRef
    byte_limit: int
    used_bytes: int = 0
    active: bool = True
    actors: dict = field(default_factory=dict)


@dataclass
class BufferState:
    tenant: TenantRef
    owner: ActorRef
    payload: bytearray
    version: int = 1
    nonce: object = field(default_factory=object)
    frozen: bool = False
    loans: dict = field(default_factory=dict)


class HostModel:
    def __init__(self):
        self.tenants = {}
        self.generations = {}
        self.buffers = {}
        self.capabilities = {}
        self.next_id = 1

    def create_tenant(self, name, byte_limit=1024):
        require(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", name)
                and name not in (".", ".."), "INVALID_TENANT")
        require(isinstance(byte_limit, int) and not isinstance(byte_limit, bool)
                and byte_limit >= 0, "INVALID_QUOTA")
        require(name not in self.tenants or not self.tenants[name].active, "ACTIVE_TENANT")
        generation = self.generations.get(name, 0) + 1
        self.generations[name] = generation
        ref = TenantRef(name, generation)
        self.tenants[name] = TenantState(ref, byte_limit)
        return ref

    def _tenant(self, ref):
        require(isinstance(ref, TenantRef), "TENANT_HANDLE")
        state = self.tenants.get(ref.name)
        require(state is not None and state.active and state.ref is ref, "STALE_TENANT")
        return state

    def create_actor(self, tenant, name, capacity=8):
        state = self._tenant(tenant)
        require(isinstance(name, str) and bool(name), "INVALID_ACTOR")
        require(isinstance(capacity, int) and not isinstance(capacity, bool)
                and capacity >= 0, "INVALID_MAILBOX_CAP")
        require(name not in state.actors, "DUPLICATE_ACTOR")
        ref = ActorRef(tenant, name, 1)
        state.actors[name] = ActorState(ref, capacity)
        return ref

    def _actor(self, actor):
        require(isinstance(actor, ActorRef), "ACTOR_HANDLE")
        tenant = self._tenant(actor.tenant)
        state = tenant.actors.get(actor.name)
        require(state is not None and state.ref is actor, "STALE_ACTOR")
        return state

    def _record(self, handle):
        require(isinstance(handle, (BufferRef, SharedRef)), "BUFFER_HANDLE")
        self._tenant(handle.tenant)
        record = self.buffers.get(handle.object_id)
        require(record is not None and record.tenant is handle.tenant
                and record.version == handle.version
                and record.nonce is handle.nonce, "STALE_BUFFER")
        return record

    def _owned(self, actor, handle):
        self._actor(actor)
        rec = self._record(handle)
        require(isinstance(handle, BufferRef) and rec.owner is actor
                and rec.tenant is actor.tenant, "OWNER")
        require(not rec.frozen, "FROZEN")
        return rec

    def allocate(self, actor, data):
        self._actor(actor)
        require(type(data) is bytes, "NON_SERIALIZABLE")
        state = self._tenant(actor.tenant)
        require(len(data) <= state.byte_limit - state.used_bytes, "QUOTA")
        obj_id = self.next_id
        self.next_id += 1
        rec = BufferState(actor.tenant, actor, bytearray(data))
        self.buffers[obj_id] = rec
        state.used_bytes += len(data)
        return BufferRef(actor.tenant, obj_id, rec.version, rec.nonce)

    def read(self, actor, handle):
        return bytes(self._owned(actor, handle).payload)

    def write(self, actor, handle, index, value):
        rec = self._owned(actor, handle)
        require(not rec.loans, "BORROWED")
        require(isinstance(index, int) and 0 <= index < len(rec.payload)
                and isinstance(value, int) and 0 <= value <= 255, "BOUNDS")
        rec.payload[index] = value

    def borrow(self, owner, handle, reader):
        rec = self._owned(owner, handle)
        self._actor(reader)
        require(reader.tenant is owner.tenant, "FOREIGN_TENANT")
        nonce = object()
        rec.loans[nonce] = reader
        return LoanRef(owner.tenant, handle.object_id, nonce, reader)

    def loan_read(self, reader, loan):
        self._actor(reader)
        require(isinstance(loan, LoanRef), "LOAN_HANDLE")
        self._tenant(loan.tenant)
        rec = self.buffers.get(loan.object_id)
        require(rec is not None and rec.tenant is loan.tenant, "STALE_LOAN")
        require(rec.loans.get(loan.nonce) is reader, "REVOKED_LOAN")
        return bytes(rec.payload)

    def release(self, loan):
        require(isinstance(loan, LoanRef), "LOAN_HANDLE")
        self._tenant(loan.tenant)
        rec = self.buffers.get(loan.object_id)
        require(rec is not None and rec.loans.get(loan.nonce) is loan.reader, "REVOKED_LOAN")
        del rec.loans[loan.nonce]

    def _rotate(self, obj_id, rec, cls):
        rec.version += 1
        rec.nonce = object()
        return cls(rec.tenant, obj_id, rec.version, rec.nonce)

    def send_move(self, sender, recipient, handle):
        rec = self._owned(sender, handle)
        dest = self._actor(recipient)
        require(sender.tenant is recipient.tenant, "FOREIGN_TENANT")
        require(not rec.loans, "BORROWED")
        require(dest.accepting, "MAILBOX_CLOSED")
        require(len(dest.inbox) < dest.capacity, "MAILBOX_FULL")
        # Admission is checked before the ownership transition: failed sends retain the owner.
        rec.owner = recipient
        next_ref = self._rotate(handle.object_id, rec, BufferRef)
        dest.inbox.append(next_ref)
        return next_ref

    def receive(self, recipient):
        dest = self._actor(recipient)
        require(bool(dest.inbox), "MAILBOX_EMPTY")
        return dest.inbox.pop(0)

    def close_mailbox(self, actor):
        self._actor(actor).accepting = False

    def freeze(self, owner, handle):
        rec = self._owned(owner, handle)
        require(not rec.loans, "BORROWED")
        rec.frozen = True
        return self._rotate(handle.object_id, rec, SharedRef)

    def shared_read(self, reader, handle):
        self._actor(reader)
        rec = self._record(handle)
        require(isinstance(handle, SharedRef) and rec.frozen, "NOT_FROZEN")
        require(reader.tenant is rec.tenant, "FOREIGN_TENANT")
        return bytes(rec.payload)

    def grant_copy(self, source, target):
        self._tenant(source)
        self._tenant(target)
        nonce = object()
        cap = BrokerCap(source, target, nonce)
        self.capabilities[nonce] = cap
        return cap

    def revoke(self, cap):
        require(isinstance(cap, BrokerCap), "INVALID_CAPABILITY")
        require(self.capabilities.get(cap.nonce) is cap, "REVOKED_CAPABILITY")
        del self.capabilities[cap.nonce]

    def broker_copy(self, sender, source, recipient, cap):
        self._actor(sender)
        self._actor(recipient)
        require(isinstance(cap, BrokerCap)
                and self.capabilities.get(cap.nonce) is cap
                and cap.source is sender.tenant and cap.target is recipient.tenant,
                "UNAUTHORIZED_COPY")
        require(sender.tenant is not recipient.tenant, "USE_SAME_TENANT_TRANSFER")
        if isinstance(source, BufferRef):
            payload = self.read(sender, source)
        else:
            payload = self.shared_read(sender, source)
        return self.allocate(recipient, payload)

    def retire_tenant(self, tenant):
        state = self._tenant(tenant)
        # Model retirement is immediate; real runtimes must drain outstanding host-owned loans.
        state.active = False
        for obj_id, rec in list(self.buffers.items()):
            if rec.tenant is tenant:
                del self.buffers[obj_id]
        state.used_bytes = 0
        for nonce, cap in list(self.capabilities.items()):
            if cap.source is tenant or cap.target is tenant:
                del self.capabilities[nonce]
