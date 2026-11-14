# Native Atto HTTP/3 protocol-slice implementation

**Status:** native Atto protocol validation and QUIC varint byte decoding implemented; QUIC/TLS/UDP transport and HTTP/3 client/server **not implemented**.

## Source of truth

These exact `.atto` files are present at byte-identical Git blob IDs in the canonical shared-source repo and five compiler target repos:

| Source | Git blob |
|---|---|
| `stdlib/net/http_policy.atto` | `68831fd1022f09ac5a4fd74b29fc34a6dcf9e13a` |
| `stdlib/net/quic_varint.atto` | `838929f85b66a646fb7b018dd0a882e7fe96a5d5` |
| `stdlib/net/http3_frames.atto` | `9762849fcc1e6c307ce291f9fc096df934eae130` |

**Do not substitute `.java`, C#, JavaScript, or Rust code for the public stdlib.** Native transport engines can supply low-level QUIC, UDP, TLS, wakeups and I/O bindings. Actor-facing policy, request lifecycle, frame admission, QPACK limits and request/response semantics belong in `.atto`. The normative proposed host ABI is `contracts/http3-host-abi-v1.json` (not implemented).

## Executed evidence

Private, token-free, exact-SHA Git blob transfer to `athlet-o/athleto-e2e` carries a pinned Rust compiler source slice and fixtures. The Rust frontend emits executable **guest WebAssembly from native .atto** code, and Node instantiates that Wasm with zero host imports.

- Existing policy: 48 exhaustive cases and 15-case smoke, guest exit 42.
- QUIC RFC 9000 varint: 308 test cases, including full 256 possible first bytes, non-minimal encodings, invalid octets, 62-bit maximum and integer boundaries.
- HTTP/3 RFC 9114 frame admission/settings: 406 cases across 64 frame IDs, first SETTINGS, request/push stream constraints, HTTP/2-reserved IDs and bounded payload checks.
- Both new guest modules compile twice to byte-identical Wasm and exit 42 when all checks succeed.
- Rejected source returns `E_UNBOUND` and must not emit an executable.
- Green carrier run: https://github.com/athlet-o/athleto-e2e/actions/runs/43645771501

This is an executed **Rust compiler → Wasm guest pure protocol slice**, not a compiler-backed full network stack or evidence of Java, LLVM, .NET and standalone Wasm backend execution.

## Security properties and missing work

The codec accepts QUIC variable-length integers in 1/2/4/8 octets, including non-minimal but valid encodings; returns `-1` on invalid inputs and uses 0 only as an invalid width. The caller must never mistake a malformed sentinel for a valid frame length or stream ID. It must not read from any host-managed memory without first validating the octet count and lifetime.

The HTTP/3 frame admission functions correctly gate a control stream's first SETTINGS, reject forbidden HTTP/2 frame type IDs and reject incompatible known stream/frame combinations. They admit unknown positive extension frame types only for subsequent bounded skipping; their caller must enforce full payload length, connection status, duplicate SETTINGS IDs, QPACK decoder state, critical stream teardown and HTTP request semantics. These functions do not parse raw frames or implement QPACK yet.

A complete **HTTP/3 client/server loopback is currently BLOCKED by missing actual QUIC/TLS runtime bindings and incomplete independent compiler backends**. Do not claim transport support, Native AOT production readiness, zero-GC, 5-backend behavioral parity or external interoperability.

## Next concrete implementation path

1. Implement typed Atto `HttpClient` and `HttpServer` actors plus source imports/ABI in `.atto` once the required parser/IR/effects are supported. Keep user-facing methods snake_case and receiver methods with `mtd`.
2. Establish a low-level pinned C ABI to a production QUIC/TLS provider (e.g. MsQuic or quiche) on LLVM, Java/Graal, .NET NativeAOT and supported Rust native hosts; no direct unsafe pointer escape into actor code. WASM/browser uses Fetch or browser WebTransport capabilities and fails closed when required guarantees are impossible.
3. Implement HTTP/3 stream/framing and QPACK semantics in native Atto source, backed by bounded stream and mailbox queues, typed cancellation, actor-owned bytes and explicit network permissions.
4. Run a real client/server loopback with TLS 1.3, certificate verification, ALPN `h3`, SETTINGS exchange, GET/POST streaming and payload equality; test malformed frames, FIN races, UDP blocked, 0-RTT replay, cancellation, actor kill and memory/high-water marks.
5. Prove native-machine AOT and cross-backend guest behavior independently on pinned exact trees. Track support as PASS/FAIL/UNSUPPORTED/NOT_EXECUTED per backend.

References: RFC 9000 (QUIC varints), RFC 9114 (HTTP/3), RFC 9204 (QPACK), RFC 9221 (QUIC DATAGRAM), RFC 9369 (QUIC v2).
