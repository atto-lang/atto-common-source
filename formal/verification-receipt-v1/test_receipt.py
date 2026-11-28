import copy
import json
import unittest
from receipt import AXES, COMPILER_AXES, PROOF_AXES, load, validate


def example(axis='compiler-guest'):
    identity = dict(repository='atto-lang/atto-source.llvm', commit='a'*40, tree='b'*40)
    return dict(schema='atto.verification-receipt.v1', axis=axis, status='PASS', scope='signed-i64 example fixture',
        source=identity, compiler=copy.deepcopy(identity) if axis in COMPILER_AXES else None,
        contract_sha256='1'*64, fixture_sha256='2'*64, artifact_sha256='3'*64, transcript_sha256='4'*64,
        toolchain=['test tool 1'], assumptions=['trusted integer semantics'] if axis in PROOF_AXES else [],
        run=dict(location='synthetic test only', executed_steps=3), counts=dict(passed=4, failed=0, skipped=0))


class Receipt(unittest.TestCase):
    def test_each_axis_independent(self):
        for axis in AXES:
            with self.subTest(axis=axis):
                self.assertEqual(validate(example(axis)), dict(axis=axis,status='PASS',scope='signed-i64 example fixture',authenticated=False))

    def test_invalid_executed_claims(self):
        for path, value in [
            (('axis',),'all'), (('status',),'SUCCESS'), (('scope',),''), (('source','commit'),'main'),
            (('source','tree'),'0'*40), (('compiler',),None), (('artifact_sha256',),None),
            (('fixture_sha256',),'bad'), (('transcript_sha256',),'0'*64), (('toolchain',),[]),
            (('run','executed_steps'),0), (('run','executed_steps'),True), (('counts','passed'),0),
            (('counts','failed'),1), (('counts','skipped'),1), (('counts','passed'),-1),
            (('counts','passed'),1.0), (('counts','passed'),10**9+1), (('scope',),'x\nforged'),
            (('toolchain',),['duplicate','duplicate']), (('status',),'NOT_EXECUTED'),
            (('extra',),'certified'), (('compiler','tree'),'main'),
        ]:
            with self.subTest(path=path,value=value):
                r=example(); obj=r
                for k in path[:-1]: obj=obj[k]
                obj[path[-1]]=value
                with self.assertRaises(ValueError): validate(r)

    def test_proof_and_host_do_not_promote(self):
        for axis in ('model-proof','host-witness'):
            r=example(axis); r['compiler']=example()['compiler']
            with self.assertRaises(ValueError): validate(r)
        for axis in PROOF_AXES:
            r=example(axis); r['assumptions']=[]
            with self.assertRaises(ValueError): validate(r)

    def test_status_paths(self):
        for status in ('NOT_EXECUTED','UNSUPPORTED'):
            r=example(); r.update(status=status,artifact_sha256=None,transcript_sha256=None,run=None,counts=dict(passed=0,failed=0,skipped=0))
            self.assertEqual(validate(r)['status'],status)
            r['counts']['passed']=1
            with self.assertRaises(ValueError): validate(r)
        r=example(); r.update(status='FAIL',counts=dict(passed=2,failed=1,skipped=1))
        self.assertEqual(validate(r)['status'],'FAIL')
        r['counts']['failed']=0
        with self.assertRaises(ValueError): validate(r)

    def test_json_admission(self):
        self.assertEqual(load(json.dumps(example()).encode()),example())
        for raw in (b'{"a":1,"a":2}',b'{"a":NaN}',b' '*262145,b'\xff'):
            with self.assertRaises(ValueError): load(raw)
        for v in (None, [], True, {}):
            with self.assertRaises(ValueError): validate(v)


if __name__ == '__main__': unittest.main(verbosity=2)
