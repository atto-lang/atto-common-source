# FFI actor timeout, cancellation and quiescence — proposed v1

Status: **draft normative proposal** for issue #80. No runtime or
native-library implementation is certified by this document.

## Native call state machine

An `ffi actor` manages `QUEUED -> ENTERED_NATIVE ->
RETURNED_NATIVE -> PUBLISHED`, with terminal `REJECTED` for work never
entered. Cancellation is a *request*, not an assertion that an already
entered native call has stopped.

- **QUEUED:** cancellation must remove or suppress the invocation before
  crossing the FFI boundary. Callback and resource cleanup occur exactly
  once; no native side effects are possible from that invocation.
- **ENTERED_NATIVE:** timeout/cancel settles the *requesting Future* as
  timed out/cancelled, but does not preempt arbitrary native code, free its
  arguments, or reissue the call. The native invocation remains charged
  against its actor, domain and supervisor budgets.
- **RETURNED_NATIVE:** a late native completion must atomically arbitrate
  with cancellation. Exactly one public result wins. Losing completions
  release their native resources, never invoke guest callbacks or publish
  an obsolete actor-generation result.
- **PUBLISHED:** completion is final for that request; repeated callback,
  cancellation or timeout notifications cannot change the result.

Neither `Future.cancel()` nor a timeout may be reported as native-process
termination. Native functions that support a documented cooperative
cancellation handle may opt into a separate cancellation protocol.

## Ownership and generations

Pin or copy `Sendable` arguments at FFI entry; no guest actor-private
pointer or borrowed object may outlive its proven lifetime. A native
handle is a typed, generation-bound capability, not a serializable
integer. Attach `requestId`, actor incarnation, code-generation lease,
trust domain and native-library generation to each invocation.
Late completions from a retired generation must be safely disposed of
without reentering replaced actor code.

Hot reload and unload require **quiescence**, defined as no entered native
calls, pending native callbacks or live generation-owned native handles.
An abandoned/stuck native call blocks unloading its image; report it
to supervisor CONTROL as an explicit degraded/quarantine state. Do not
free code pages, runtime arenas or native resources out from under it.
A forced OS-process kill is a different, isolated-process transport
policy and cannot be simulated safely for in-process calls.

## Admission and budgets

A trusted runtime limits in-flight native calls, queued calls, pinned
bytes, callback registrations, memory copies and wall-clock residency
per actor/domain. UNTRUSTED actors may not name arbitrary native
symbols/libraries or bypass quota accounting via supervisor calls.
Do not hide blocking OS threads or callbacks in freestanding `core`.

Failure/error results must preserve whether the call was rejected before
entry, entered but timed out, completed with a native error, or was
terminated by an isolated helper process. No automatic retries of
side-effecting `ENTERED_NATIVE` calls.

## Required adversarial evidence

1. Cancel before entry; cancel while blocked; timeout immediately before
   return; native return racing actor destruction and hot replacement.
2. Duplicate and very late native callbacks; callbacks racing supervisor
   shutdown; stale generation and reused native-handle identifiers.
3. Simulated stuck call; verify code unload refusal and supervisor
   quarantine rather than unsafe freeing.
4. Saturated call/byte budgets, nested native callbacks, recursive
   supervisor sends, FFI pointer borrowed across `await`.
5. Crash-only out-of-process FFI: separate helper death from in-process
   cancellation; do not translate loss of a reply into confirmed rollback.

Only exact-revision runnable Java/Graal and LLVM/host tests, including
real native calls and a provable unload gate, may upgrade this spec from
reference-only to verified behavior.
