#!/usr/bin/env python3
"""Independent hot-actor-reload reference monitor; NOT native execution evidence."""
from dataclasses import dataclass
import unittest


class Refused(Exception):
    pass


@dataclass(frozen=True)
class Image:
    digest: str
    mode: str
    domain: str
    mailbox_abi: str
    state_schema: str
    shared_schema: str
    capabilities: frozenset
    admitted: bool = True


@dataclass
class LiveImage:
    image: Image
    pins: int = 0
    unloaded: bool = False
    quarantined: bool = False


class Actor:
    def __init__(self, kind="private", placement="trusted-process"):
        if kind not in ("private", "shared", "untrusted"):
            raise Refused("unknown actor kind")
        if kind == "untrusted" and placement == "trusted-process":
            raise Refused("untrusted in trusted process")
        if kind != "untrusted" and placement == "untrusted-pool":
            raise Refused("trusted in untrusted pool")
        domain = "untrusted" if kind == "untrusted" else "trusted"
        self.kind = kind
        self.placement = placement
        self.active = LiveImage(Image("v1", "aot", domain, "mail-v1",
                                      "state-v1", "shared-v1", frozenset({"send"})))
        self.retired = []
        self.epoch = 1
        self.incarnation = 1
        self.heap = object()
        self.mailbox = object()
        self.state = 42
        self.frozen = False
        self.control_count = 0
        self.external_pins = 0
        self.pending_mail = 0
        self.quarantine = False

    def stage(self, candidate, authority):
        # authority is an abstract trusted-host input, not a guest string API.
        if authority != "trusted-supervisor" or not candidate.admitted:
            raise Refused("unauthenticated image or unauthorized caller")
        if candidate.digest == self.active.image.digest:
            raise Refused("duplicate code identity")
        if candidate.mode not in ("aot", "jit"):
            raise Refused("invalid executable image mode")
        if candidate.domain != self.active.image.domain:
            raise Refused("cross-trust-domain code")
        return LiveImage(candidate)

    def pin(self):
        if self.frozen:
            raise Refused("DATA pin during freeze")
        self.active.pins += 1
        return self.active

    def release(self, lease):
        if lease.pins == 0:
            raise Refused("double release")
        lease.pins -= 1

    def control(self):
        self.control_count += 1

    def freeze(self, expected):
        if self.frozen or expected != self.epoch:
            raise Refused("duplicate or stale upgrade")
        self.frozen = True

    def abort(self):
        self.frozen = False

    def promote(self, candidate, expected, *, new_state=None, new_heap=None,
                migration_proven=False, shared_grace=False):
        if not self.frozen or expected != self.epoch or self.epoch == (1 << 64) - 1:
            raise Refused("stale, unfrozen or overflowing epoch")
        if self.active.pins or self.external_pins or self.pending_mail:
            raise Refused("old code not physically quiescent")
        old, new = self.active.image, candidate.image
        if not new.admitted or old.domain != new.domain:
            raise Refused("code provenance/domain mismatch")
        if old.mailbox_abi != new.mailbox_abi or old.capabilities != new.capabilities:
            raise Refused("mailbox/capability ABI change")
        state_changed = old.state_schema != new.state_schema
        shared_changed = old.shared_schema != new.shared_schema
        if state_changed and (not migration_proven or new_heap is None or new_heap is self.heap):
            raise Refused("state migration needs proven independent arena")
        if not state_changed and new_heap is not None and new_heap is not self.heap:
            raise Refused("code-only upgrade changed arena")
        if shared_changed and (self.kind != "shared" or not shared_grace):
            raise Refused("shared schema changed without shared-domain grace")
        if not state_changed and new_state is not None and new_state != self.state:
            raise Refused("code-only upgrade modified persistent state")
        self.retired.append(self.active)
        self.active = candidate
        if state_changed:
            self.heap, self.state = new_heap, new_state
        self.epoch += 1
        self.frozen = False

    def unload(self, old, *, success=True):
        if old not in self.retired or old is self.active or old.pins:
            raise Refused("cannot unload live, foreign, or pinned image")
        if old.quarantined:
            raise Refused("unload quarantine must be cleared independently")
        if not success:
            old.quarantined = True
            self.quarantine = True
            return
        old.unloaded = True
        self.retired.remove(old)


