"""Reference-only Symbol keyed-container model.

These tests exercise the normative tagged-key and admission rules, NOT guest
Java/GraalVM or LLVM compiler execution. Backend parity is tracked separately.
"""
import unittest

from test_symbol_contract_vectors import canonical_identity, canonical_key


def text_key(name):
    return ("string", name)


def symbol_key(name, kind="process"):
    return ("symbol", canonical_identity({"kind": kind, "name": name}))


def symbol_property_lookup(fields, name, *, lexical_private_access=False, visibility=None):
    key = symbol_key(name)
    if visibility is not None and visibility.get(key, "private") == "private":
        if not lexical_private_access:
            raise PermissionError("private Symbol property")
    return fields[key]


def map_to_wire_object(mapping):
    """Legacy string-object encodings may never invent Symbol-to-String keys."""
    if any(key[0] != "string" for key in mapping):
        raise ValueError("Symbol keys require an explicit tagged wire encoding")
    return {key[1]: value for key, value in mapping.items()}


def audit_untrusted_keys(value, allowed_names):
    """Small model of recursive untrusted map-key AND value checking."""
    if isinstance(value, tuple) and len(value) == 2 and value[0] == "symbol":
        kind, name = value[1]
        if kind != "process" or name not in allowed_names:
            raise PermissionError("unexported Symbol")
    elif isinstance(value, dict):
        for key, item in value.items():
            audit_untrusted_keys(key, allowed_names)
            audit_untrusted_keys(item, allowed_names)
    elif isinstance(value, list):
        for item in value:
            audit_untrusted_keys(item, allowed_names)


class SymbolKeyNamespaceModelTest(unittest.TestCase):
    def test_string_symbol_and_stable_keys_do_not_alias(self):
        mixed = {
            text_key("status"): 1,
            symbol_key("status"): 2,
            symbol_key("550e8400-e29b-41d4-a716-446655440000", "stable"): 3,
            symbol_key("550e8400-e29b-41d4-a716-446655440000"): 4,
        }
        self.assertEqual(len(mixed), 4)
        self.assertEqual(mixed[text_key("status")], 1)
        self.assertEqual(mixed[symbol_key("status")], 2)
        self.assertEqual(mixed[symbol_key("550e8400-e29b-41d4-a716-446655440000", "stable")], 3)

    def test_symbol_duplicate_detection_uses_normalized_identity(self):
        key1 = symbol_key("cafe\u0301")
        key2 = symbol_key("café")
        self.assertEqual(key1, key2)
        self.assertEqual(len({key1: 1, key2: 2}), 1)
        self.assertNotEqual(key1, text_key("café"))

    def test_struct_closed_shape_keeps_both_key_namespaces(self):
        record = {text_key("status"): 1, symbol_key("status"): 2}
        self.assertEqual(record[text_key("status")], 1)
        self.assertEqual(record[symbol_key("status")], 2)
        self.assertNotIn(symbol_key("missing"), record)
        self.assertEqual(canonical_key("cafe\u0301"), "café")

    def test_class_symbol_field_visibility_is_not_dot_dispatch(self):
        fields = {text_key("secret"): 1, symbol_key("secret"): 2}
        visibility = {symbol_key("secret"): "private"}
        self.assertEqual(fields[text_key("secret")], 1)
        with self.assertRaises(PermissionError):
            symbol_property_lookup(fields, "secret", visibility=visibility)
        self.assertEqual(symbol_property_lookup(
            fields, "secret", visibility=visibility, lexical_private_access=True), 2)

    def test_symbol_keys_cannot_be_smuggled_into_legacy_json_member_names(self):
        self.assertEqual(map_to_wire_object({text_key("foo"): 1}), {"foo": 1})
        with self.assertRaises(ValueError):
            map_to_wire_object({text_key("foo"): 1, symbol_key("foo"): 2})
        # A string that happens to begin with '#' stays a string.
        self.assertEqual(map_to_wire_object({text_key("#foo"): 7}), {"#foo": 7})

    def test_nested_untrusted_key_gate_checks_keys_and_values(self):
        allowed = {"ready", "error"}
        audit_untrusted_keys([{symbol_key("ready"): "ok"}], allowed)
        with self.assertRaises(PermissionError):
            audit_untrusted_keys([{symbol_key("userland/private"): 1}], allowed)
        with self.assertRaises(PermissionError):
            audit_untrusted_keys([{text_key("tag"): symbol_key("userland/private")}], allowed)
        # Guessing a textual name is never admission of a Symbol identity.
        audit_untrusted_keys([{text_key("#userland/private"): 1}], allowed)


if __name__ == "__main__":
    unittest.main()
