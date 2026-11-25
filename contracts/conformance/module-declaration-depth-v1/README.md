# AttoLang module declaration depth v1

**Proposed shared static-admission contract — no backend is certified by this directory.**

An AttoLang module is a file-level named container. Its direct members may
include classes (including abstract classes), traits, interfaces and named
type aliases, alongside otherwise permitted module members. A module may not
declare a second module, and class, trait and interface bodies do not declare
further named classes, traits, interfaces, types or modules.

These fixtures are parser/typechecker admission cases, **not** runnable guest
executables. A backend must reject invalid inputs with a real compiler error,
not merely fail to launch, time out or skip the case. Positive cases must be
accepted on their own terms; a frontend that does not implement one of the
declaration kinds is **pending**, not passing.

Lexical block-local aggregate/type aliases are a separate language feature;
this contract does not redefine them or require treating them as nested
module-member declarations. Import qualification, visibility, ABI exports and
runtime class construction require separate execution/linker tests.

Run all cases with exact pinned source and compiler revisions. Record each
fixture SHA, admission result, compiler output and stepful CI evidence. Do not
claim all-backend parity until backend adapters consume this corpus and
report authentic observed outcomes.
