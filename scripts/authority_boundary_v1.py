"""Source-free Oreslang authority-boundary oracle (NOT a compiler or sandbox).

Models conservative admission of opaque values, per-actor delegated process
permissions, critical state loans, and generation-fenced code replacement.
No guest program is compiled or executed by this module.
"""
from dataclasses import dataclass


class Denied(PermissionError):
    """Conservative, deliberately nonrecovering boundary rejection."""


def _require(condition, message):
    if not condition:
        raise Denied(message)


_EFFECT_RIGHTS = {
    "io.net": "net.connect",
    "io.file.read": "fs.read",
    "io.file.write": "fs.write",
    "io.env": "env.read",
    "process.spawn": "process.spawn",
    "ffi": "ffi.call",
}
_KNOWN_RIGHTS = frozenset(_EFFECT_RIGHTS.values())


def _rights(value):
    _require(isinstance(value, (frozenset, set, tuple, list)), "invalid rights container")
    _require(all(type(v) is str and v in _KNOWN_RIGHTS for v in value), "unknown right")
    return frozenset(value)


def _scalar(type_name, value):
    """Snapshots values; accepts no references, callables, capabilities or containers."""
    _require(type(type_name) is str, "type descriptor required")
    if type_name == "int":
        _require(type(value) is int and -(1 << 63) <= value < (1 << 63), "not int64")
    elif type_name == "bool":
        _require(type(value) is bool, "not bool")
    elif type_name == "string":
        _require(type(value) is str, "not string")
    elif type_name.startswith("Option[") and type_name.endswith("]"):
        inner = type_name[7:-1]
        _require(inner in ("int", "bool", "string"), "unverified Option element type")
        if value is not None:
            _scalar(inner, value)
    else:
        raise Denied("unverified dynamic representation")
    return value  # Supported scalars are immutable Python values.


@dataclass(frozen=True)
class _Actor:
    name: str
    generation: int
    rights: frozenset
    parent: object | None


class AuthorityBoundaryV1:
    """Small sequential reference model with privately issued opaque tokens."""

    def __init__(self, process_permissions):
        self._process = _rights(process_permissions)
        self._actors = {}        # opaque token -> _Actor; token identity is authority
        self._current = {}       # actor name -> active token
        self._dynamic = {}       # opaque token -> (kind, type, snapshot)
        self._loans = {}         # opaque token -> owning actor token

    def _actor(self, token):
        _require(type(token) is object, "invalid actor authority")
        actor = self._actors.get(token)
        _require(actor is not None and self._current.get(actor.name) is token,
                 "unissued, foreign, or retired actor authority")
        return actor

    def root_actor(self, name, permissions):
        rights = _rights(permissions)
        _require(type(name) is str and bool(name) and name not in self._current,
                 "duplicate or invalid actor name")
        _require(rights <= self._process, "process denied requested authority")
        return self._issue_actor(_Actor(name, 1, rights, None))

    def _issue_actor(self, actor):
        token = object()
        self._actors[token] = actor
        self._current[actor.name] = token
        return token

    def spawn(self, parent_token, name, permissions):
        parent = self._actor(parent_token)
        self._not_loaned(parent_token)
        rights = _rights(permissions)
        _require(rights <= parent.rights, "child cannot escalate parent authority")
        _require(type(name) is str and bool(name) and name not in self._current,
                 "duplicate or invalid actor name")
        return self._issue_actor(_Actor(name, 1, rights, parent_token))

    def unknown(self, raw):
        """Opaque untrusted source: creation does not inspect or execute raw."""
        token = object()
        self._dynamic[token] = ("unknown", None, raw)
        return token

    def pack_any(self, type_name, value):
        snapshot = _scalar(type_name, value)
        token = object()
        self._dynamic[token] = ("any", type_name, snapshot)
        return token

    def validate(self, unknown_token, type_name):
        kind, _, raw = self._dyn(unknown_token)
        _require(kind == "unknown", "only unknown can enter validation")
        # Trust is established by an explicit, compiler-owned guard.
        return self.pack_any(type_name, raw)

    def narrow(self, any_token, type_name):
        kind, actual, value = self._dyn(any_token)
        _require(kind == "any", "unknown requires validation")
        _require(actual == type_name, "dynamic type mismatch")
        return value

    def _dyn(self, token):
        _require(type(token) is object, "unissued dynamic value")
        record = self._dynamic.get(token)
        _require(record is not None, "unissued dynamic value")
        return record

    def enter_critical(self, actor_token):
        self._actor(actor_token)
        _require(actor_token not in self._loans.values(), "nested state loan not modeled")
        lease = object()
        self._loans[lease] = actor_token
        return lease

    def leave_critical(self, actor_token, lease):
        self._actor(actor_token)
        _require(type(lease) is object and self._loans.get(lease) is actor_token,
                 "invalid or foreign state loan")
        del self._loans[lease]

    def _not_loaned(self, actor_token):
        _require(actor_token not in self._loans.values(), "critical loan cannot cross a boundary")

    def send(self, sender_token, recipient_token, message):
        self._actor(sender_token)
        self._actor(recipient_token)
        self._not_loaned(sender_token)
        # Deliberately narrow v1: dynamic wrappers, refs, borrow handles and
        # mutable structures are not eligible to be serialized as messages.
        if type(message) is int:
            return _scalar("int", message)
        if type(message) is str:
            return _scalar("string", message)
        if type(message) is bool:
            return _scalar("bool", message)
        raise Denied("unproved message ownership/serialization")

    def perform(self, actor_token, effect, declared_effects=()):
        actor = self._actor(actor_token)
        self._not_loaned(actor_token)
        # A source annotation is evidence of an effect, never its authority.
        _require(type(effect) is str and effect in _EFFECT_RIGHTS, "unverified effect")
        _require(type(declared_effects) is tuple, "effect declaration must be a tuple")
        _require(effect in tuple(item for item in declared_effects if type(item) is str), "missing declared effect")
        _require(_EFFECT_RIGHTS[effect] in actor.rights, "missing runtime capability")
        return effect

    def upgrade(self, actor_token, new_permissions, schema_compatible=True):
        actor = self._actor(actor_token)
        rights = _rights(new_permissions)
        _require(type(schema_compatible) is bool and schema_compatible,
                 "state schema requires separately verified migration")
        self._not_loaned(actor_token)
        _require(rights <= actor.rights, "upgrade cannot mint permissions")
        # Fail closed rather than leaving live child delegations that exceed
        # their upgraded parent's rights or lose a valid parent generation.
        _require(not any(self._current.get(a.name) is t and a.parent is actor_token
                         for t, a in self._actors.items()),
                 "live children require coordinated upgrade")
        return self._issue_actor(_Actor(actor.name, actor.generation + 1,
                                        rights, actor.parent))
