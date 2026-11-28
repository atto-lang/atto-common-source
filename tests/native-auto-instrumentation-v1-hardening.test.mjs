// SOURCE-ONLY cross-backend tracing contract tests. NOT an Atto compiler,
// real runtime, network/OTLP integration, or executable backend evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const c = JSON.parse(readFileSync(new URL(
  "../contracts/v1/native-auto-instrumentation-v1.json", import.meta.url,
), "utf8"));
const byCase = new Map(c.scenarios.map(x => [x.id, x]));

test("compile-time, runtime and stdlib producer roles converge on one ABI", () => {
  const a = c.architecture_v1_reconciliation;
  assert.deepEqual(a.producers, [
    "typed_compiler_mir",
    "trusted_actor_scheduler_runtime",
    "registered_native_atto_stdlib",
  ]);
  assert.equal(a.common_abi, "versioned_fixed_id_typed_nonthrowing_nonsuspending");
  assert.equal(a.semantic_probe_deduplication, true);
  assert.equal(a.public_grammar, "no_new_keyword_required");
  assert.equal(a.target_public_core, "ores.core.trace");
  assert.equal(a.target_public_std, "ores.std.telemetry");
  assert.equal(a.std_implementation_language, ".atto_when_expressible");
});

test("call lowering requires exactly-once scope teardown on all exit paths", () => {
  const exits = [
    "return","question_early_exit","trap","throw","raise","panic",
    "cancel","preempt","unwind",
  ];
  assert.deepEqual(c.architecture_v1_reconciliation.scope_terminal_paths, exits);
  assert.equal(c.architecture_v1_reconciliation.scope_reclamation,
    "exactly_once_with_generation_fence");
  const x = byCase.get("scope-early-exit").expect;
  assert.equal(x.exactly_one_terminal_transition, true);
  assert.equal(x.guest_effects, "unchanged");
  assert.equal(x.scope_generation_fenced, true);
  assert.equal(c.capability_policy.emitter_may_not_suspend, true);
  assert.equal(c.capability_policy.emitter_may_not_throw_or_panic, true);
  assert.equal(c.capability_policy.emitter_may_not_execute_guest_callbacks, true);
});

test("off, SDK-disabled and propagation-only are distinct security policies", () => {
  const a = c.architecture_v1_reconciliation;
  assert.equal(c.defaults.runtime, "off");
  assert.equal(c.defaults.exporter, "none");
  assert.equal(c.defaults.propagation, "off");
  assert.equal(a.no_new_trace_headers_when_default_off, true);
  assert.equal(a.propagation_separate_from_recording, true);
  assert.equal(a.non_recording_context_propagates, true);
  assert.equal(a.recording_and_sampled_distinct, true);
  assert.equal(a.untrusted_remote_sampled_flag_is_not_permission, true);
  assert.equal(c.otel_environment.endpoint_alone_enables_tracing, false);
  assert.equal(c.otel_environment.sdk_disabled_implicitly_disables_propagators, false);
  assert.equal(byCase.get("sdk-disabled").expect.explicit_propagator_unaffected, true);
  assert.equal(byCase.get("propagation-only").expect.clock_reads, 0);
  assert.equal(byCase.get("default-no-wire-change").expect.injected_trace_headers, 0);
  assert.equal(byCase.get("otel-config").expect.auto_enable, false);
  assert.equal(byCase.get("untrusted-sampled").expect.remote_flag_grants_permission, false);
});

test("OpenTelemetry configuration uses its standard variable names", () => {
  const required = [
    "OTEL_SERVICE_NAME", "OTEL_RESOURCE_ATTRIBUTES", "OTEL_SDK_DISABLED",
    "OTEL_TRACES_SAMPLER", "OTEL_TRACES_SAMPLER_ARG", "OTEL_PROPAGATORS",
    "OTEL_TRACES_EXPORTER", "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_PROTOCOL",
  ];
  assert.deepEqual(c.otel_environment.variables, required);
  assert.equal(c.otel_environment.interpret_once_per_runtime_start, true);
  assert.equal(c.otel_environment.unsupported_configuration, "fail_closed");
  assert.ok(c.package_configuration_target.proposed_keys.includes(
    "telemetry.auto.channels"));
  assert.equal(c.package_configuration_target.implemented, false);
  assert.equal(c.architecture_v1_reconciliation.otlp_initial_protocol, "http/protobuf");
});

test("context handoff, semconv fan-out, private state and collector pressure", () => {
  assert.equal(c.invariants.trace_context_location,
    "immutable_actor_envelope_and_continuation");
  assert.equal(byCase.get("mailbox-migration").expect.thread_local_not_required, true);
  assert.equal(byCase.get("message-batch-fanout").expect.uses_links_for_multiple_causes, true);
  assert.equal(byCase.get("http-semantic-dedup").expect.server_spans, 1);
  assert.equal(byCase.get("critical-guard").expect.probe_awaits, 0);
  assert.equal(byCase.get("critical-guard").expect.borrow_or_lock_acquired_by_probe, false);
  assert.equal(byCase.get("collector-recursion").expect.nested_auto_span_count, 0);
  assert.equal(byCase.get("exporter-unsupported-io").expect.worker_blocking_fallback, false);
  assert.equal(byCase.get("fs-privacy").expect.path_text_collected, false);
  assert.equal(byCase.get("restart-fencing").expect.old_scope_reactivation, false);
  assert.equal(c.capability_policy.network_export_requires_explicit_host_permission, true);
  assert.equal(c.capability_policy.memory_is_bounded, true);
});

test("do not translate source-only or conceptual models into backend pass claims", () => {
  assert.equal(c.evidence.source_only_is_backend_execution, false);
  assert.equal(c.evidence.requires_guest_compiler, true);
  assert.equal(c.evidence.requires_stepful_execution, true);
  assert.equal(new Set(c.hooks.map(h => h.id)).size, c.hooks.length);
  assert.equal(new Set(c.scenarios.map(s => s.id)).size, c.scenarios.length);
  assert.ok(c.scenarios.length >= 30);
  assert.ok(c.hooks.length >= 20);
  assert.equal(c.hooks.find(h => h.name === "critical.contention").profile, "boundaries");
  for (const result of Object.values(c.evidence.backend_execution_status))
    assert.equal(result, "NOT_EXECUTED");
});
