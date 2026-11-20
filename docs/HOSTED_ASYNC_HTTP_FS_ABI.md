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
