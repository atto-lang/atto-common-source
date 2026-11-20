# HTTP request origin through source-task continuation (candidate v1)

Status: **source-free contract and verifier only**; no Java/LLVM/WASM/.NET/Forge guest runtime is yet certified by this document.

## Security invariant

HTTP request context belongs to one **exchange + actor-incarnation + logical mailbox message**, not a carrier thread, reusable actor, HTTP connection, callback emitter, or arbitrary Task id.

The current Java HTTP draft #2327 associates `NativeHttp.Exchange` with `ActorCell.activeMail` and installs an ephemeral dispatch sequence for ordinary callbacks. **Critical gap:** the actor's `OresScheduler.TaskRunner` is stable across `await`, but its `sourceTaskMailbox` submission currently creates `MessageEnvelope.continuation(command)` with the default unbound sequence (`-1`). Therefore `http.current_request_id` from a SourceTask resume is denied even for legitimate request work. An actor-wide TLS fallback would be incorrect: unrelated runtime work on a pooled actor could then impersonate the suspended request.

## Required runtime handoff (not yet merged)

1. At **TaskRunner admission**, capture the scheduler-authenticated actor-incarnation, active source-mail sequence, and generation-fenced logical execution identity. This is a *routing binding*, not the exchange State, a bearer token, or callback provenance.
2. Store the binding on that **TaskRunner** for its entire lifetime; neither the producer's completion thread nor task dispatcher may choose a different request origin. Do not infer it from `currentActorId` alone.
3. On `TaskRunner.enqueueTurn`, create a trusted runtime-owned command carrying this immutable origin; `ActorCell.sourceTaskMailbox` copies the origin into its queued envelope **without letting guest source construct it**.
4. At actual scheduler admission, validate the actor cell's generation, the original mail's sequence and suspended receive ownership, the task's stable execution identity, and that the HTTP request has not been revoked. Only then install an ephemeral *non-authoritative* dispatch marker.
5. All context reads still validate the **live owned Exchange** and its generation. Foreign producer callbacks only notify/enqueue and never install or consult request authority.
6. On actor STOP, cancelled request, mailbox completion or hot-reload incarnation change, fail closed. Physical memory release waits for scheduler-task and I/O quiescence; it does not follow automatically from revoking a lookup.
7. The same rules must apply to Java, LLVM, WASM workers, .NET Native AOT and Forge. Explicitly detached child tasks receive a limited immutable snapshot or separately leased capability; never implicitly inherit live RequestLocal authority.

## Source-free trace verifier

Run:

```sh
node --test tests/verify-http-origin-v1.test.mjs
node tools/verify-http-origin-v1.mjs captured-origin-trace.json
```

The 12 self-tests generate model histories with **3, 7 and 15 distinct carrier labels**, plus adversarial malformed histories. These are simulated, sequential trace events. They do not demonstrate 3/7/15 threads physically running in parallel.

A trace has `version:1`, backend in `java,llvm,wasm,net,forge`, 40-character lower-hex `source_sha`, `carrier_count` (3/7/15), and strictly increasing `events[].seq`. Event names: `mail_start`, `request_open`, `turn_enter` (user/source_task/callback), `request_claim`, `task_create`, `request_lookup`, `turn_leave`, `producer_notify`, `task_finish`, `request_close`, `mail_finish`, `request_retire`. The verifier checks logical origin, nested-carrier exclusivity, request retirement after tasks, and callback denial; result is `consistent_model_trace_not_backend_pass`.

**The trace checker cannot prove an actual scheduler emitted complete and honest events.** A SHA-shaped string in a trace is not proof of compiled source identity. Only independent exact-head source-artifact checks, full-step build/test logs, authenticated event emitters and real backend source compilation can promote a claim. Zero-step CI, static fixtures and synthetic traces are *not PASS*.

## Related exact-head drafts

- Java HTTP storage #2325 and logical request lookup #2327.
- Java sealed state #2245, state loans #2296, 3/7/15 carrier tests #2322.
- LLVM native state region #1192, pthread carrier matrix #1211.
- Common-source critical modes #187 (9 exact pinned guest cases) and state trace verifier #195 (16 tests).

Current source-org GitHub Actions jobs for Java PR #2327 and #2245 have shown **empty steps and no runner**, so their failures must not be mislabeled implementation failures. Keep source-private CI export blocked pending explicit allowlisting and protected-main review.
