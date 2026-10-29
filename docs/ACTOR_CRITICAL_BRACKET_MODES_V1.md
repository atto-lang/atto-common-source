# Oreslang sealed actor-state critical modes v1

**Normative source spelling:** `critical[read]` and `critical[write]`.

```oreslang
define actor Worker as
  state {
    counter: int = 0;
  }

  receive(ActorMail<String> mail): void {
    self.handle_state(critical[write] |s| -> {
      s.counter = s.counter + 1;
    });
    self.handle_state(critical[read] |s| -> {
      val current = s.counter;
    });
    self.end();
    return;
  }
end
```

## Grammar and operational contract

```text
state_loan_call := "self" "." "handle_state" "("
                   "critical" "[" ("read" | "write") "]"
                   pipe_lambda ")"
pipe_lambda := "|" binding "|" "->" "{" statements "}"
```

The state-loan operation is a **statement returning void**, not a
value-returning expression, mutable reference, supervisor message or actor
keyword. No implicit flattening or await is permitted. Any other
selector, missing selector in new code, extra argument, non-inline lambda,
mixed/duplicate mode, or attempt to call on a non-actor is invalid.

`critical[read]`:
- Grants a **nonmutable, lexical borrow** over the sealed actor state,
  with a read-only structural projection. No writes, `&mut`, type-cast
  capability escalation or mutable alias extraction.
- Read-mode access to mutable composite values must fail closed until a
  verified immutable snapshot/capability projection exists. Initial Java
  implementation admits scalar fields only.
- Multiple concurrent readers are a **future runtime optimization**, not
  an implication of this first source feature. Actor turn isolation still
  serializes admission unless a scheduler proves reader sharing safe.

`critical[write]`:
- Grants one exclusive lexical mutable loan of the declared state schema.
- All writes must occur inside the loan; no naked `self.phase`, actor-owned
  instance fields alongside `state{}`, or mutable write-through via a
  read-mode projection.
- Mode does **not** bypass the actor turn lease or storage fencing.

Both modes:
- Permit only synchronous, inline, **void** callbacks.
- Deny suspension, `await`, select, channels, runtime cooperation,
  untrusted helper calls, nested lambdas, state-loan return/escape, actor
  send, actor teardown and external side effects while a loan is active.
- Revoke loan views on all normal/error paths (`finally`) before sending
  a result or resuming suspension. Only a detached owned scalar/result
  calculated outside the borrow may leave the critical region.
- Require compiler-proven owner identity and physical runtime checks in
  addition to parser recognition. No string or textual annotation is an
  authorization capability.

## Legacy compatibility and rejected spellings

Compiler backends that previously shipped
`self.handle_state(|s| -> {...})` MAY temporarily parse it as legacy
**exclusive write**, but formatters should migrate it to
`critical[write]`. Deprecate after all backends and fixtures migrate.

`critical read`, `critical write`, `critical-read`,
`critical-write`, and bare `critical` are **not canonical loan call
modes**. Never silently interpret a malformed read selector as write or
downgrade an invalid mode. Other appearances of `critical-read` as a
declaration keyword belong to separate parser productions and must not
accidentally authorize state loans.

## Cross-backend acceptance matrix

The same exact `.ores` source must pass independently on
`oreslang-source.java`, `.llvm`, `.net`, `.wasm` and `.forge`.
Every backend reports a distinct status per fixture, not a Java-only pass
projected as parity:

| Case | Expected |
| --- | --- |
| write increments sealed scalar, read observes | successful guest execution |
| read assigns to field | compile failure |
| read mutable reborrow / mutable alias | compile failure |
| callback `await` / select / channel | compile failure |
| nested closure escape / returning state view | compile failure |
| direct `self.state_field` access | compile failure |
| wrong/missing/duplicate mode, extra callback | compile failure |
| write to immutable field | compile failure |
| actor sends or terminates within loan | compile failure |
| exception during callback | loan revoked; no stale access |
| read of mutable composite | fail closed until immutable projection |
| multiple readers and competing writer | NOT_COVERED until true runtime RW scheduler implemented |

Requirements for an accepted backend: exact source Git blob SHA,
compiler/tree SHA, executed test counts, stdout/stderr and negative
diagnostics from a **real** compiler and guest runtime. `steps:null`
Actions failures and source-text/Node reference tests are
`NOT_EXECUTED`, never an acceptance pass.

## Implementation tracking

- Java/Graal draft PR
  [#2245](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2245)
  contains parser/typechecker/guest-view support with read-only scalar
  runtime view and ten targeted regression tests; it is not yet
  exact-head Maven/Graal executed.
- Step-function coordinator demo draft PR
  [#10](https://github.com/ores-truffle-oreslang/oreslang-step-function-demo/pull/10)
  uses `critical[write]` as a void lexical statement with detached
  response publication after loan retirement; not guest executed.
- Both remain DRAFT while source-org Actions fails before runner steps.
  No cross-org private-source transfer without separate security approval
  under [P0 incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22).

**Future work**: scheduler-enforced concurrent reader admission, writer
fairness, storage-fenced critical transitions, explicit read-only
composite projections and independent five-backend runtime conformance.
