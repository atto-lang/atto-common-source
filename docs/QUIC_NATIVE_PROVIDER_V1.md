# QUIC v1 native transport provider selection — review candidate

Status: **engineering proposal**, not implemented/approved or evidence of
guest QUIC support. Complements `contracts/v1/quic-net-v1.json`.
The QUIC engine owns QUIC v1 UDP packets, loss recovery, TLS 1.3 and stream
state. Oreslang owns actor authorization, nonblocking scheduling, quotas,
generation fencing, physical retirement and the source-level
`std/net/quic` interface. The `std/http3` + QPACK source layer remains a
separate language/runtime deliverable.

## Candidate backend split

| Runtime | Preferred candidate | Review notes |
|---|---|---|
| LLVM AOT | Cloudflare quiche via explicit pinned C ABI + statically linked Rust library | QUIC/TLS and stream engine already exist; Oreslang runtime supplies nonblocking UDP, event-loop timers, credit and lifecycle ledger |
| Java/GraalVM 25 Native Image | The same quiche C ABI, reached through build-time registered JDK25 Foreign Function & Memory downcalls | Require explicit linkage/symbol lookup test on every target; do **not** assume a dynamically looked-up symbol survives fully static Native Image |
| .NET 10 Native AOT | Platform `System.Net.Quic` / MsQuic | Continue fail-closed until a policy-issued and actor-generation-bound permit replaces caller supplied endpoints; `QuicConnection.IsSupported` alone is not Oreslang support |

This is a P0 prototype choice, **not** an approved dependency security
exemption. Do not vendor, download, execute, or mirror private source to
another organization until the exact pins, vulnerability baseline, license,
provenance, ABI and destination policy have been reviewed. Avoid writing a
homegrown TLS or QUIC packet-protection implementation.

**Alternative for LLVM:** libngtcp2 + a pinned TLS provider, with nghttp3
used only as a distinct HTTP/3 interoperability oracle. This has a C-native
surface but increases multi-library dependency and TLS backend integration.
We should not maintain two production QUIC engines without compelling AOT or
platform evidence.

Primary public provider documentation:
- https://github.com/cloudflare/quiche/blob/master/README.md
- https://github.com/cloudflare/quiche/blob/master/quiche/include/quiche.h
- https://github.com/ngtcp2/ngtcp2
- https://github.com/ngtcp2/nghttp3
- https://www.graalvm.org/jdk25/reference-manual/native-image/native-code-interoperability/ffm-api/
- https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/quic/quic-overview

## Strict adapter boundary

1. **Admission precedes allocation.** A verified, unforgeable source
   policy decision authorizes the complete DNS set for one physical
   connection. The selected literal IP must be connected without
   hostname re-resolution; the original canonical hostname is sent for
   TLS SNI and validated against the certificate. Reconnect and redirect
   require new policy authorization.
2. **Provider is engine, not actor authority.** Every native QUIC handle
   and stream has an opaque generation-bearing owner token issued by
   CONTROL/runtime, never a guest-provided integer. Native provider
   pointers, UDP sockets and TLS keys must not be guest values.
3. **Bounded reactor.** Receive/send UDP queues, read/write buffers,
   concurrent connections, bidi/uni streams, datagram size, timers,
   handshake deadlines, retry/anti-amplification bytes and wakeups must
   obey explicit compile-time or config-admission limits. No blocking
   actor-carrier I/O; a connection may multiplex streams without raising
   its actor carrier thread cap.
4. **No forged physical retirement.** QUIC cancellation or a logical
   close only revokes new operations. The provider must deliver actual
   stream/connection/socket completion receipts before exactly-once
   native credit reclamation, actor hot-reload quiescence or unloading a
   native library. Actor generation changes fence stale callbacks.
5. **Protocol separation.** The provider handles QUIC v1 frames/crypto;
   source `std/net/quic` exposes asynchronous reads and writes with
   partial progress. The separately compiled `std/http3` layer must
   implement RFC 9114 mapping and RFC 9204 QPACK, with independent
   peer tests. Do not treat HTTP/2/TCP as QUIC.
6. **Deliberate disabled features.** No 0-RTT, no active connection
   migration or address validation bypass, and no QUIC datagrams
   without negotiated support and distinct quotas. Do not enable
   unsafe certificate-validation callbacks.
7. **AOT gate.** Pin and record the quiche source revision, Rust toolchain
   version, license, artifact SHA-256, compiler target triple and
   native symbol set. Prove GraalVM 25 Native Image and LLVM outputs,
   and .NET native publish, at the **exact reviewed Git tree**.

## Phased implementation and acceptance evidence

**P0A — source-free ABI smoke:** audited C header, native library build,
version/ABI symbol probe, independently verified package hash, C++17
compile/link with fake UDP feed and no network egress. Graal FFM downcall
test in Native Image and .NET `System.Net.Quic` build/NativeAOT must run
with actual job steps. No guest support toggle.

**P0B — trusted QUIC interop:** connect and accept a TLS1.3/QUIC v1
session over nonblocking UDP to an independent peer. Reject wrong
cert, missing `h3` ALPN, mixed-address DNS class, hostname mismatch
and cancelled/late handshake. Verify loss recovery, idle timeout and
bounded response. All results include peer identity, exact source SHA,
provider commit, runner ID, test logs and executed steps.

**P0C — actor and source integration:** turn native adapter permissions
into compiler-host intrinsics behind `core/net/quic`; enable
`std/net/quic` only when stream/actor lifetime, backpressure,
generational hot reload and cross-backend conformance tests pass.
HTTP/3 and QPACK remain separate gates, as does negotiated datagram I/O.

## Current blockers

- Java source-local issuer hardening: https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2189
- LLVM bounded native credit/retirement ledger:
  https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1110
- .NET policy-sealed host connection entrypoint remains disabled:
  https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/212
- Carrier authorization and protected-main governance:
  https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/176

**A source-free carrier passing verifier tests is not an authorization to
publish private source.** Before exact-tree cross-org execution,
independent reviewers must approve the carrier's immutable repository
identity, protected main, limited source snapshot and test plan.
A zero-step Actions failure is not a source-level test.
