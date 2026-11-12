// SOURCE-ONLY / machine-readable protocol checks.
// No real Atto parser/runtime/JIT/AOT execution is performed by this test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const c = JSON.parse(readFileSync(new URL(
  "../contracts/v1/native-auto-instrumentation-v1.json", import.meta.url
), "utf8"));
const cases = new Map(c.scenarios.map(x => [x.id, x]));
const scope = c.scoped_using_v1;
const live = c.live_instrumentation_v1;

test("using keyword is existing and span scope syntax is normative target", () => {
  assert.equal(scope.existing_keyword, "using");
  assert.equal(scope.new_keyword_required, false);
  assert.equal(scope.grammar, "using expression as identifier { statements }");
  assert.equal(scope.status, "TARGET_NOT_IMPLEMENTED");
  assert.equal(scope.static_resource_check_required, true);
  assert.equal(scope.resource_expression_evaluated_once, true);
  assert.equal(scope.binding_lexically_scoped, true);
});

test("each acquired scoped resource cleans exactly once, not on suspension", () => {
  assert.equal(scope.acquired_resource_cleanup_exactly_once, true);
  assert.deepEqual(scope.cleanup_paths, [
    "fallthrough","return","question_early_exit","trap","throw","raise",
    "panic","cancel","unwind"
  ]);
  assert.equal(scope.cleanup_on_await_suspension, false);
  assert.equal(scope.preserve_scope_across_suspension, true);
  assert.equal(scope.tail_call_cleanup_barrier, true);
  assert.equal(scope.telemetry_cleanup_nothrow, true);
  assert.equal(scope.telemetry_cleanup_nosuspend, true);
  assert.equal(scope.telemetry_cleanup_no_io, true);
  assert.equal(cases.get("using-await-survival").expect.close_on_suspend, false);
  assert.equal(cases.get("using-early-return").expect.close_scope_calls, 1);
  assert.equal(cases.get("using-exception-and-cancel").expect.supervisor_control_unmodified, true);
});

test("disabled span remains valid but user expressions are not optimized away", () => {
  assert.equal(scope.no_op_scope_when_disabled, true);
  assert.equal(scope.no_op_does_not_elide_user_argument_effects, true);
  assert.equal(scope.no_span_scope_token_escape, true);
  assert.equal(scope.no_cross_actor_span_scope_transfer, true);
  const x=cases.get("using-no-op-disabled").expect;
  assert.equal(x.clock_reads, 0);
  assert.equal(x.recorded_spans, 0);
  assert.equal(x.user_argument_side_effects_preserved, true);
});

test("runtime activation of compiled probes is not the same as adding new probes", () => {
  assert.equal(live.no_process_restart_for_existing_probe_activation, true);
  assert.equal(live.instrumentation_none_cannot_enable_missing_precompiled_probes, true);
  assert.equal(live.no_silent_jit_in_full_guest_aot, true);
  assert.equal(live.instrumentation_none_may_support_separate_dynamic_jit_attach, true);
  assert.equal(live.strict_none_without_tagged_ir_has_no_dynamic_attach, true);
  assert.equal(cases.get("jit-none-with-retained-tags").expect.static_probe_sites, 0);
  assert.equal(cases.get("jit-none-with-retained-tags").expect.authorized_new_jit_probes, true);
  assert.equal(cases.get("jit-none-no-metadata").expect.dynamic_jit_probes, 0);
  assert.equal(cases.get("jit-none-no-metadata").expect.activation_result, "instrumentation_unavailable");

  const pre=live.runtime_implementation.find(x=>x.mode==="precompiled-probes");
  const truffle=live.runtime_implementation.find(x=>x.mode==="truffle-dynamic-attach");
  const hotload=live.runtime_implementation.find(x=>x.mode==="signed-hotload-generation");
  assert.equal(pre.spontaneous_new_probes, false);
  assert.equal(truffle.spontaneous_new_probes, true);
  assert.equal(truffle.safepoint_deopt_recompile, true);
  assert.equal(hotload.spontaneous_new_probes, "new_code_generation_only");
  assert.equal(cases.get("aot-instrument-none").expect.runtime_activation,
    "instrumentation_unavailable");
  assert.equal(cases.get("aot-hotload-signed").expect.not_same_binary_reinstrumentation, true);
});

test("late probe addition requires instrumentable JIT and safe authorization", () => {
  assert.equal(live.source_metadata_or_ir_required_for_late_jit_attach, true);
  assert.equal(live.runtime_activation_requires_authorized_control_plane, true);
  assert.equal(live.runtime_activation_no_extra_capabilities, true);
  assert.equal(live.control_rate_limited, true);
  assert.equal(live.dynamic_jit_budgeted, true);
  assert.equal(live.stop_or_change_at_safe_points, true);
  assert.equal(live.preserve_actor_owner_and_control_priority, true);
  assert.equal(live.activation_reports_coverage_mode, true);
  assert.equal(live.no_retroactive_spans, true);
  assert.equal(live.default_no_remote_attach_port, true);
  assert.equal(cases.get("jit-no-retroactive-span").expect.next_function_entry_traced, true);
  assert.equal(cases.get("jit-security-denial").expect.unauthorized_request_denied, true);
  assert.equal(cases.get("jit-live-detach").expect.probes_removed_from_future_entries, true);
  assert.equal(cases.get("jit-bounded-churn").expect.compile_work_bounded, true);
});

test("fixture count is unique and cannot certify backend parity", () => {
  assert.equal(c.scenarios.length, new Set(c.scenarios.map(x=>x.id)).size);
  assert.equal(c.scenarios.length, 47);
  assert.equal(c.evidence.source_only_is_backend_execution, false);
  for(const r of Object.values(c.evidence.backend_execution_status))
    assert.equal(r, "NOT_EXECUTED");
});


test("portable .atto lexical span fixtures have pinned source-only oracles", () => {
  const root = new URL("../fixtures/native-auto-instrumentation-v1/", import.meta.url);
  const oracle = JSON.parse(readFileSync(new URL("using-span-expected.json", root), "utf8"));
  assert.equal(oracle.status, "SOURCE_ONLY_NOT_EXECUTED");
  assert.equal(oracle.cases.length, 2);
  assert.deepEqual(oracle.cases.map(x => x.expected_stdout), ["FBCA", "FBC"]);
  for (const item of oracle.cases) {
    assert.match(item.source, /^[a-z0-9-]+\\.atto$/);
    const source = readFileSync(new URL(item.source, root), "utf8");
    assert.ok(source.includes('using telemetry.span("checkout") as span {'));
    assert.ok(source.includes("pub fnc main(): void"));
    assert.ok(source.includes("pub close_scope(): void"));
    assert.equal(item.expected_exit, 0);
  }
});
