#!/usr/bin/env python3
"""UHL-1 source-free state-machine oracle, NOT an Oreslang guest or ABI proof."""
import unittest


class Denied(Exception):
    pass


class UpgradeModel:
    def __init__(self, *, features=None, kind="shared", tenant="tenant-a"):
        self.issuer = object()            # Represents private runtime-issued authority.
        self.features = frozenset({"code_only", "ets_heir", "subtree"} if features is None else features)
        self.kind, self.tenant = kind, tenant
        self.epoch, self.incarnation, self.table_epoch = 1, 1, 1
        self.supervisor, self.logical_actor = object(), object()
        self.heap, self.mailbox, self.table_id = object(), object(), object()
        self.code, self.child_spec = "v1", "child-v1"
        self.abi, self.state_schema, self.ets_schema = "msg-v1", "state-v1", "ets-v1"
        self.capabilities, self.placement = frozenset({"send"}), "trusted"
        self.state, self.rows, self.on_start_count = 42, {"n": 7}, 1
        self.owner, self.heir = object(), object()  # Runtime-minted, not strings.
        self.transfer, self.table_open = None, True
        self.frozen, self.stopped = False, False
        self.txn = None
        self.pins = {}                 # Token -> (kind, code generation).
        self.retired, self.quarantined = set(), set()
        self.restart_count, self.control_count = 0, 0

    def candidate(self, **changes):
        c = dict(code="v2", abi=self.abi, state_schema=self.state_schema,
                 ets_schema=self.ets_schema, capabilities=self.capabilities,
                 kind=self.kind, tenant=self.tenant, placement=self.placement,
                 child_spec="child-v2", signed=True, topology_known=True)
        c.update(changes)
        return c

    def stage(self, artifact, issuer):
        if self.stopped or self.txn is not None:
            raise Denied("terminal or concurrent upgrade")
        if issuer is not self.issuer or artifact.get("signed") is not True:
            raise Denied("no authenticated supervisor authority or signed manifest")
        if "code_only" not in self.features:
            raise Denied("unsupported hot loading")
        if artifact["code"] == self.code:
            raise Denied("duplicate image")
        self.txn = {"token": object(), "image": artifact.copy(), "phase": "staged",
                    "expected": self.epoch}
        return self.txn["token"]

    def prepare(self, token):
        txn = self._transaction(token, "staged")
        a = txn["image"]
        if not a["topology_known"]:
            raise Denied("unknown supervision topology")
        if a["child_spec"] != self.child_spec and "subtree" not in self.features:
            raise Denied("supervised child-spec update unsupported")
        for attr, required in (("abi", self.abi), ("state_schema", self.state_schema),
                               ("ets_schema", self.ets_schema),
                               ("capabilities", self.capabilities), ("kind", self.kind),
                               ("tenant", self.tenant), ("placement", self.placement)):
            if a[attr] != required:
                raise Denied("incompatible or unproven " + attr)
        txn["phase"] = "prepared"

    def _transaction(self, token, phase=None):
        if self.txn is None or self.txn["token"] is not token:
            raise Denied("foreign or stale transaction")
        if phase is not None and self.txn["phase"] != phase:
            raise Denied("invalid transaction phase")
        return self.txn

    def pin(self, kind):
        if self.frozen or self.stopped or kind not in (
                "turn", "await", "continuation", "timer", "ffi", "shared",
                "ets_reader", "ets_writer", "external", "child"):
            raise Denied("DATA not admitted")
        lease = object()
        self.pins[lease] = (kind, self.code)
        return lease

    def release(self, lease):
        if lease not in self.pins:
            raise Denied("double/foreign lease release")
        del self.pins[lease]

    def freeze(self, token, expected):
        self._transaction(token, "prepared")
        if self.frozen or expected != self.epoch or expected == (1 << 64) - 1:
            raise Denied("stale, busy, or overflowing epoch")
        self.frozen = True
        self.txn["phase"] = "frozen"

    def quiesce(self, token):
        self._transaction(token, "frozen")
        return not self.pins and self.transfer is None

    def control(self):
        self.control_count += 1   # CONTROL can run even while DATA is frozen.

    def commit(self, token, expected):
        txn = self._transaction(token, "frozen")
        if (not self.quiesce(token) or self.stopped or self.epoch != expected
                or txn["expected"] != expected):
            raise Denied("not quiescent or stale commit")
        old = self.code
        # The following single state transition models ONE publication point;
        # an actual runtime must make this tuple linearizable in real execution.
        self.code, self.child_spec, self.epoch = (
            txn["image"]["code"], txn["image"]["child_spec"], expected + 1)
        self.retired.add(old)
        self.txn, self.frozen = None, False
        return self.epoch

    def abort(self, token):
        self._transaction(token)
        self.txn, self.frozen = None, False

    def retire(self, generation, *, unload_succeeded=True):
        if (generation == self.code or generation not in self.retired
                or any(code == generation for _, code in self.pins.values())
                or generation in self.quarantined):
            raise Denied("live, foreign, pinned or quarantined code")
        if not unload_succeeded:
            self.quarantined.add(generation)
            raise Denied("unload quarantined; retain physical image")
        self.retired.remove(generation)

    def write_table(self, owner, key, value):
        if not self.table_open or self.transfer is not None or owner is not self.owner:
            raise Denied("table owner not live/acknowledged")
        if self.frozen:
            raise Denied("table write during upgrade freeze")
        self.rows[key] = value

    def owner_died(self, *, heir_alive=True, heir_tenant="tenant-a"):
        if self.stopped or not self.table_open or self.owner is None or self.transfer is not None:
            raise Denied("table closed or previous handoff still pending")
        if self.table_epoch >= (1 << 64) - 1:
            raise Denied("table epoch exhausted")
        self.owner = None              # Fence the dead owner before any handoff.
        self.table_epoch += 1
        if (not heir_alive or heir_tenant != self.tenant
                or "ets_heir" not in self.features):
            self.table_open = False
            return None               # Fail closed, no automatic public table.
        self.transfer = object()
        return self.transfer

    def acknowledge_heir(self, ticket, heir, tenant):
        if (self.stopped or not self.table_open or self.transfer is None
                or ticket is not self.transfer
                or heir is not self.heir or tenant != self.tenant):
            raise Denied("stale, duplicate or foreign table transfer")
        self.owner = self.heir
        self.transfer = None

    def restart_child(self):
        if self.stopped:
            raise Denied("stopped supervisor cannot restart")
        if self.incarnation >= (1 << 64) - 1:
            raise Denied("actor incarnation exhausted")
        self.incarnation += 1
        self.restart_count += 1
        self.frozen, self.txn = False, None

    def stop(self):
        # Terminal supervisor shutdown revokes logical ETS authority immediately.
        # Physical image/table cleanup still requires separate quiescence evidence.
        self.stopped, self.frozen, self.txn = True, True, None
        self.table_open, self.owner, self.transfer = False, None, None


