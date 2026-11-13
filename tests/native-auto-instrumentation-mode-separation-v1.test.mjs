// SOURCE-ONLY tracing capability-contract guards; not compiler or runtime proof.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const c = JSON.parse(readFileSync(new URL(
  "../contracts/v1/native-auto-instrumentation-v1.json", import.meta.url,
), "utf8"));
const cases = new Map(c.scenarios.map(x => [x.id, x]));
const modes = new Map(c.live_instrumentation_v1.runtime_implementation.map(x => [x.mode, x]));

test("dormant AOT boundaries do not imply function-wide probes or a runtime JIT", () => {
  const boundary = cases.get("aot-instrument-boundaries");
  assert.equal(boundary.build, "boundaries");
  assert.equal(boundary.runtime, "on");
  assert.equal(boundary.expect.runtime_enable_without_jit, true);
  assert.equal(boundary.expect.semantic_boundary_probe_records, true);
  const pre = modes.get("precompiled-probes");
  assert.equal(pre.spontaneous_new_probes, false);
  assert.equal(pre.available_on.includes("llvm-aot"), true);
  assert.equal(pre.available_on.includes("net-aot"), true);
});

test("live JIT attachment is limited to explicitly instrumentable engines", () => {
  const truffle = modes.get("truffle-dynamic-attach");
  assert.deepEqual(truffle.available_on, ["java-jit"]);
  assert.equal(truffle.spontaneous_new_probes, true);
  assert.equal(truffle.safepoint_deopt_recompile, true);
  assert.equal(c.live_instrumentation_v1.no_silent_jit_in_full_guest_aot, true);
  assert.equal(c.live_instrumentation_v1.runtime_activation_requires_authorized_control_plane, true);
  assert.equal(c.live_instrumentation_v1.runtime_activation_no_extra_capabilities, true);
  assert.equal(cases.get("jit-security-denial").expect.no_execution_mutation, true);
});

test("compile-out, JIT metadata and stripped binaries have different admission rules", () => {
  assert.equal(cases.get("aot-instrument-none").build, "none");
  assert.equal(cases.get("aot-instrument-none").expect.runtime_activation, "instrumentation_unavailable");
  assert.equal(cases.get("jit-none-with-retained-tags").expect.static_probe_sites, 0);
  assert.equal(cases.get("jit-none-with-retained-tags").expect.authorized_new_jit_probes, true);
  assert.equal(cases.get("jit-none-no-metadata").expect.dynamic_jit_probes, 0);
  assert.equal(cases.get("jit-none-no-metadata").expect.activation_result, "instrumentation_unavailable");
  assert.equal(c.live_instrumentation_v1.strict_none_without_tagged_ir_has_no_dynamic_attach, true);
});

test("a source-only gate never upgrades five-backend execution claims", () => {
  assert.equal(c.evidence.source_only_is_backend_execution, false);
  assert.equal(c.evidence.requires_stepful_execution, true);
  assert.equal(c.evidence.requires_exact_sha, true);
  assert.deepEqual([...Object.keys(c.evidence.backend_execution_status)].sort(),
    [...c.supported_target_backends].sort());
  assert.ok(Object.values(c.evidence.backend_execution_status)
    .every(status => status === "NOT_EXECUTED"));
});
