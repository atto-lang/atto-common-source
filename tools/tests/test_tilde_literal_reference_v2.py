"""Executable host-side syntax *reference* tests; do not claim guest support."""
from __future__ import annotations

import copy
import importlib.util
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
MODULE = ROOT / "tools/tilde_literal_reference.py"
FIXTURES = ROOT / "fixtures/tilde-aggregate-match-v2/manifest.json"
SPEC = ROOT / "contracts/v2/ATTO_TILDE_AGGREGATE_LITERALS_AND_STRUCTURAL_MATCH_V2.md"

spec = importlib.util.spec_from_file_location("atto_tilde_literal_reference_v2", MODULE)
assert spec is not None and spec.loader is not None
parser = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = parser
spec.loader.exec_module(parser)

EXPECTED_BACKENDS = ("java", "llvm", "wasm", "forge", "net")
EXPECTED_STATUS = dict.fromkeys(EXPECTED_BACKENDS, "NOT_EXECUTED")


def manifest():
    def no_duplicate_keys(items):
        out = {}
        for key, value in items:
            if key in out:
                raise ValueError(f"duplicate manifest key {key!r}")
            out[key] = value
        return out
    raw = FIXTURES.read_bytes()
    if len(raw) > 1_048_576:
        raise ValueError("too large")
    return json.loads(raw.decode("utf-8"), object_pairs_hook=no_duplicate_keys)


