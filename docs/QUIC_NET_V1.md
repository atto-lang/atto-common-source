# QUIC transport and HTTP/3 are separate native Oreslang capabilities

Status: **design and admission contract**, not evidence that any backend exposes functional guest QUIC. The corresponding `contracts/v1/quic-net-v1.json` sets `guestSupported: false` until each backend passes exact-head interop, AOT and ownership gates.

## Required layered design

- **core/net/quic**: sealed, generation-fenced handles, bounded UDP/send/receive and TLS 1.3 backend operations. Must never expose native FDs, TLS keys, provider types, raw pointers or unverified admission to guest source.
- **std/net/quic**: Oreslang-source API for listen/connect, bidi/uni streams, partial async read/write, flow control, stream reset/stop-sending, cancellation, deadlines, verified close and optional negotiated DATAGRAM.
- **std/http3**: HTTP/3 frames, QPACK (RFC 9204), headers/body/trailers over QUIC streams, ALPN `h3`, bounded parser and application-facing request/response actors. HTTP/2 continues separately over TLS/TCP. HTTP/3 is **not** HTTP/2 over UDP, and QUIC can be used without HTTP.
- QUIC v1 (RFCs 8999/9000/9001/9002) is the minimum. Version 2 (RFC 9369) and DATAGRAM (RFC 9221) are negotiated optional capabilities, never simulated on TCP.

## Native adapters

| Backend | Host primitive direction | Claim allowed now |
|---|---|---|
| Java/GraalVM | Bounded nonblocking UDP + audited TLS 1.3 QUIC engine with Native Image evidence; JDK `HttpClient.Version.HTTP_2` cannot provide QUIC. | **No** guest QUIC until engine, AOT, interop and ownership tests exist. |
| LLVM native | AOT native QUIC/TLS engine behind C ABI, nonblocking UDP epoll/kqueue/IOCP as applicable, explicit lifecycle/loan receipts; prefer proven engine over a bespoke unreviewed TLS stack. | **No** guest QUIC until engine, linker, interop and ownership tests exist. |
| .NET Native AOT | `System.Net.Quic` backed by MsQuic, pinned `IPEndPoint`, TLS 1.3 and `SslClientAuthenticationOptions.TargetHost`; detect support at runtime; require native-AOT publish and availability on target RID. | Host primitive alone is **not** guest stdlib support. |

A provider is allowed to fail closed with an explicit unsupported error; it may **not** silently downgrade requested QUIC/HTTP3 to HTTP/2 or HTTP/1.1. Transparent fallback from an HTTP client requires a distinct caller-selected policy and must never be represented as QUIC.

## Security and actor invariants

Resolve/authorize the *complete* DNS answer set before opening a UDP connection; connect only to an authorized pinned IP. Authenticate the original canonical hostname by certificate and SNI, independently of that IP. Apply reauthorization on redirects, new UDP paths/migration and each new physical connection. Disable 0-RTT by default because replay protection must be proven at application level. Disable path migration by default until rebinding is evaluated against destination and capability policy. QUIC transport must have separate connection/stream/payload/queue credits, anti-amplification, fair actor dispatch, per-tenant quotas, and a physical-retirement receipt that cannot be forged by timeout/cancellation. Hard-real-time call graphs must reject unbounded handshake/OS network effects.

## Acceptance matrix before claiming support

1. Both client and server connect using ALPN `h3` (for HTTP/3), verified chain/hostname/SNI, IPv4/IPv6, and UDP-only ingress/egress. Negative: invalid cert, wrong hostname, denied address class, blocked UDP.
2. Multiplex two or more independent bidirectional streams; isolate loss/stream reset/cancel. Uni streams and partial read/write/FIN semantics. Bound flow-control memory and enforce stream limits.
3. HTTP/3 conformance: QPACK field limits, malicious compression/header cases, cancellation, status, trailers, CONNECT only when intentionally implemented, and request smuggling resistance.
4. DATAGRAM only when negotiated; reject oversize, expired and unauthorized datagrams, no delivery/reliability claim. 0-RTT rejected until explicit replay tests.
5. Run GraalVM native-image, LLVM AOT and .NET Native AOT build and local interop against an **independent** QUIC implementation, repeat under load, deadline expiry, actor shutdown, hot reload and cancellation. Exact PR-head sources, commit/tree/blob IDs and complete runner-step receipts required for an affirmative parity claim.

Backends may land native host plumbing incrementally, but do not expose `std/net/quic` publicly until the corresponding guest source integration and conformance gates are green.
