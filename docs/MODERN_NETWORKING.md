# Modern HTTP and QUIC standard library — native Atto source contract

**Status: first pure-policy source slice only.** The source in `stdlib/net/http_policy.atto` is AttoLang code. It is not a QUIC engine, an HTTP parser, an HTTP/3 client or server, or evidence of AOT execution. The five target repositories `atto-source.{llvm,java,net,rs,wasm}` now have the exact same `.atto` file on candidate branches. Git blob identity is verified independently; guest conformance remains unexecuted.

## Protocol goals

- HTTP/1.1 and HTTP/2 for universal interoperability, HTTP/3 over QUIC v1/v2 (RFC 9114) as preferred when actually available.
- QUIC reliable bidirectional/unidirectional streams, bounded QUIC DATAGRAM (RFC 9221), and HTTP/3 WebSockets (RFC 9220).
- WebTransport/HTTP3 behind a separately gated experimental capability while draft-ietf-webtrans-http3-17 remains a draft in November 2026.
- Streaming request/response bodies, gRPC-compatible HTTP/2 primitives, and optional HTTP/3 transports without implying protocol-specific performance guarantees.

## Atto API, proposed (not implemented)

Canonical source modules planned: `stdlib/net/http.atto`, `stdlib/net/http_client.atto`, `stdlib/net/http_server.atto`, `stdlib/net/quic.atto`, `stdlib/net/websocket.atto`, `stdlib/net/webtransport.atto`, plus the present `stdlib/net/http_policy.atto`.

Public Atto type family: `HttpVersion`, `HttpRequest`, `HttpResponse`, `HttpBodyStream`, `HttpClient`, `HttpServer`, `QuicEndpoint`, `QuicConnection`, `QuicStream`, `QuicDatagram`, `WebTransportSession`, and `NetworkError`. User-facing methods shall use snake_case and native receiver method declarations `mtd`, not host-language classes. The API should be actor-compatible and full-AOT resolvable.

A client should prefer h3 but allow h2/h1 TCP fallback only under an explicit policy. `require_http3` must hard-fail when h3 cannot be negotiated, not silently downgrade. Discovery (Alt-Svc, HTTPS DNS records or explicit endpoint), TLS 1.3, certificate verification, ALPN, HTTP/3 SETTINGS and QUIC transport negotiation belong to the runtime, not to caller-supplied capability booleans.

## Runtime boundary

Atto standard-library implementations must remain `.atto`, compiled as guest Atto source by **independent** LLVM, Java/Graal, .NET, RS and WASM pipelines. Target-specific shims may use established native transport engines and host APIs, but they must expose a small pinned ABI and not implement the public application logic as `.java`, `.cs`, `.rs`, or JavaScript modules in place of `.atto` source. Java/Graal and .NET may use host bindings for TLS, QUIC, sockets and scheduler wakeups; these do not substitute for guest compilation. Native AOT and no-GC claims require executed evidence, not naming.

WASM browser limitations: browsers do not expose arbitrary raw UDP sockets to guest Wasm. Browser client HTTP may be exposed through Fetch or WebTransport where available, with visibility/control differences. Unsupported server/listener and raw-QUIC features must report `UnsupportedCapability` deterministically, not fabricate a working QUIC implementation. Outside browsers, host WASI capabilities must be negotiated and sandboxed.

## Actor, safety and performance invariants

- Async / nonparking I/O. No actor worker thread is blocked by TCP/UDP handshake, DNS or TLS. Explicit synchronous API names end in `_blocking`.
- Every stream, connection, timer and byte buffer has a clear owner/lifetime. No loaned actor arena memory crosses a suspend boundary without a typed pinned lifetime. Close, cancellation and supervisor panic release or invalidate handles.
- Bounded per-stream/connection/messaging queues, QUIC flow-control-aware backpressure, and per-actor byte quotas. Datagram send must check negotiated maximum, effective path size and current actor memory budget.
- 0-RTT defaults **off**. Only explicitly enabled, replay-safe requests can be candidates; preflight does not prove the server accepted early data and does not authorize replaying unsafe operations.
- TLS certificate validation stays on by default, with no silent insecure fallback or cross-tenant connection reuse.
- Data-plane errors become typed Results; unrecoverable actor-local failures notify the supervisor via CONTROL without corrupting unrelated actors.
- Benchmark h1/h2/h3 with the same requests, payloads, concurrency, certificates and machine, reporting p50/p95/p99, CPU, allocations, RSS, throughput and failures. QUIC v2 is not an automatic speed increase.

## Evidence requirements

The first checked-in `.atto` policy slice handles only: h3 attempt gating, explicit fallback preference (codes 30/20/11/0), QUIC datagram preflight and replay-aware 0-RTT candidacy. The compiler-facing .atto fixture under `atto-source.rs/tests/fixtures/pass/` and shared conformance fixture both expect exit 42 but **remain unverified until a compiler runs them**.

Before declaring HTTP/3 supported in any backend: run real guest code using QUIC/TLS runtime bindings, pass protocol interop and adversarial negatives, supply exact backend source/compiler/artifact SHAs and CI links, and separately prove full AOT and allocation/GC metrics.

Protocol references: RFC 9000, 9112, 9113, 9114, 9204, 9220, 9221, 9369; draft-ietf-webtrans-http3-17.
