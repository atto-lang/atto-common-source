# Hosted Atto HTTP/FS adapter design (not executable yet)

This is a backend-neutral implementation contract for the **native Atto** `std.http` and `std.fs` modules, not a host-language public replacement. Language-level types and security semantics are defined in [atto-spec](https://github.com/atto-lang/atto-spec/blob/main/language/hosted-async-http-fs-v1.md) (the proposed change lives in a draft PR until merged).

## Guest-to-host split

```text
Atto application (.atto) --> std.http / std.fs (.atto)
                                      |
                   Atto scheduler/owned Future continuation
                                      |
                          typed, bounded host I/O ABI
                            /                  \
            socket + DNS + TLS broker      rooted FS broker
                  |                               |
         host network completion          host file completion
```

The `await` boundary must resume the same tenant/actor incarnation at most once, not pin an actor carrier. Native async I/O, or an explicitly bounded worker only for file I/O where no kernel completion interface exists, lives on the host side. HTTP protocol composition, response body ownership, UTF-8 conversion, redirects, ordinary Error mapping, timeout policy and full-body write loop should live in Atto source when the compiler can express them. Keep source file bytes identical across compilers where the same module implementation is used.

**Do not add an extern name until its typed ABI, ownership and memory layout are agreed**, and do not ship `http.get` as a host-only mock. Every adapter must validate length/offset arithmetic, actor ticket generation, capability version, tenant resource scope and cancellation races; no raw FD, path, JS object, Java object or native pointer may be returned to guest code.

### Wire operations proposed for review

| Primitive | Host obligation | Scope / identity |
| --- | --- | --- |
| `io.net.open` | Denied-before-DNS, approved scheme/host/port/IP, validated TLS; bounded connection | tenant + request ticket |
| `io.net.read` / `io.net.write` | Ordered bounded bytes, partial I/O, EOF, no hidden retry | owned socket ticket |
| `io.fs.open_rooted` | Descriptor-relative, symlink-escape-safe open and regular-file policy | tenant root + READ/WRITE flag |
| `io.fs.read` / `io.fs.write` | Bounded byte buffers, partial operation progress | owned file ticket |
| `io.close` / `io.cancel` | Affine handle cleanup; exactly-once completion | ticket + actor generation |

This is **not** a promise that all five primitives have landed in any backend. Platform bindings can use narrower OS interfaces if public semantics are equivalent. Browser targets must scope `fs` to an explicit virtual/mounted filesystem; embedded/HDL targets may explicitly reject hosted I/O. Tenant authority must never be escalated through the stdlib facade.

### Current overlap and integration obligations

* `atto-common-source#14` and existing `stdlib/net/*.atto` are **pure** HTTP/3/QUIC codecs/policy, not an HTTP client.
* `atto-common-source#23` and `atto-spec#42` enforce the freestanding/alloc/hosted layering; new modules must be inventoried and permitted by that layer gate. No freestanding core import may gain hosted networking/filesystem dependencies.
* `atto-source.rs#186` owns existing async/await draft integration and `#386` owns typed browser HTTP host tickets; integrate there rather than create an overlapping emitter.
* Legacy Java `oreslang-source.java#221/#584/#2114/#2126/#2055/#3118` contain related work. Assess migration rights and dependencies before porting; source-private cross-org mirroring is not implicitly authorized.

## Release requirement

Only add actual `stdlib/std/http.atto` / `stdlib/std/fs.atto` modules once they contain working Atto guest code and the typed host ABI is available. Never add fake `await` functions that return a dummy body or unconditionally succeed. Record `NOT_EXECUTED` until a backend compiles and runs the conformance fixture in a real guest with nonzero executed cases.

## Linux Offset32 host bridge prototype (Atto LLVM draft #62)

The experimental `atto-source.llvm#62` Linux C implementation adds a
descriptor-relative, scoped filesystem **host** broker. Its next layer,
`atto_fs_guest_read/write`, accepts a trusted host-owned frame and only
`uint32` guest offsets/lengths for path and payload data. It checks
`offset <= cage_size` and `length <= cage_size - offset` before accessing
memory, snapshots guest input, returns no host file descriptor, and leaves
guest output bytes unchanged on denial. The broker serializes admission,
read/write completion and host-controlled generation revocation.

This is a **C host-only test using an artificial cage**, not a compiled Atto
`.atto` guest, complete runtime capability seal, or finalized ABI.
`contracts/std-fs-offset32-host-bridge-candidate-v1.json` is the
machine-readable review/acceptance companion. The C prototype currently
rejects non-ASCII paths, performs synchronous I/O on the calling host thread,
and accepts a host-provided actor identity which the compiler/runtime does
not yet authenticate. Do not call it from a scheduler carrier or expose
`atto_fs_trusted_guest_frame` to guest code.

Before wiring `std.fs`, decide a **new, versioned guest host-call ABI**;
do not mutate existing LLVM TenantVmGuestAbi v4 in place. In each real guest
turn, the scheduler must derive tenant/actor incarnation and capability from
private host state. It must never accept a forged ID or host pointer from
guest-provided offsets. All privileged I/O must intersect the independently
verified artifact ceiling, explicit launch request, host/OS and TenantVM
ceilings, actor/delegated capabilities and explicit denies. A hostile native
actor with arbitrary syscalls is not sandboxed by this cooperative library.

**Integration acceptance:** compile a canonical `.atto` source importing
`std.fs`, execute authorized read/write through the broker, verify bytes,
then run denied-read/write, stale-ticket and path-swap cases against the
compiled guest. Record exact code SHAs, signed launch policy evidence, actual
side effects and stepful CI receipts. Until then all guest backend states
remain `NOT_EXECUTED`.


## Actor-region confinement and six-layer authorization (LLVM host-only proof)

The initial Linux bridge bound guest offsets only against the TenantVM cage,
which is insufficient when multiple actors share that cage. LLVM draft #62
now also bounds every guest path, input and output offset against the
**current actor's host-authenticated region**. It does not accept guest
pointers or a guest-supplied actor-region selection.

A host read originally copied staging bytes into guest memory **after**
releasing the broker's generation mutex. The tightened path commits the
staged read directly to an already validated actor memory span **inside**
that mutex, serialized with broker revocation. A concurrent host-side
regression verifies that no late read completion changes guest memory
after revoke returns.

The candidate guest bridge now refuses the old one-layer policy
constructor. The host prototype accepts **six separately snapshotted
ceilings**: host/OS, verified artifact, explicit runtime request, TenantVM,
actor and delegation. Every layer must explicitly grant the operation,
and a matching deny in any layer rejects it. A 24-case matrix tests
each layer's missing read/write grant and explicit read/write deny.
The C constructor cannot authenticate an artifact signature; the
trusted compiler/loader must independently verify artifact identity and
the permission descriptor before constructing this snapshot.
Unverified, absent or forged descriptor bytes are **NOT** authorization.

Linux GCC and Clang, each at O1/O2 with AddressSanitizer and
UndefinedBehaviorSanitizer, passed the two host regression executables
(eight successful local host runs) against the exact committed source
Git blobs. **There is still no compiled .atto guest, scheduler-linked
async host call, sealed native instruction/syscall boundary or accepted
source-owned GitHub Actions run.** Keep all guest execution evidence
NOT_EXECUTED; do not promote host observations to compiler parity.
