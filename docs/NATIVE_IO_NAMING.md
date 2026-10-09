# Native Oreslang I/O naming and execution contract

**Status:** normative language/API decision; backend enforcement is pending. This document does **not** claim that an I/O effect checker or the full native I/O library currently exists.

## Rule

Every **source-visible, synchronously blocking I/O operation** must have an identifier ending in `_blocking`. Async I/O operations **may** end in `_async`, but that suffix is **not required**. This is an API contract, not a new operator, parser keyword, or declaration syntax.

| Kind | Rule | Examples |
| --- | --- | --- |
| Synchronously blocking I/O | `_blocking` suffix required | `fs.read_text_blocking(path)`, `fs.list_dir_blocking(path)`, `http.get_text_blocking(url)`, `stdio.println_blocking(value)` |
| Async I/O | `_async` suffix optional | `await fs.read_text_async(path)`; alternatively an explicitly async API without that suffix |
| Pure/local computation | No I/O suffix required | `calculate_hash(data)`, `parse_header(data)` |

A blocking I/O operation may wait on disk, filesystem metadata, terminal/stdin/stdout, socket, DNS, networking, or another external I/O resource. This includes operations that are usually fast but *can* synchronously block, such as filesystem `exists` or directory enumeration. The relevant property is **whether the caller's execution carrier can be blocked**, not the expected duration.

The name alone is not proof of a safe implementation. A function named `*_async` is not asynchronous merely because of the suffix; it must expose an async/future execution contract and must not block the actor carrier while performing I/O. Conversely, `*_blocking` is a warning and an API requirement, not permission to circumvent capability checks.

The rule applies to exported Oreslang standard-library/native I/O functions, module functions, object methods and user-defined I/O wrappers that directly expose a blocking I/O operation. It does **not** rename host C/C++/Rust functions, ordinary compute functions, or every higher-level workflow routine that happens to *call* an I/O function; language entrypoints such as `main` keep their specified names.

## Examples

```ores
// Synchronous call: the operation can block the executing thread.
val String text = fs.read_text_blocking(path);

// Async call: the actor can suspend and let its carrier do other work.
val String text = await fs.read_text_async(path);

// Async names may omit the suffix only when the async signature and behavior
// are explicit and unambiguous; e.g. a future stdlib contract.
val String text = await fs.read_text(path); // only if declared async

val int sum = add(1, 2); // ordinary computation, no suffix
```

The examples describe the **target** API, not a claim that all names above are accepted by today's compiler/runtime.

## Semantic requirements

1. **Classify by actual execution behavior.** The native built-in/FFI registry must record I/O kind (`io` versus non-I/O) and whether it can synchronously block the caller. A name-only regex over arbitrary functions is not sufficient.
2. **Reject missing suffixes.** Whenever a native I/O import, builtin or generated binding is resolved, an entry marked blocking I/O without `_blocking` must produce a stable compiler/binding diagnostic. The check must also cover methods and aliases. Do not infer the effect solely from the suffix.
3. **Async is semantically enforced.** An async I/O entry must have the correct future/awaitable contract and submit without blocking the actor carrier; `_async` is merely conventional. Reject/flag a falsely annotated async binding.
4. **Isolation and permissions remain in force.** Both variants require the same relevant capability authorization. Async cancellation/completion and memory ownership need separate validation. Neither spelling grants privileges.
5. **Uniform source contract across backends.** LLVM AOT, Java/Graal JIT, and hybrid execution must expose consistent compliant source names when the relevant capability is implemented. An unsupported capability still fails closed.

## Migration and compatibility

The Java/Graal runtime currently documents bare synchronous names (including `fs.list_dir`, `fs.is_dir`, `fs.is_symlink`, `fs.write_text_atomic`, and `stdio.println`). They are **existing implementation behavior, not compliant canonical names**. The LLVM compiler currently lacks general filesystem/network stdlib I/O.

- Add canonical `*_blocking` declarations to builtins and generated bindings, and update documentation, compiler fixtures and downstream code.
- Migrate uses in CLI/code generators and validate each affected code path with real execution tests before removing bare aliases.
- Do not silently reclassify the old blocking calls as async. If a temporary legacy mode is necessary for compatibility, gate it explicitly and emit a migration diagnostic; do not advertise legacy names as compliant native APIs.
- Version/pin API contracts so a released toolchain and its generated sources agree on names. Roll back the canonical-name switch via a versioned compatibility gate rather than invisible aliasing.
- Before production enforcement, add positive and negative regression cases (below) to each backend supporting I/O. Reconcile actual Java/Graal and LLVM compiler support separately.

## Acceptance tests

| Scenario | Expected |
| --- | --- |
| Registered blocking FS/HTTP/TCP/stdio I/O API ending in `_blocking` | Admitted, subject to capability grants |
| Registered blocking I/O API called or exported without `_blocking` | Rejected with an explicit blocking-I/O naming diagnostic |
| Blocking method or alias hides a bare synchronous I/O entry | Rejected; aliases cannot bypass the check |
| Registered async I/O API named `*_async` | Admitted when its async execution and future contract are valid |
| Registered async I/O API without `_async` | Admitted when declared and implemented as async |
| Fake `*_async` API that blocks the carrier | Rejected at binding validation or caught by carrier-concurrency integration test |
| Pure function without either suffix | Admitted |
| Unknown/unsupported I/O builtin or capability | Fails closed; no silent host fallback |

Testing the naming validator alone is insufficient to establish non-blocking scheduling, fault isolation, secure path resolution or cancellation safety. Each backend must additionally execute blocking and async operations under concurrency and denied-capability cases.

## Evidence and responsibility

The common source repository owns this contract. The separate LLVM and Java/Graal repositories own compiler/builtin/runtime implementation and executable tests for now; do not merge their sources just to adopt this rule. Record versioned conformance evidence and a migration/rollback status for each backend before declaring completion.
