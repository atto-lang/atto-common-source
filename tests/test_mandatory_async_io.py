import hashlib, importlib.util, json, pathlib, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("audit_guest_io",ROOT/"scripts/audit_guest_io.py")
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
class MandatoryAsyncIoTests(unittest.TestCase):
 def test_shared_corpus_identity(self):
  raw=(ROOT/"fixtures/mandatory-async-io.json").read_bytes();contract=json.loads((ROOT/"contracts/native-async-io.v1.json").read_text())
  self.assertEqual(hashlib.sha256(raw).hexdigest(),contract["fixtureSha256"])
  self.assertEqual(contract["backends"],["java","net","llvm","forge","wasm"])
  self.assertFalse(contract["downgradeAllowed"]);self.assertFalse(contract["blockingWorkerFallbackAllowed"])
  cases=json.loads(raw)["cases"];self.assertEqual(len(cases),22)
  self.assertEqual(sum(x["expect"]=="accept" for x in cases),2)
 def test_aliases_and_fake_async_are_inventory_candidates(self):
  result=audit.references('val read = fs.read_text_async; return; stdio.println("x");')
  self.assertEqual([x["reference"] for x in result],["fs.read_text_async","stdio.println"])
 def test_comments_and_string_contents_do_not_create_candidates(self):
  self.assertEqual(audit.references('// fs.write_text("x")\n"stdio.println"; /* tcp.read */ return 42;'),[])
 def test_native_tcp_facade_does_not_become_legacy_by_name(self):
  self.assertEqual(audit.references('val f = net.listen_loopback(0,1,1,1);'),[])