class ContractTests(unittest.TestCase):
    def setup_actor(self, kind="private", mode="aot"):
        placement = "untrusted-pool" if kind == "untrusted" else "trusted-process"
        actor = Actor(kind, placement)
        actor.active.image = Image("v1", mode, actor.active.image.domain,
                                   "mail-v1", "state-v1", "shared-v1",
                                   frozenset({"send"}))
        return actor

    def candidate(self, actor, **updates):
        data = vars(actor.active.image) | {"digest": "v2"} | updates
        return actor.stage(Image(**data), "trusted-supervisor")

    def refused(self, attempt):
        with self.assertRaises(Refused):
            attempt()

    def test_aot_jit_aot_every_kind(self):
        for kind in ("private", "shared", "untrusted"):
            a = self.setup_actor(kind)
            first_heap, first_mailbox = a.heap, a.mailbox
            for expected, mode in ((1, "jit"), (2, "aot")):
                c = self.candidate(a, mode=mode, digest="v" + str(expected + 1))
                a.freeze(expected)
                a.promote(c, expected)
                self.assertIs(a.heap, first_heap)
                self.assertIs(a.mailbox, first_mailbox)
                self.assertEqual((a.incarnation, a.epoch, a.state),
                                 (1, expected + 1, 42))
            self.assertEqual(len(a.retired), 2)
            for old in list(a.retired):
                a.unload(old)
            self.assertEqual(a.retired, [])

    def test_aot_to_aot_no_jit(self):
        a = self.setup_actor()
        c = self.candidate(a, mode="aot")
        a.freeze(1)
        a.promote(c, 1)
        self.assertEqual(a.active.image.mode, "aot")

    def test_live_frame_pin_blocks_and_control_progresses(self):
        a = self.setup_actor()
        frame = a.pin()
        c = self.candidate(a)
        a.freeze(1)
        self.refused(lambda: a.promote(c, 1))
        self.refused(a.pin)
        a.control()
        self.assertEqual(a.control_count, 1)
        a.release(frame)
        a.promote(c, 1)
        a.unload(frame)

    def test_stale_duplicate_epoch(self):
        a = self.setup_actor()
        c = self.candidate(a)
        a.freeze(1)
        self.refused(lambda: a.freeze(1))
        self.refused(lambda: a.promote(c, 2))
        a.abort()
        a.freeze(1)
        a.promote(c, 1)
        self.refused(lambda: a.freeze(1))

    def test_untrusted_guest_and_foreign_domain(self):
        a = self.setup_actor("untrusted")
        c = self.candidate(a).image
        self.refused(lambda: a.stage(c, "guest"))
        self.refused(lambda: a.stage(Image(**(vars(c) | {"admitted": False})),
                                    "trusted-supervisor"))
        self.refused(lambda: self.candidate(a, domain="trusted"))
        self.refused(lambda: Actor("untrusted", "trusted-process"))
        self.refused(lambda: Actor("private", "untrusted-pool"))

    def test_mailbox_and_capability_mismatch(self):
        for name, value in (("mailbox_abi", "mail-v2"),
                            ("capabilities", frozenset({"send", "network"}))):
            a = self.setup_actor()
            c = self.candidate(a, **{name: value})
            a.freeze(1)
            self.refused(lambda: a.promote(c, 1))
            self.assertEqual((a.epoch, a.state), (1, 42))

    def test_schema_migration_is_separate_and_proven(self):
        a = self.setup_actor()
        c = self.candidate(a, state_schema="state-v2")
        a.freeze(1)
        self.refused(lambda: a.promote(c, 1))
        self.refused(lambda: a.promote(c, 1, migration_proven=True, new_heap=a.heap))
        fresh = object()
        a.promote(c, 1, new_state=51, new_heap=fresh, migration_proven=True)
        self.assertIs(a.heap, fresh)
        self.assertEqual(a.state, 51)

    def test_shared_layout_change_requires_grace(self):
        a = self.setup_actor("shared")
        c = self.candidate(a, shared_schema="shared-v2")
        a.freeze(1)
        self.refused(lambda: a.promote(c, 1))
        a.promote(c, 1, shared_grace=True)
        other = self.setup_actor("private")
        c2 = self.candidate(other, shared_schema="shared-v2")
        other.freeze(1)
        self.refused(lambda: other.promote(c2, 1, shared_grace=True))

    def test_code_only_state_and_heap_stable(self):
        a = self.setup_actor()
        c = self.candidate(a)
        a.freeze(1)
        self.refused(lambda: a.promote(c, 1, new_state=99))
        self.refused(lambda: a.promote(c, 1, new_heap=object()))
        self.assertEqual(a.state, 42)

    def test_unquiesced_external_and_mailbox(self):
        a = self.setup_actor("shared")
        c = self.candidate(a)
        a.external_pins = 1
        a.pending_mail = 1
        a.freeze(1)
        self.refused(lambda: a.promote(c, 1))
        a.external_pins = 0
        self.refused(lambda: a.promote(c, 1))
        a.pending_mail = 0
        a.promote(c, 1)

    def test_unload_failure_is_quarantined(self):
        a = self.setup_actor()
        c = self.candidate(a)
        a.freeze(1)
        a.promote(c, 1)
        old = a.retired[0]
        a.unload(old, success=False)
        self.assertTrue(a.quarantine)
        self.assertFalse(old.unloaded)
        self.refused(lambda: a.unload(old))

    def test_lease_double_release(self):
        a = self.setup_actor()
        lease = a.pin()
        a.release(lease)
        self.refused(lambda: a.release(lease))

    def test_revision_overflow(self):
        a = self.setup_actor()
        a.epoch = (1 << 64) - 1
        c = self.candidate(a)
        a.freeze(a.epoch)
        self.refused(lambda: a.promote(c, a.epoch))

    def test_invalid_loader_mode(self):
        a = self.setup_actor()
        self.refused(lambda: self.candidate(a, mode="ffi-raw-pointer"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
