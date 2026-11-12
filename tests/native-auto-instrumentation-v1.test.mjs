// SOURCE-ONLY contract admission tests. NOT a compiler, real Atto guest,
// OpenTelemetry exporter, runtime instrumentation or backend execution proof.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/v1/native-auto-instrumentation-v1.json", import.meta.url),
  "utf8",
));

const byCase = new Map(contract.scenarios.map(s => [s.id, s]));
const byHook = new Map(contract.hooks.map(h => [h.id, h]));

function can_probe(build, runtime, hook) {
  if (!contract.build_modes.includes(build) || !contract.runtime_modes.includes(runtime))
    throw new Error("invalid tracing profile");
  if (runtime === "off" || build === "none") return false;
  if (build === "functions") return true;
  return hook.profile === "boundaries";
}

test("default is off and cannot instantiate exporter or userland OTel implicitly", () => {
  assert.equal(contract.schema, "atto-native-auto-instrumentation.v1");
  assert.match(contract.status, /SOURCE_ONLY_NOT_EXECUTED/);
  assert.equal(contract.defaults.runtime, "off");
  assert.equal(contract.defaults.exporter, "none");
  assert.equal(contract.invariants.core_diagnostics_independent, true);
  assert.equal(contract.invariants.otel_userland_import_implicit, false);
  assert.equal(contract.invariants.std_exporter_requires_host_opt_in, true);
  assert.equal(contract.invariants.monkey_patching, false);
  assert.equal(contract.invariants.dynamic_code_generation, false);
  assert.equal(contract.invariants.no_synchronous_exporter, true);
});

test("build profiles gate immutable, unique fixed-ID probes", () => {
  assert.equal(byHook.size, contract.hooks.length);
  assert.ok(contract.hooks.length >= 12);
  for (const hook of contract.hooks) {
    assert.ok(Number.isSafeInteger(hook.id) && hook.id > 0);
    assert.match(hook.name, /^[a-z][a-z0-9.]*$/);
    assert.ok(["compiler", "boundary", "internal"].includes(hook.kind));
    assert.ok(["boundaries", "functions"].includes(hook.profile));
    assert.equal(can_probe("none", "on", hook), false);
    assert.equal(can_probe("boundaries", "off", hook), false);
    assert.equal(can_probe("functions", "off", hook), false);
    assert.equal(can_probe("functions", "on", hook), true);
    assert.equal(can_probe("boundaries", "on", hook), hook.profile === "boundaries");
  }
  assert.throws(() => can_probe("unknown", "on", contract.hooks[0]));
  assert.throws(() => can_probe("functions", "unknown", contract.hooks[0]));
});

test("mandatory zero-code and distributed-context cases have explicit oracles", () => {
  const cases = [
    "disabled-default", "compile-out", "http-server-auto", "http-client-retry",
    "actor-message", "actor-fanout", "async-resume", "exception-teardown",
    "pressure", "export-denied", "privacy", "unsupported-ffi",
    "function-probes", "wasm-no-import",
  ];
  assert.equal(byCase.size, contract.scenarios.length);
  for (const id of cases) {
    const s = byCase.get(id);
    assert.ok(s, `missing case ${id}`);
    assert.ok(contract.build_modes.includes(s.build));
    assert.ok(contract.runtime_modes.includes(s.runtime));
    assert.ok(s.expect && Object.keys(s.expect).length >= 2);
  }
  assert.equal(byCase.get("http-server-auto").expect.manual_guest_calls, 0);
  assert.equal(byCase.get("actor-message").expect.manual_guest_calls, 0);
  assert.equal(byCase.get("function-probes").expect.manual_guest_calls, 0);
  assert.equal(byCase.get("exception-teardown").expect.end_span_count_per_started_span, 1);
  assert.equal(byCase.get("actor-fanout").expect.relation, "span_links");
  assert.equal(byCase.get("async-resume").expect.carrier_thread_independent, true);
});

test("bounded collection, private fields and immutable context are mandatory", () => {
  assert.equal(contract.invariants.saturation_behavior, "drop_and_count");
  assert.equal(contract.invariants.queue_memory_bounded, true);
  assert.equal(contract.invariants.trace_context_location,
    "immutable_actor_envelope_and_continuation");
  assert.equal(contract.invariants.no_thread_local_context_assumption, true);
  assert.equal(contract.invariants.guest_semantics_unchanged_on_export_failure, true);
  assert.equal(contract.invariants.trace_id_bits, 128);
  assert.equal(contract.invariants.span_id_bits, 64);
  assert.equal(contract.defaults.capture_request_bodies, false);
  assert.equal(contract.defaults.capture_sql_bindings, false);
  assert.equal(contract.defaults.capture_guest_objects, false);
  assert.ok(contract.defaults.buffer_events > 0);
  assert.equal(contract.privacy.exporter_requires_egress_capability, true);
  assert.equal(contract.privacy.no_raw_user_attributes_in_core_hooks, true);
  assert.ok(contract.privacy.external_headers.includes("traceparent"));
  for (const name of contract.privacy.forbidden_default_fields)
    assert.ok(!contract.privacy.allowed_default_fields.includes(name), name);
  assert.equal(byCase.get("pressure").expect.waits, 0);
  assert.equal(byCase.get("export-denied").expect.network_exports, 0);
});

test("backend evidence remains NOT_EXECUTED; shape tests never certify parity", () => {
  assert.equal(contract.evidence.source_only_is_backend_execution, false);
  assert.equal(contract.evidence.requires_guest_compiler, true);
  assert.equal(contract.evidence.requires_actual_backend_artifact, true);
  assert.equal(contract.evidence.requires_stepful_execution, true);
  assert.equal(contract.evidence.requires_exact_sha, true);
  assert.deepEqual(Object.keys(contract.evidence.backend_execution_status).sort(),
    [...contract.supported_target_backends].sort());
  for (const status of Object.values(contract.evidence.backend_execution_status))
    assert.equal(status, "NOT_EXECUTED");
});
