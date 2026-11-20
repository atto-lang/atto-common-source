from pathlib import Path
import importlib.util
import json
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('vectors',HERE/'check_atto_core_math_vectors.py')
v=importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)

class VectorTests(unittest.TestCase):
    def setUp(self):
        self.original=HERE.parent/v.REL
        self.doc=json.loads(self.original.read_text(encoding='utf-8'))
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.p=Path(self.tmp.name)/'vectors.json'
        self.write()

    def write(self):
        self.p.write_text(json.dumps(self.doc,sort_keys=True,indent=2)+'\n',encoding='utf-8')

    def denied(self):
        with self.assertRaises(v.Rejected):v.check(self.p,require_pinned_hash=False)

    def test_canonical_pinned(self):
        self.assertGreaterEqual(v.check(self.original),300)

    def test_semantic_reference(self):
        self.assertEqual(v.oracle('clamp',[77,42,41]),42)
        self.assertEqual(v.oracle('clamp',[-1,0,42]),0)
        self.assertEqual(v.oracle('min',[v.I64_MIN,v.I64_MAX]),v.I64_MIN)

    def test_bad_expected_denied(self):
        self.doc['cases'][0]['expected']=999
        self.write();self.denied()

    def test_guest_claim_denied(self):
        self.doc['claim_tier']='NATIVE_GUEST_PASS'
        self.write();self.denied()

    def test_duplicate_id_denied(self):
        self.doc['cases'][1]['id']=self.doc['cases'][0]['id']
        self.write();self.denied()

    def test_out_of_range_denied(self):
        self.doc['cases'][0]['args']=[v.I64_MAX+1,0]
        self.write();self.denied()

    def test_bool_as_i64_denied(self):
        self.doc['cases'][0]['args']=[True,0]
        self.write();self.denied()

    def test_wrong_arity_denied(self):
        self.doc['cases'][0]['args']=[1]
        self.write();self.denied()

    def test_unknown_operation_denied(self):
        self.doc['cases'][0]['op']='reflect'
        self.write();self.denied()

    def test_extra_field_denied(self):
        self.doc['cases'][0]['guest_executed']=True
        self.write();self.denied()

    def test_missing_cases_denied(self):
        self.doc['cases']=self.doc['cases'][:10]
        self.write();self.denied()

    def test_duplicate_json_key_denied(self):
        self.p.write_text('{"schema":"a","schema":"a"}',encoding='utf-8')
        self.denied()

    def test_symlink_denied(self):
        target=self.p.parent/'target.json'
        self.p.rename(target);self.p.symlink_to(target)
        self.denied()

    def test_nul_denied(self):
        self.p.write_bytes(b'\x00')
        self.denied()

    def test_manifest_blob_pin_denied(self):
        self.p.write_bytes(self.p.read_bytes() + b' ')
        with self.assertRaises(v.Rejected):v.check(self.p)

if __name__=='__main__':
    unittest.main(verbosity=2)