class UniversalHotLoadTests(unittest.TestCase):
    def setUp(self):
        self.s = UpgradeModel()

    def ready(self, **changes):
        s = self.s
        token = s.stage(s.candidate(**changes), s.issuer)
        s.prepare(token)
        s.freeze(token, s.epoch)
        return token

    def rejects(self, operation):
        with self.assertRaises(Denied):
            operation()

    def test_code_only_retains_actor_heap_mailbox_table_and_rows(self):
        s = self.s
        identities = (s.logical_actor, s.supervisor, s.heap, s.mailbox, s.table_id)
        ticket = self.ready()
        self.assertTrue(s.quiesce(ticket))
        self.assertEqual(s.commit(ticket, 1), 2)
        self.assertEqual((s.state, s.rows, s.on_start_count), (42, {"n": 7}, 1))
        self.assertEqual(identities, (s.logical_actor, s.supervisor, s.heap,
                                      s.mailbox, s.table_id))
        self.assertEqual((s.child_spec, s.restart_count, s.table_epoch),
                         ("child-v2", 0, 1))
        s.retire("v1")

    def test_each_await_ffi_timer_table_and_child_pin_blocks(self):
        for category in ("turn", "await", "continuation", "timer", "ffi",
                         "shared", "ets_reader", "ets_writer", "external", "child"):
            s = UpgradeModel()
            lease = s.pin(category)
            token = s.stage(s.candidate(), s.issuer)
            s.prepare(token); s.freeze(token, 1)
            self.assertFalse(s.quiesce(token), category)
            self.rejects(lambda: s.commit(token, 1))
            s.control()
            self.assertEqual(s.control_count, 1)
            s.release(lease)
            s.commit(token, 1)
            s.retire("v1")

    def test_frozen_data_denied_and_control_progresses(self):
        token = self.ready()
        self.rejects(lambda: self.s.pin("turn"))
        self.rejects(lambda: self.s.write_table(self.s.owner, "n", 100))
        self.s.control()
        self.assertEqual(self.s.control_count, 1)
        self.s.abort(token)
        self.s.write_table(self.s.owner, "n", 8)
        self.assertEqual(self.s.rows["n"], 8)

    def test_forged_authority_and_unsigned_rejected(self):
        self.rejects(lambda: self.s.stage(self.s.candidate(), object()))
        self.rejects(lambda: self.s.stage(self.s.candidate(signed=False),
                                          self.s.issuer))

    def test_missing_capability_fails_closed(self):
        s = UpgradeModel(features={"ets_heir"})
        self.rejects(lambda: s.stage(s.candidate(), s.issuer))

    def test_unknown_supervision_topology_rejected(self):
        token = self.s.stage(self.s.candidate(topology_known=False), self.s.issuer)
        self.rejects(lambda: self.s.prepare(token))
        self.assertEqual(self.s.epoch, 1)

    def test_subtree_update_unsupported(self):
        s = UpgradeModel(features={"code_only"})
        token = s.stage(s.candidate(), s.issuer)
        self.rejects(lambda: s.prepare(token))

    def test_abi_capability_placement_tenant_and_schema_drift_denied(self):
        cases = (
            ("abi", "msg-v2"), ("state_schema", "state-v2"),
            ("ets_schema", "ets-v2"), ("capabilities", frozenset({"ffi"})),
            ("kind", "untrusted"), ("tenant", "tenant-b"),
            ("placement", "untrusted"))
        for key, value in cases:
            s = UpgradeModel()
            token = s.stage(s.candidate(**{key: value}), s.issuer)
            self.rejects(lambda: s.prepare(token))
            self.assertEqual((s.code, s.epoch, s.rows), ("v1", 1, {"n": 7}))

    def test_epoch_cas_and_single_commit(self):
        token = self.ready()
        self.rejects(lambda: self.s.commit(token, 2))
        self.assertEqual(self.s.commit(token, 1), 2)
        self.rejects(lambda: self.s.commit(token, 1))
        self.rejects(lambda: self.s.abort(token))

    def test_stale_foreign_ticket_and_double_release(self):
        token = self.ready()
        self.rejects(lambda: self.s.commit(object(), 1))
        self.rejects(lambda: self.s.abort(object()))
        self.s.abort(token)
        lease = self.s.pin("ffi")
        self.s.release(lease)
        self.rejects(lambda: self.s.release(lease))

    def test_precommit_abort_keeps_old_code(self):
        token = self.ready()
        self.s.abort(token)
        self.assertEqual((self.s.code, self.s.epoch, self.s.child_spec),
                         ("v1", 1, "child-v1"))

    def test_competing_upgrade_cannot_stage(self):
        token = self.ready()
        self.rejects(lambda: self.s.stage(self.s.candidate(code="v3"),
                                          self.s.issuer))
        self.s.abort(token)

    def test_planned_upgrade_not_supervisor_restart(self):
        self.s.commit(self.ready(), 1)
        self.assertEqual((self.s.restart_count, self.s.incarnation), (0, 1))
        self.s.restart_child()
        self.assertEqual((self.s.restart_count, self.s.incarnation), (1, 2))

    def test_ets_heir_stays_fenced_until_ack(self):
        s = self.s
        old_owner, stable_id = s.owner, s.table_id
        receipt = s.owner_died()
        self.assertEqual(s.rows, {"n": 7})
        self.assertIs(s.table_id, stable_id)
        self.assertEqual(s.table_epoch, 2)
        self.rejects(lambda: s.write_table(old_owner, "n", 9))
        self.rejects(lambda: s.write_table(s.heir, "n", 9))
        s.acknowledge_heir(receipt, s.heir, s.tenant)
        s.write_table(s.heir, "n", 9)
        self.assertEqual(s.rows["n"], 9)
        self.rejects(lambda: s.acknowledge_heir(receipt, s.heir, s.tenant))

    def test_duplicate_owner_death_does_not_rotate_pending_receipt(self):
        s = self.s
        ticket = s.owner_died()
        before_epoch = s.table_epoch
        self.rejects(s.owner_died)
        self.assertEqual(s.table_epoch, before_epoch)
        self.assertIs(s.transfer, ticket)
        s.acknowledge_heir(ticket, s.heir, s.tenant)

    def test_heir_cross_tenant_and_dead_heir_fail_closed(self):
        for kwargs in ({"heir_tenant": "other"}, {"heir_alive": False}):
            s = UpgradeModel()
            self.assertIsNone(s.owner_died(**kwargs))
            self.assertFalse(s.table_open)
            self.rejects(lambda: s.write_table(s.heir, "n", 2))

    def test_foreign_and_forged_heir_receipts_rejected(self):
        s = self.s
        t = s.owner_died()
        self.rejects(lambda: s.acknowledge_heir(object(), s.heir, s.tenant))
        self.rejects(lambda: s.acknowledge_heir(t, ("outsider", 3), s.tenant))
        self.rejects(lambda: s.acknowledge_heir(t, s.heir, "other"))
        s.acknowledge_heir(t, s.heir, s.tenant)

    def test_ets_transfer_blocks_upgrade_quiescence(self):
        token = self.ready()
        receipt = self.s.owner_died()
        self.assertFalse(self.s.quiesce(token))
        self.rejects(lambda: self.s.commit(token, 1))
        self.s.acknowledge_heir(receipt, self.s.heir, self.s.tenant)
        self.s.commit(token, 1)

    def test_failed_image_unload_quarantines(self):
        self.s.commit(self.ready(), 1)
        self.rejects(lambda: self.s.retire("v1", unload_succeeded=False))
        self.assertIn("v1", self.s.quarantined)
        self.rejects(lambda: self.s.retire("v1"))

    def test_stop_during_freeze_is_terminal(self):
        token = self.ready()
        self.s.stop()
        self.rejects(lambda: self.s.commit(token, 1))
        self.rejects(lambda: self.s.abort(token))
        self.rejects(lambda: self.s.pin("turn"))

    def test_epoch_overflow_rejected(self):
        self.s.epoch = (1 << 64) - 1
        token = self.s.stage(self.s.candidate(), self.s.issuer)
        self.s.prepare(token)
        self.rejects(lambda: self.s.freeze(token, self.s.epoch))


    def test_explicit_empty_capabilities_never_restore_trusted_defaults(self):
        # Python's `features or defaults` silently granted code loading to empty sets.
        for features in (set(), frozenset(), [], ()):
            s = UpgradeModel(features=features)
            self.assertEqual(s.features, frozenset())
            self.rejects(lambda: s.stage(s.candidate(), s.issuer))
            self.assertIsNone(s.txn)
            self.assertEqual((s.code, s.epoch), ("v1", 1))

    def test_ets_epoch_exhaustion_rejects_before_owner_fencing(self):
        s = self.s
        s.table_epoch = (1 << 64) - 1
        old_owner, stable_table, old_rows = s.owner, s.table_id, s.rows.copy()
        self.rejects(s.owner_died)
        self.assertIs(s.owner, old_owner)
        self.assertIs(s.table_id, stable_table)
        self.assertEqual(s.rows, old_rows)
        self.assertEqual(s.table_epoch, (1 << 64) - 1)
        self.assertIsNone(s.transfer)
        self.assertTrue(s.table_open)

    def test_restart_incarnation_exhaustion_preserves_live_supervisor(self):
        s = self.s
        s.incarnation = (1 << 64) - 1
        self.rejects(s.restart_child)
        self.assertEqual(s.incarnation, (1 << 64) - 1)
        self.assertEqual(s.restart_count, 0)
        self.assertFalse(s.stopped)
        self.assertEqual(s.code, "v1")

    def test_terminal_stop_revokes_pending_ets_heir_receipt(self):
        s = self.s
        pending = s.owner_died()
        stable_id, old_rows = s.table_id, s.rows.copy()
        s.stop()
        self.assertFalse(s.table_open)
        self.assertIsNone(s.owner)
        self.assertIsNone(s.transfer)
        self.assertIs(s.table_id, stable_id)
        self.assertEqual(s.rows, old_rows)
        self.rejects(lambda: s.acknowledge_heir(pending, s.heir, s.tenant))
        self.rejects(lambda: s.write_table(s.heir, "n", 10))

    def test_terminal_stop_fences_live_ets_owner_and_new_heir_admission(self):
        s = self.s
        old_owner = s.owner
        s.stop()
        self.assertFalse(s.table_open)
        self.assertIsNone(s.owner)
        self.rejects(s.owner_died)
        self.rejects(lambda: s.write_table(old_owner, "n", 99))
        self.assertEqual(s.rows["n"], 7)

    def test_terminal_stop_revokes_acked_heir_without_recycling_table(self):
        s = self.s
        ticket = s.owner_died()
        s.acknowledge_heir(ticket, s.heir, s.tenant)
        original_table_id, old_epoch = s.table_id, s.table_epoch
        s.stop()
        self.assertIs(s.table_id, original_table_id)
        self.assertEqual(s.table_epoch, old_epoch)
        self.assertFalse(s.table_open)
        self.rejects(lambda: s.write_table(s.heir, "n", 88))
        self.rejects(lambda: s.acknowledge_heir(ticket, s.heir, s.tenant))

if __name__ == "__main__":
    unittest.main(verbosity=2)
