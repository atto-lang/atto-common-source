"""Fail-closed, implementation-independent QUIC admission contract tests."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "v1" / "quic-net-v1.json"

class QuicNetContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_guest_support_not_falsely_advertised(self):
        self.assertEqual(self.c["status"], "design-and-admission-only")
        self.assertIs(self.c["guestSupported"], False)
        self.assertEqual(len(self.c["backends"]), 3)

    def test_quic_is_udp_tls13_not_http2(self):
        p = self.c["protocol"]
        self.assertEqual(p["transport"], "quic-over-udp")
        self.assertEqual(p["tls"], "1.3")
        self.assertTrue({8999, 9000, 9001, 9002}.issubset(set(p["requiredRFCs"])))
        self.assertEqual(p["http3RFCs"], [9114, 9204])
        self.assertEqual(p["http3Alpn"], "h3")
        self.assertTrue(p["http2IsNotQuic"])
        self.assertTrue(p["http2OverQuicForbidden"])

    def test_guest_surface_and_security(self):
        api = self.c["api"]
        self.assertTrue(api["allNetworkOperationsAsynchronous"])
        self.assertTrue(api["requiresNegotiatedDatagrams"])
        self.assertTrue(api["streamReadsAndWritesPermitPartialProgress"])
        self.assertTrue(api["zeroCopyBorrowCannotCrossSuspension"])
        self.assertIn("QuicConnection", api["opaqueTypes"])
        self.assertIn("close", api["calls"])
        sec = self.c["security"]
        for name in ("certChainAndHostnameVerificationRequired", "tls13Required",
                     "insecureCertificateCallbackForbidden", "requirePinnedAuthorizedIpAndCanonicalSni",
                     "enforceDnsSetEgressPolicy", "guestCannotForgeNativeHandle",
                     "noTransparentHttp2Fallback", "sourceActorCannotAccessUdpOrTlsKeys"):
            self.assertIs(sec[name], True, name)
        self.assertEqual(sec["zeroRttDefault"], "disabled")
        self.assertEqual(sec["migrationDefault"], "disabled")

    def test_retirement_and_aot(self):
        own = self.c["ownership"]
        self.assertIs(own["cancellationIsNotPhysicalRetirement"], True)
        self.assertIs(own["actorShutdownMustWaitForVerifiedRetirement"], True)
        self.assertIs(own["noBlockingActorCarrier"], True)
        self.assertEqual(self.c["profile"]["strictAot"], "required")
        self.assertEqual(self.c["profile"]["hardRealtime"],
                         "reject-unbounded-handshake-and-network-io")
        gates = set(self.c["releaseGates"])
        self.assertIn("http3-h3-qpack-interoperability", gates)
        self.assertIn("native-aot-publish", gates)
        self.assertIn("no-plaintext-or-http2-fallback", gates)

if __name__ == "__main__":
    unittest.main()
