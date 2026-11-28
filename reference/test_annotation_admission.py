"""Reference-only annotation tests, not guest compiler or AOT conformance evidence."""
import copy
import unittest

from annotation_admission import (
    AdmissionError,
    admit_declaration,
    admit_scoped_declaration,
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
        self.assertEqual(len(self.spec["registry"]), 43)

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

    def test_override_method_only_and_callables_map_to_distinct_targets(self):
        valid = self.use("Override", "method")
        self.assertTrue(admit_declaration(self.spec, [valid]))
        self.assertEqual(admit_use(self.spec, valid)["phase"], "proof")
        for target in ("class", "actor", "function", "actor_handler",
                       "constructor", "field", "local_binding"):
            with self.subTest(target=target):
                self.rejects("WRONG_TARGET", lambda t=target:
                    admit_declaration(self.spec, [self.use("Override", t)]))
        self.rejects("DUPLICATE_ANNOTATION", lambda:
            admit_declaration(self.spec, [valid, valid]))
        self.rejects("EXCESS_POSITIONAL_ARGUMENTS", lambda:
            admit_declaration(self.spec, [self.use("Override", "method", ["x"])]))
        self.rejects("UNKNOWN_ARGUMENT", lambda:
            admit_declaration(self.spec, [self.use(
                "Override", "method", named=[["value", "x"]])]))
        # The registry's 'function' target includes direct-call routines.
        self.assertTrue(admit_declaration(self.spec, [
            self.use("Deprecated", "function")]))
        # Registry-only acceptance never asserts actual backend execution.
        for backend in self.spec["backendStatus"]:
            self.rejects("ANNOTATION_UNLOWERED", lambda b=backend:
                require_executable_lowering(self.spec, [valid], b))

    def test_repeatable_metadata_and_nonrepeatable_proof(self):
        self.assertTrue(admit_declaration(self.spec, [
            self.use("Doc", "class", ["first"]), self.use("Doc", "class", ["second"])
        ]))
        self.rejects("DUPLICATE_ANNOTATION", lambda: admit_declaration(self.spec, [
            self.use("Ret", "function", ["int"]), self.use("Ret", "function", ["bool"])
        ]))

    def test_annotation_batch_cannot_mix_declarations(self):
        self.rejects("MIXED_DECLARATION_TARGET", lambda: admit_declaration(self.spec, [
            self.use("Doc", "class", ["class docs"]),
            self.use("Doc", "actor", ["actor docs"]),
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


    def test_scoped_class_method_and_function_annotation_targets(self):
        self.assertTrue(admit_scoped_declaration(self.spec, [
            self.use("Deprecated", "class", ["Migrate to V2"]),
            self.use("NoCopy", "class"),
        ], {"target": "class"}))
        self.assertTrue(admit_scoped_declaration(self.spec, [
            self.use("Deprecated", "function", ["Use replacement"]),
            self.use("Test", "function"),
        ], {"target": "function", "is_routine": False}))
        self.assertTrue(admit_scoped_declaration(self.spec, [
            self.use("Deprecated", "method", ["Use replacement"]),
        ], {"target": "method", "owner_kind": "class"}))
        self.rejects("MIXED_DECLARATION_TARGET", lambda:
            admit_scoped_declaration(self.spec, [
                self.use("Doc", "method", ["misplaced"])
            ], {"target": "class"}))
        self.rejects("WRONG_TARGET", lambda:
            admit_scoped_declaration(self.spec, [
                self.use("NoCopy", "function")
            ], {"target": "function"}))

    def test_override_requires_resolved_inherited_concrete_instance_method(self):
        valid = {"target": "method", "owner_kind": "class",
                 "is_static": False, "is_constructor": False,
                 "inherited_concrete": True, "inherited_final": False,
                 "inherited_sealed": False,
                 "override_signature_matches": True,
                 "override_visibility_preserved": True}
        marker = [self.use("Override", "method")]
        self.assertTrue(admit_scoped_declaration(self.spec, marker, valid))
        for key, bad, code in [
            ("owner_kind", "actor", "OVERRIDE_CONTEXT"),
            ("owner_kind", "trait", "OVERRIDE_CONTEXT"),
            ("is_static", True, "OVERRIDE_CONTEXT"),
            ("is_constructor", True, "OVERRIDE_CONTEXT"),
            ("legacy_override", True, "DUPLICATE_ANNOTATION"),
            ("inherited_concrete", False, "OVERRIDE_MISSING_BASE"),
            ("inherited_final", True, "OVERRIDE_FINAL"),
            ("inherited_sealed", True, "OVERRIDE_FINAL"),
            ("override_signature_matches", False, "OVERRIDE_SIGNATURE"),
            ("override_visibility_preserved", False, "OVERRIDE_VISIBILITY"),
        ]:
            with self.subTest(key=key, bad=bad):
                self.rejects(code, lambda k=key, v=bad:
                    admit_scoped_declaration(self.spec, marker, valid | {k: v}))
        for key in ("is_static", "inherited_final", "inherited_sealed",
                    "inherited_concrete", "override_signature_matches",
                    "override_visibility_preserved"):
            with self.subTest(missing=key):
                context = valid.copy()
                context.pop(key)
                with self.assertRaises(AdmissionError):
                    admit_scoped_declaration(self.spec, marker, context)

    def test_scoped_return_annotation_must_match_resolved_return(self):
        valid = {"target": "function", "resolved_return_type": "int"}
        self.assertTrue(admit_scoped_declaration(self.spec, [
            self.use("Ret", "function", ["int"])
        ], valid))
        self.assertTrue(admit_scoped_declaration(self.spec, [
            self.use("Ret", "function", named=[["type", "int"]])
        ], valid))
        self.rejects("RETURN_TYPE_MISMATCH", lambda:
            admit_scoped_declaration(self.spec, [
                self.use("Ret", "function", ["bool"])
            ], valid))
        self.rejects("RETURN_PROOF_MISSING", lambda:
            admit_scoped_declaration(self.spec, [
                self.use("Ret", "function", ["int"])
            ], {"target": "function"}))

    def test_scoped_purity_requires_checked_effects_even_for_methods(self):
        for target in ("method", "function"):
            with self.subTest(target=target):
                pure = [self.use("Pure", target)]
                context = {"target": target, "effect_proof_complete": True,
                           "proven_effects": []}
                self.assertTrue(admit_scoped_declaration(self.spec, pure, context))
                self.rejects("EFFECT_PROOF_MISSING", lambda:
                    admit_scoped_declaration(self.spec, pure, {"target": target}))
                for effect in ("throw", "raise", "panic", "send", "io", "await"):
                    with self.subTest(effect=effect):
                        self.rejects("PURE_EFFECT_VIOLATION", lambda e=effect:
                            admit_scoped_declaration(self.spec, pure,
                                context | {"proven_effects": [e]}))

    def test_scoped_proof_does_not_activate_backend_lowering(self):
        marker = [self.use("Pure", "function")]
        self.assertTrue(admit_scoped_declaration(self.spec, marker,
            {"target": "function", "effect_proof_complete": True, "proven_effects": []}))
        for backend in self.spec["backendStatus"]:
            self.rejects("ANNOTATION_UNLOWERED", lambda b=backend:
                require_executable_lowering(self.spec, marker, b))

    def test_reference_contract_cannot_increase_compiler_budgets(self):
        for key in self.spec["constraints"]["limits"]:
            with self.subTest(key=key):
                altered = copy.deepcopy(self.spec)
                altered["constraints"]["limits"][key] *= 10
                self.rejects("CONTRACT_LIMIT", lambda s=altered: validate_contract(s))
        altered = copy.deepcopy(self.spec)
        altered["constraints"]["limits"]["maxArgumentsPerAnnotation"] = True
        self.rejects("CONTRACT_LIMIT", lambda: validate_contract(altered))

    def test_reference_contract_schema_fields_are_typed(self):
        altered = copy.deepcopy(self.spec)
        altered["registry"][0]["repeatable"] = "false"
        self.rejects("CONTRACT_SCHEMA", lambda: validate_contract(altered))
        altered = copy.deepcopy(self.spec)
        altered["registry"][0]["arguments"][0]["required"] = "yes"
        self.rejects("CONTRACT_SCHEMA", lambda: validate_contract(altered))
        altered = copy.deepcopy(self.spec)
        altered["registry"][0]["arguments"][0]["name"] = "not valid"
        self.rejects("CONTRACT_SCHEMA", lambda: validate_contract(altered))
        altered = copy.deepcopy(self.spec)
        repr_entry = next(e for e in altered["registry"]
                          if e["qualifiedName"] == "atto.core.Repr")
        repr_entry["arguments"][0]["values"].append("native")
        self.rejects("ENUM_DOMAIN", lambda: validate_contract(altered))
        self.rejects("ARGUMENT_SHAPE", lambda: admit_use(self.spec, None))


    def test_typed_failure_effect_annotations_are_callable_only(self):
        for target in ("function", "method"):
            context = {"target": target, "trailing_failure_effects": [],
                       "resolved_error_types": ["Error", "MyError"]}
            for name in ("throws", "raises", "panics"):
                with self.subTest(target=target, annotation=name):
                    use = self.use(name, target, ["MyError"])
                    self.assertTrue(admit_scoped_declaration(self.spec, [use], context))
                    self.rejects("DUPLICATE_FAILURE_EFFECT", lambda u=use, c=context, n=name:
                        admit_scoped_declaration(self.spec, [u],
                            c | {"trailing_failure_effects": [n]}))
                    self.rejects("FAILURE_PROOF_MISSING", lambda u=use:
                        admit_scoped_declaration(self.spec, [u], {"target": target}))
                    self.rejects("FAILURE_ERROR_TYPE", lambda u=use, c=context:
                        admit_scoped_declaration(self.spec, [u],
                            c | {"resolved_error_types": ["Error"]}))
                    self.rejects("DUPLICATE_ANNOTATION", lambda u=use:
                        admit_declaration(self.spec, [u, u]))
        for name in ("throws", "raises", "panics"):
            with self.subTest(class_target=name):
                self.rejects("WRONG_TARGET", lambda n=name:
                    admit_declaration(self.spec, [self.use(n, "class", ["Error"])]))
        self.assertTrue(admit_declaration(self.spec, [
            self.use("throws", "actor_handler", ["Error"])]))
        self.assertTrue(admit_declaration(self.spec, [
            self.use("throws", "function", ["Error"]),
            self.use("raises", "function", ["Error"]),
            self.use("panics", "function", ["Error"])]))

    def test_pure_and_advertised_escaping_failures_conflict(self):
        target = "function"
        uses = [self.use("Pure", target), self.use("throws", target, ["Error"])]
        facts = {"target": target, "effect_proof_complete": True,
                 "proven_effects": [], "trailing_failure_effects": [],
                 "resolved_error_types": ["Error"]}
        self.rejects("PURE_EFFECT_VIOLATION", lambda:
            admit_scoped_declaration(self.spec, uses, facts))
        for backend in self.spec["backendStatus"]:
            self.rejects("ANNOTATION_UNLOWERED", lambda b=backend:
                require_executable_lowering(self.spec, [self.use("throws", target, ["Error"])], b))


    def test_canonical_pascalcase_effect_annotations_accept_variadic_types(self):
        for short in ("Throws", "Raises", "Panics"):
            with self.subTest(short=short):
                use = self.use(short, "function", ["IOError", "ParseError"])
                self.assertEqual(admit_use(self.spec, use)["phase"], "proof")
                self.assertTrue(admit_scoped_declaration(self.spec, [use], {
                    "target": "function", "trailing_failure_effects": [],
                    "resolved_error_types": ["IOError", "ParseError"]}))
                self.rejects("WRONG_TARGET", lambda n=short:
                    admit_declaration(self.spec, [self.use(n, "class")]))
                self.rejects("UNKNOWN_ARGUMENT", lambda n=short:
                    admit_use(self.spec, self.use(n, "function", named=[["error", "IOError"]])))
                self.rejects("DUPLICATE_ARGUMENT", lambda n=short:
                    admit_use(self.spec, self.use(n, "function", ["IOError", "IOError"])))
                self.rejects("ARGUMENT_LIMIT", lambda n=short:
                    admit_use(self.spec, self.use(n, "function", ["IOError"] * 9)))

    def test_empty_pascalcase_effect_sets_need_real_proof(self):
        for short, kind in (("Throws", "throws"), ("Raises", "raises"), ("Panics", "panics")):
            with self.subTest(kind=kind):
                marker = [self.use(short, "function")]
                context = {"target": "function", "resolved_error_types": [],
                           "trailing_failure_effects": [],
                           "proved_failure_effects": {kind: []}}
                self.assertTrue(admit_scoped_declaration(self.spec, marker, context))
                self.rejects("FAILURE_PROOF_MISSING", lambda c=context, u=marker:
                    admit_scoped_declaration(self.spec, u,
                        c | {"proved_failure_effects": {}}))
                self.rejects("FAILURE_PROOF_MISSING", lambda c=context, u=marker, k=kind:
                    admit_scoped_declaration(self.spec, u,
                        c | {"proved_failure_effects": {k: ["Uncaught"]}}))
                self.rejects("DUPLICATE_FAILURE_EFFECT", lambda c=context,u=marker,k=kind:
                    admit_scoped_declaration(self.spec,u,
                        c | {"trailing_failure_effects": [k]}))

    def test_alias_collision_rejected_even_when_spellings_differ(self):
        for upper, lower in (("Throws", "throws"), ("Raises", "raises"), ("Panics", "panics")):
            self.rejects("DUPLICATE_ANNOTATION", lambda a=upper,b=lower:
                admit_declaration(self.spec, [
                    self.use(a, "function", ["Error"]),
                    self.use(b, "function", ["Error"])]))

    def test_pure_function_can_assert_empty_effect_sets(self):
        uses = [self.use("Pure", "function"), self.use("Throws", "function"),
                self.use("Raises", "function")]
        facts = {"target": "function", "effect_proof_complete": True,
                 "proven_effects": [], "resolved_error_types": [],
                 "trailing_failure_effects": [],
                 "proved_failure_effects": {"throws": [], "raises": []}}
        self.assertTrue(admit_scoped_declaration(self.spec, uses, facts))
        self.rejects("PURE_EFFECT_VIOLATION", lambda:
            admit_scoped_declaration(self.spec, uses + [
                self.use("Panics", "function", ["FatalError"])],
                facts | {"resolved_error_types": ["FatalError"]}))

    def test_variadic_schema_cannot_be_malformed(self):
        for field, bad in [("variadic", "yes"), ("required", True),
                           ("type", "positive_int")]:
            with self.subTest(field=field):
                altered = copy.deepcopy(self.spec)
                entry = next(e for e in altered["registry"] if e["qualifiedName"] == "atto.core.Throws")
                entry["arguments"][0][field] = bad
                self.rejects("CONTRACT_SCHEMA", lambda c=altered: validate_contract(c))

    def test_lowercase_legacy_effect_annotation_still_requires_one_type(self):
        self.assertTrue(admit_use(self.spec,
            self.use("throws", "function", ["Error"])))
        self.rejects("MISSING_ARGUMENT", lambda:
            admit_use(self.spec, self.use("throws", "function")))
        self.rejects("EXCESS_POSITIONAL_ARGUMENTS", lambda:
            admit_use(self.spec, self.use("throws", "function", ["Error", "OtherError"])))


if __name__ == "__main__":
    unittest.main()
