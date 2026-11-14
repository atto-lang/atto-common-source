# Global symbols and actor-isolated memory — AttoLang v1 contract

This document is a **cross-backend target**, not a claim that every Atto compiler implements `Symbol` yet. Conformance vectors are in [`contracts/global-symbol-identity-v1.json`](../contracts/global-symbol-identity-v1.json).

## Source model

```atto
use namespace app.events;

define pub symbol #ready;
define pub symbol #terminated;

// Supervisor and workers import the *same declaration*, not a matching string.
// A bare #ready without a public/core declaration is local to its isolate.
```

The spelling `#ready` is a Symbol, distinct from the string `"#ready"`.
`#with spaces` is allowed. Equality is **identity**, not the implementation's
pointer address or an unverified hash. The compiler resolves `define pub symbol`
and qualified imports; two unrelated packages declaring `#ready` remain distinct.
Names are UTF-8 exact (case-sensitive, without implicit Unicode normalization).

* **Core or explicitly public user symbols:** process/tenant-global. The
  supervisor and every actor receive the same canonical, immutable identity.
* **Bare/private user symbols:** interned within an isolate, not implicitly
  shared with siblings or the supervisor. A local handle is not a valid
  cross-actor message; the transport must reject it.
* **A symbol is not a capability:** possessing `#shutdown` never grants
  permission to stop an actor or access a supervisor channel. Access control
  is checked independently by the compiler/runtime.

## Runtime and AOT requirements

The **host owns the table**, outside every actor-owned arena. Each entry is
fully initialized before publication and remains immutable. A `Symbol` is a
small, trivially copyable handle (registry/tenant identity + index). Native
hosts may keep interned UTF-8 data in read-only, process-shared memory; the
compiler embeds a sorted descriptor table of statically declared core/public
symbols into the AOT image and links these entries before spawning actors.
No actor ever receives a pointer into another actor's arena.

Native threads can read the common pool concurrently. Global registration is
linearizable: after two threads request the same qualified symbol, only one
identity exists. Publication uses a synchronized write path, or an equivalent
atomic release/acquire protocol; a hash is only an index, never the definition
of identity. IDs are not recycled during a tenant's lifetime, including hot
reloads or actor restarts.

In Wasm, each guest instance owns independent linear memory. A
`SharedArrayBuffer` is **not required** for symbol equality: a supervisor/host
registry owns interned text and passes validated, structured-clone-safe IDs
to actor Workers. A JS `Symbol` object cannot be sent via `postMessage`.
The guest symbol ABI (and compiler lowering for `#` expressions) remains
separate implementation work.

## Bounds, lifecycle and trust

The reference limits are 16,384 symbols, 1 MiB cumulative UTF-8 key spelling,
and 4 KiB per fully qualified key per tenant. Limits are checked *before*
publishing a new identity; rejected allocations cannot corrupt existing IDs.
Dynamic registration should be controlled by the supervisor, with per-actor
quotas as needed. Native allocators must use fallible allocation or
preallocated tables when a process-abort on OOM would violate actor isolation.
The reference name-byte limit alone does **not** bound the registry's hash
buckets, object headers, locks, or allocator overhead.

A registry lives at least as long as any local actor/supervisor references.
Unloading a module cannot recycle a symbol that a living actor may hold.
Tenant restarts create a fresh registry identity; foreign and stale handles
must fail validation. When passing symbols **across processes**, encode
qualified symbol declarations and re-intern at the destination; do not equate
two unrelated runtimes' numeric IDs.

## Minimum conformance gates

1. A supervisor and two actors importing one public declaration compare equal.
2. Two actor-local `#ready` literals compare unequal; repeated references
   inside the same isolate compare equal.
3. Different namespaces, capitalization, Unicode sequences, and String values
   do not alias.
4. Forged, stale, cross-tenant, oversized, and private cross-actor handles fail
   closed, without crash or identity corruption.
5. Concurrent registration produces one identity, including under AOT/JIT
   tier changes and module hot reload.
6. The implementation preserves private actor heaps, never exposes an actor
   pointer and never mistakes symbol identity for authorization.

**Status:** This contract is executable as test vectors today. End-to-end
`.atto` compilation, typed actor messages containing `Symbol`, native AOT
lowering, and multi-backend runs are separate release gates.
