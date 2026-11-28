"""Source-free reference oracle. NOT a security boundary or compiled Oreslang proof.

Only host_* methods model privileged supervisor setup; guest operations are
check_native_access/transport. Capability identity is checked without calling
methods on an attacker-provided object.
"""
from dataclasses import dataclass

class Denied(ValueError):
    pass

@dataclass(frozen=True)
class _Actor:
    token: object
    trusted: bool
    epoch: int
    native_allowed: bool

@dataclass(frozen=True)
class _Grant:
    token: object
    actor: object
    actor_epoch: int
    region: object
    region_epoch: int
    start: int
    size: int
    writable: bool

class UnsafeBoundaryOracle:
    def __init__(self):
        self._actors = {}
        self._grants = {}
        self._regions = {}

    @staticmethod
    def _find(entries, token):
        # An object's identity, not __hash__, __eq__, or user attributes.
        record = entries.get(id(token))
        if record is None or record.token is not token:
            raise Denied("unrecognized capability identity")
        return record

    def host_actor(self, *, trusted, native_allowed):
        token = object()
        self._actors[id(token)] = _Actor(token, trusted, 0, native_allowed)
        return token

    def host_region(self):
        token = object()
        self._regions[id(token)] = [token, 0, True]
        return token

    def host_grant(self, actor, region, *, start, size, writable):
        a = self._find(self._actors, actor)
        rr = self._regions.get(id(region))
        if rr is None or rr[0] is not region or not rr[2]:
            raise Denied("region is unavailable")
        if not a.trusted or not a.native_allowed:
            raise Denied("actor is not authorized for native memory")
        if type(start) is not int or type(size) is not int or start < 0 or size <= 0:
            raise Denied("invalid native grant extent")
        if start > (1 << 64) - size:
            raise Denied("address extent overflows u64")
        token = object()
        self._grants[id(token)] = _Grant(token, actor, a.epoch, region, rr[1],
                                         start, size, writable)
        return token

    def host_restart(self, actor):
        a = self._find(self._actors, actor)
        self._actors[id(actor)] = _Actor(actor, a.trusted, a.epoch + 1, a.native_allowed)

    def host_recycle_region(self, region):
        rr = self._regions.get(id(region))
        if rr is None or rr[0] is not region:
            raise Denied("unknown region")
        rr[1] += 1  # Old grants cannot become valid again through address reuse.

    def check_native_access(self, actor, grant, *, lexical_unsafe, effects,
                            address, width, write=False, suspended=False):
        a = self._find(self._actors, actor)
        g = self._find(self._grants, grant)
        if not a.trusted or not a.native_allowed or not lexical_unsafe:
            raise Denied("unsafe syntax alone cannot grant native access")
        if type(effects) is not frozenset or any(type(e) is not str for e in effects):
            raise Denied("invalid effect summary")
        if "unsafe.memory" not in effects:
            raise Denied("required unsafe effect absent")
        if g.actor is not actor or g.actor_epoch != a.epoch:
            raise Denied("actor or hot-swap generation mismatch")
        rr = self._regions.get(id(g.region))
        if rr is None or rr[0] is not g.region or not rr[2] or rr[1] != g.region_epoch:
            raise Denied("stale region generation")
        if type(address) is not int or type(width) is not int or width not in (1, 2, 4, 8):
            raise Denied("invalid access width/address")
        if address < g.start or address - g.start > g.size - width:
            raise Denied("out of bounds or arithmetic overflow")
        if address % width:
            raise Denied("misaligned typed access")
        if write and not g.writable:
            raise Denied("read-only grant cannot be promoted")
        if suspended:
            raise Denied("raw lease cannot suspend without a separate pin proof")
        return True
