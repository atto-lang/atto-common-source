# AttoLang compile-time class proxies — candidate v1 contract

This contract records one deliberately restricted, full-AOT-compatible semantic
surface: `new Proxy(new Foo(...))` generates a typed `FooProxy` delegation class
and forwards its public synchronous instance methods.

See `manifest.json` for the machine-readable expected semantics, status and
negative fixtures. All backends must reject unimplemented cases explicitly,
without silently invoking JavaScript `Proxy`, runtime reflection or JIT.

The Java/GraalVM reference branch is draft
[PR #2650](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2650).
**No backend has a confirmed passing exact-head compiler-backed guest test for
this feature as of contract creation.** Fixture presence is not execution proof.

## Versioned semantic rules

- Class target is statically named and allocated by exactly one source
  constructor expression; the target is evaluated exactly once.
- The proxy is a **distinct nominal type**. There is no implicit conversion
  `FooProxy -> Foo`. No implicit owned-object copy, cross-actor transport,
  implicit function capture or method-value transport is permitted.
- Generate only publicly visible instance methods in v1; overload identity is
  by explicit value arity. Static methods require a separate class façade.
- Effect, borrow, cancellation, generation, exception, mutable receiver and
  scheduler invariants are never weakened. Unsupported forms fail closed.
- An external call through the wrapper forwards to Foo. Internal `Foo` self-calls
  do not traverse the wrapper; method-entry weaving is a separate feature.
- No runtime method enumeration, reflection, code generation, dynamic dispatch
  tables constructed at runtime, runtime-created subclasses or JS host Proxy.
- Required artifact proof: exact compiler SHA, source and output tree identity,
  nonzero executed build/test steps, guest outputs and negative-test receipts.
  Source-free or host-only tests are not guest/native/AOT parity.

## Hardened admission rules (2026-11-10)

Until imported and qualified nominal type resolution is proven, the generator
MUST reject a synthetic `FooProxy` name that collides with any compilation-unit
declaration or explicitly imported symbol/alias; wildcard imports fail closed.
An imported `Proxy` name must not silently bind to the intrinsic.

Before forwarder emission, require a unique public instance slot by
`(name, explicit value arity)`. A different parameter type does **not**
distinguish equal-arity slots. Preserve original target dispatch inside the
forwarder, never a speculative direct target implementation.

Reject public methods whose annotations would be dropped, and any public
method signature with borrowed, inferred or function-valued types (including
nested generic positions), until type/effect/ownership and generated metadata
are checked. Keep private methods invisible and static methods excluded.

These are **required negative tests**, not evidence that any non-Java backend
has implemented proxy support. An existing target's internal `self.method()`
call is intentionally **not intercepted**. A transparent subtype/overriding
proxy and a method-entry interception mechanism need separate designs.

## Next compiler slices

1. Java: execute the JUnit test under CI and standalone GraalVM Native Image.
2. LLVM / .NET / Wasm / Forge: lower the same synthetic typed class surface
   into ordinary direct/static native calls and deterministic target storage.
3. Separate follow-ons for `new Proxy(existing)`, public static class façade,
   typed `before/after/around/proceed` hooks and cross-module class imports.
4. Introduce actual shared runner automation; do not count manifest expectations
   as executed tests.
