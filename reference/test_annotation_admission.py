"""Reference-only annotation tests, not guest compiler or AOT conformance evidence."""
import copy
import unittest

from annotation_admission import (
    AdmissionError,
    admit_declaration,
    admit_use,
    load_contract,
    require_executable_lowering,
    validate_contract,
)


class AnnotationAdmissionReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = load_contract()

    def use(self, short, target, positional=None, named=None):
        identity = next(e["qualifiedName"] for e in self.spec["registry"] if e["qualifiedName"].split(".")[-1] == short)
        return {"annotation": identity, "target": target,
                "positional": positional or [], "named": named or []}

    def rejects(self, expected, operation):
        with self.assertRaises(AdmissionError) as ctx:
            operation()
        self.assertEqual(ctx.exception.code, expected)

    def test_contract_is_structurally_consistent(self):
        self.assertTrue(validate_contract(self.spec))
        self.assertEqual(len(self.spec["targets"]), 26)
        self.assertEqual(len(self.spec["registry"]), 36)

    def test_each_target_is_explicitly_covered(self):
        for target in self.spec["targets"]:
            with self.subTest(target=target):
                self.assertTrue(admit_declaration(self.spec, [self.use("Doc", target, ["docs"])]))

    def test_declaration_kinds_primary(self):
        for name, target, args in [
            ("Deprecated", "class", []), ("NoCopy", "struct", []),
            ("Sendable", "record", []), ("SerialName", "enum_variant", ["Ready"]),
            ("MailboxCapacity", "actor", [8]), ("Ret", "function", ["int"]),
            ("Ret", "method", ["int"]), ("Inject", "parameter", ["AppContainer"]),
            ("Critical", "actor_handler", [1000]), ("FromJson", "field", ["id"]),
            ("HotReload", "actor", ["restart"]), ("TypeUse", "type_use", ["nonnull"]),
            ("Suppress", "local_binding", ["unused"]), ("MacroOrigin", "macro_definition", ["src"]),
        ]:
            with self.subTest(annotation=name, target=target):
                self.assertTrue(admit_declaration(self.spec, [self.use(name, target, args)]))

    def test_repeatable_metadata_and_nonrepeatable_proof(self):
        self.assertTrue(admit_declaration(self.spec, [
            self.use("Doc", "class", ["first"]), self.use("Doc", "class", ["second"])
        ]))
        self.rejects("DUPLICATE_ANNOTATION", lambda: admit_declaration(self.spec, [
            self.use("Ret", "function", ["int"]), self.use("Ret", "function", ["bool"])
        ]))

    def test_wrong_target_ret_on_module(self):
        self.rejects("WRONG_TARGET", lambda: admit_declaration(self.spec, [self.use("Ret", "module", ["int"])]))

    def test_wrong_target_json_on_actor(self):
        self.rejects("WRONG_TARGET", lambda: admit_declaration(self.spec, [self.use("FromJson", "actor", ["name"])]))

    def test_unknown_annotation_fails_instead_of_opaque_fallback(self):
        use = {"annotation": "tenant.trusted.Critical", "target": "function", "positional": [1]}
        self.rejects("UNKNOWN_ANNOTATION", lambda: admit_declaration(self.spec, [use]))

    def test_spoofed_authority_never_registered(self):
        for name in ("atto.core.Trusted", "atto.core.Unsafe", "atto.core.AllowAll",
                     "atto.core.Untrusted", "ATTO.core.Doc", "atto.core.doc", "atto.cоre.Doc"):
            with self.subTest(name=name):
                self.rejects("UNKNOWN_ANNOTATION", lambda n=name: admit_use(
                    self.spec, {"annotation": n, "target": "class", "positional": ["x"]}))

    def test_unknown_target(self):
        self.rejects("UNKNOWN_TARGET", lambda: admit_use(
            self.spec, self.use("Doc", "class", ["ok"]) | {"target": "thread"}))

    def test_required_argument(self):
        self.rejects("MISSING_ARGUMENT", lambda: admit_use(self.spec, self.use("Ret", "function")))

    def test_excess_positional_argument(self):
        self.rejects("EXCESS_POSITIONAL_ARGUMENTS", lambda: admit_use(
            self.spec, self.use("Ret", "function", ["int", "bool"])))

    def test_unknown_named_argument(self):
        self.rejects("UNKNOWN_ARGUMENT", lambda: admit_use(
            self.spec, self.use("Ret", "function", named=[["return", "int"]])))

    def test_duplicate_named_argument(self):
        self.rejects("DUPLICATE_ARGUMENT", lambda: admit_use(
            self.spec, self.use("Ret", "function", named=[["type", "int"], ["type", "bool"]])))

    def test_positional_named_collision(self):
        self.rejects("DUPLICATE_ARGUMENT", lambda: admit_use(
            self.spec, self.use("Ret", "function", ["int"], [["type", "bool"]])))

    def test_valid_named_argument(self):
        self.assertEqual(admit_use(self.spec, self.use("Ret", "function", named=[["type", "int"]]))["phase"], "proof")

    def test_wrong_shape(self):
        self.rejects("ARGUMENT_SHAPE", lambda: admit_use(
            self.spec, self.use("Doc", "class", named=[{"text": "hello"}])))

    def test_string_bytes_budget(self):
        self.rejects("ARGUMENT_TYPE", lambda: admit_use(
            self.spec, self.use("Doc", "class", ["🔥" * 1025])))

    def test_bool_is_not_positive_int(self):
        for bad in (True, False, 0, -1, 2**63, "8", 1.5):
            with self.subTest(bad=bad):
                self.rejects("ARGUMENT_TYPE", lambda v=bad: admit_use(
                    self.spec, self.use("MailboxCapacity", "actor", [v])))

    def test_enum_closed_domain(self):
        self.rejects("ENUM_VALUE", lambda: admit_use(
            self.spec, self.use("Repr", "struct", ["javascript"])))

    def test_type_reference_cannot_smuggle_expression(self):
        self.rejects("TYPE_IDENTITY", lambda: admit_use(
            self.spec, self.use("Ret", "function", ["system.exec(1)"])))

    def test_declaration_annotation_count_bound(self):
        use = self.use("Doc", "module", ["x"])
        self.rejects("ANNOTATION_LIMIT", lambda: admit_declaration(self.spec, [use] * 65))

    def test_backend_fails_closed_until_semantic_lowering_proven(self):
        use = self.use("Doc", "module", ["x"])
        for backend in self.spec["backendStatus"]:
            with self.subTest(backend=backend):
                self.rejects("ANNOTATION_UNLOWERED", lambda b=backend: require_executable_lowering(
                    self.spec, [use], b))

    def test_unannotated_unit_has_no_annotation_gate(self):
        for backend in self.spec["backendStatus"]:
            self.assertTrue(require_executable_lowering(self.spec, [], backend))

    def test_unknown_backend_not_accepted(self):
        self.rejects("UNKNOWN_BACKEND", lambda: require_executable_lowering(self.spec, [], "js"))

    def test_mutated_contract_identity_rejected(self):
        altered = copy.deepcopy(self.spec)
        altered["registry"].append(copy.deepcopy(altered["registry"][0]))
        self.rejects("ANNOTATION_IDENTITY", lambda: validate_contract(altered))

    def test_contract_must_not_claim_executed_evidence(self):
        altered = copy.deepcopy(self.spec)
        altered["backendStatus"]["java"] = "PASSED"
        self.rejects("EVIDENCE_STATUS", lambda: validate_contract(altered))

    def test_security_grants_must_not_enter_registry(self):
        altered = copy.deepcopy(self.spec)
        altered["registry"].append({
            "qualifiedName": "atto.security.Trusted", "allowedTargets": ["class"],
            "phase": "metadata", "arguments": [], "repeatable": False,
        })
        self.rejects("SPOOFED_AUTHORITY", lambda: validate_contract(altered))


if __name__ == "__main__":
    unittest.main()
