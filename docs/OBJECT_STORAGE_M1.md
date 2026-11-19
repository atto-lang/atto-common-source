# Atto ObjectStorage M1: typed, compiled Point/Particle subset

**Status:** opt-in, closed-world same-source compiler experiment. It is **not**
the canonical general Atto frontend, ABI v5, cross-actor transfer or general
struct/class support. See atto-spec #91 and this repository's Ref32 origin
provenance proposal #26.

## First actual compiled .atto source

```atto
define struct Point as
  int x;
  int y;
end

define class Particle as
  final Point position;
  int velocity;
end

pub fnc main(): int {
  let Point point = Point(x=10, y=20);
  let Particle particle = new Particle(position=point, velocity=3);
  return particle.position.x + particle.velocity;
}
```

The single source file is parsed and type-admitted by one exact Git-blob
`tools/atto_object_storage_m1.py` vendored unchanged in Java and LLVM sources.
The compiler rejects all other struct/class shapes, arbitrary statements,
cross-actor operations, suspension, copies, FFI, identity casts and unsupported
operators. It requires the exact input SHA-256 and forbids existing output
files. Invalid input must produce no IR, Java source or executable.

### Typed storage/ownership plan (compiler-internal, not public syntax)

| Place | Logical category | Layout | Owner | Lifetime/drop |
| --- | --- | --- | --- | --- |
| `point` | nominal `Point` value struct | two unboxed i64, 16-byte payload | lexical frame | no separate heap object |
| `particle.position` | inline `Point` value | offsets 0 and 8 in parent payload | one actor-local `Particle` | erased when owning Particle is released |
| `particle.velocity` | scalar i64 field | byte offset 16 | same Particle owner | same |
| `particle` | owned identity class | 24-byte field payload, logical type ID 101 | one trusted actor domain `main.actor.local` | checked Ref32 release, then quiescent actor heap close |

Only one `Particle` is admitted; there is no sharing, borrowing, retaining or
suspending in this M1 subset. The frontend's fixed statically checked plan
never allows class refs as source integers, cross-actor messages or return
values. The independent 32-bit guest token is only valid within the single
admitted actor context; the LLVM bridge's trusted host wrapper cannot be
constructed by the guest. No untrusted arbitrary native guest code is admitted.

### Ownership-operator expansion gate (M1 does not implement it)

The single-Particle M1 plan has one owned class and no general class calls.
Future typed IR must make these effects independently visible:

- `read(particle)` and `read(borrow! particle)` issue the same temporary
  readonly loan when a nonprimitive bare formal is in scope; the source owner
  remains valid and cannot be implicitly transferred
- `write(mut particle)` and `write(borrow! mut particle)` require exclusive
  mutable authority and must reject concurrent readers
- `take! particle` invalidates the source owner; `copy!! particle`
  requires fresh independent mutable storage; `copy! particle` is shallow
  only when every retained child alias is legal
- `share!` requires frozen or guarded storage; `pin! take!` cannot cross
  actor allocator domains without a stable-pointee handoff proof; `drop!`
  must not run while any loan is live

None of those examples is an admitted M1 source feature. Do not create
success-shaped Java/LLVM output for unsupported forms; add isolated positive
and no-artifact negative guest tests before promoting a new profile.

### Native code generation

- **Java:** compiler emits `AttoObjectStorageM1.java`; primitive Point
  scalars are Java `long` locals, Particle uses the already hardened
  `ActorRef32Arena` FFM backing. This prototype still allocates a Java
  `TrustedRef` host wrapper per object. JDK25 JVM and GraalVM Native Image
  compile actual generated source, not a host-only fixture.
- **LLVM:** the same plan emits real LLVM IR that calls a linked C++ trusted
  `ObjectStorageM1GuestBridge`. That bridge calls the already hardened
  `ActorRef32Heap`; it does not expose a raw native pointer to guest IR.
  The process itself is not a malicious tenant sandbox. For an independent
  actor identity or another allocation domain, this bridge must be replaced.

Both versions use checked signed i64 arithmetic, the same literal value
initialization rules, the same payload field ordering and the same stdout
result/scope markers. A value outside the bounded native process-exit range
0..255 is unsupported by M1, not silently truncated.

### Conformance and promotion boundary

The shared exact-blob `tests/test_object_storage_m1.py` runs two positive
compiled programs and rejects ten invalid programs before emitting artifacts,
plus rejects a wrong source SHA. This M1 test does **not** promote the 30-case
storage and 12-case provenance registries from TARGET_ONLY_NOT_EXECUTED: those
require general frontend HIR/MIR, actor lifetime/suspension verification and
full backend guest parity. Those tests are explicitly outstanding.

Next integration: the shared canonical `StorageKind`, `Place`,
`OwnerDomain`, `Loan`, `DropPlan`, and `LayoutPlan` must be emitted and
consumed by the normal compiler HIR/MIR in both backends. Eliminate
per-object Java host wrappers, support multiple class identities and
lifetimes, then actor transfer with independent memory and negative
borrow-checker tests. Do not merge a standalone M1 into the canonical
production backend without those gates.