def check_manifest(data):
    if not isinstance(data, dict):
        raise ValueError("manifest must be object")
    if data.get("schema") != "attolang.tilde-aggregate-and-structural-match.extensions.v2":
        raise ValueError("schema mismatch")
    if data.get("status") != "SOURCE_CONTRACT_ONLY" or data.get("certification") != "NOT_CERTIFIED":
        raise ValueError("false certification")
    if data.get("backends") != list(EXPECTED_BACKENDS) or data.get("evidence") != EXPECTED_STATUS:
        raise ValueError("bad or false backend evidence")
    if data.get("spec") != str(SPEC.relative_to(ROOT)) or not SPEC.is_file():
        raise ValueError("missing source contract")
    cases = data.get("syntax_cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("no syntax cases")
    seen = set()
    counts = {"accept": 0, "reject": 0}
    for c in cases:
        if not isinstance(c, dict):
            raise ValueError("bad case")
        if not isinstance(c.get("id"), str) or not c["id"] or c["id"] in seen:
            raise ValueError("duplicate/bad case id")
        seen.add(c["id"])
        expect = c.get("expected")
        if expect not in counts:
            raise ValueError("bad result")
        counts[expect] += 1
        if c["id"][0] != ("p" if expect == "accept" else "n"):
            raise ValueError("id/expect mismatch")
        if c.get("entrypoint") not in ("literal", "match"):
            raise ValueError("unknown parser entrypoint")
        if not isinstance(c.get("input"), str) or not c["input"]:
            raise ValueError("empty source")
        if len(c["input"].encode("utf-8", "surrogatepass")) > 65536:
            raise ValueError("oversized test input")
        if expect == "accept":
            if c.get("expected_kind") != ("match" if c["entrypoint"] == "match" else c.get("expected_kind")):
                raise ValueError("incorrect match kind")
            if c.get("expected_kind") not in ("map", "record", "match"):
                raise ValueError("missing kind")
            if not isinstance(c.get("note"), str) or not c["note"]:
                raise ValueError("missing rationale")
        elif not isinstance(c.get("reason"), str) or not c["reason"]:
            raise ValueError("missing rejection reason")
    if counts != {"accept": 52, "reject": 60} or len(cases) != 112:
        raise ValueError("unexpected syntax corpus size")
    if data.get("syntax_counts") != {**counts, "total": len(cases)}:
        raise ValueError("bad counts")
    semantic = data.get("semantic_targets")
    if not isinstance(semantic, list) or len(semantic) != 22:
        raise ValueError("semantic target count")
    semids = set()
    for c in semantic:
        if not isinstance(c, dict) or not c.get("id") or c["id"] in semids:
            raise ValueError("duplicate semantic target")
        semids.add(c["id"])
        if c.get("status") != "NOT_EXECUTED" or c.get("expected") != "semantic_verification_required":
            raise ValueError("semantic status promotion without execution")
        if not isinstance(c.get("requirement"), str) or not c["requirement"]:
            raise ValueError("missing semantic requirement")
    return counts


class TildeLiteralReferenceV2Tests(unittest.TestCase):
    def test_manifest_source_only_integrity(self):
        counts = check_manifest(manifest())
        self.assertEqual(counts, {"accept": 52, "reject": 60})

    def test_all_112_syntax_target_cases(self):
        data = manifest()
        checked = 0
        for c in data["syntax_cases"]:
            parse = parser.parse_match if c["entrypoint"] == "match" else parser.parse_literal
            with self.subTest(case=c["id"]):
                if c["expected"] == "reject":
                    with self.assertRaises(parser.SyntaxRejection):
                        parse(c["input"])
                else:
                    result = parse(c["input"])
                    self.assertEqual(result["kind"], c["expected_kind"])
                checked += 1
        self.assertEqual(checked, 112)

    def test_reference_literal_kind_and_generic_metadata(self):
        map_value = parser.parse_literal('~map<String,Option<int>>("a" => Some(42))')
        self.assertEqual(map_value["generic_types"], ["String", "Option<int>"])
        self.assertEqual(map_value["kind"], "map")
        empty = parser.parse_literal("~map()")
        self.assertTrue(empty["requires_expected_type"])
        typed = parser.parse_literal("~map<String,int>()")
        self.assertFalse(typed["requires_expected_type"])
        record = parser.parse_literal('~record(x: ~(foo: 42), y: ~map("k" => 4))')
        self.assertEqual(record["nested_count"], 2)

    def test_reference_match_priority_and_structural_metadata(self):
        m = parser.parse_match("match first user over on structural ~(id: 42) -> 42 default -> 0 end")
        self.assertEqual(m["arm_count"], 1)
        self.assertTrue(m["ordered"])
        self.assertEqual(m["structural_arms"], 1)
        self.assertTrue(m["has_default"])
        keyed = parser.parse_match('match flags over on ~map("a" => value) -> value default -> 0 end')
        self.assertEqual(keyed["map_arms"], 1)

    def test_manifest_false_pass_mutations_fail(self):
        ops = [
            lambda x: x.update(status="EXECUTED"),
            lambda x: x.update(certification="CERTIFIED"),
            lambda x: x["evidence"].update(llvm="PASS"),
            lambda x: x["backends"].remove("forge"),
            lambda x: x["syntax_cases"].pop(),
            lambda x: x["syntax_cases"].append(copy.deepcopy(x["syntax_cases"][0])),
            lambda x: x["syntax_counts"].update(reject=59),
            lambda x: x["syntax_cases"][0].update(expected="skipped"),
            lambda x: x["syntax_cases"][0].update(input=""),
            lambda x: x["semantic_targets"][0].update(status="PASS"),
            lambda x: x["semantic_targets"][0].update(expected="implemented"),
        ]
        for index, operation in enumerate(ops):
            with self.subTest(index=index):
                d = manifest()
                operation(d)
                with self.assertRaises(ValueError):
                    check_manifest(d)

    def test_adversarial_lexical_boundaries(self):
        examples = [
            "~()", "~map<String>()", "~record(x: 1, x: 2)",
            "~map('x' => 1, 'x' => 2)", "~record(x: ~())",
            '~map("x" => 1,, "y" => 2)',
            "match x over on default -> 1 end",
            'match x over on ~map(key => 42) -> 42 end',
            'match x over on structural ~map("a" => v) -> v end',
        ]
        for item in examples:
            with self.subTest(source=item):
                parse = parser.parse_match if item.startswith("match ") else parser.parse_literal
                with self.assertRaises(parser.SyntaxRejection):
                    parse(item)


if __name__ == "__main__":
    unittest.main()
