// SOURCE-ONLY MACHINE-READABLE PARITY/EVIDENCE CHECKS.
// They enforce truthful capability profiles; they do NOT run backend guests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/v1/native-scoped-span-parity-v1.json", import.meta.url), "utf8"));
const norm = JSON.parse(readFileSync(
  new URL("../contracts/v1/native-auto-instrumentation-v1.json", import.meta.url), "utf8"));
const {public_contract: c, profiles: backends, equivalence_gate: parity} = contract;

test("scope syntax and cleanup protocol match the normative instrumentation target", () => {
  assert.equal(contract.schema, "atto-native-scoped-span-parity.v1");
  assert.equal(c.keyword, "using");
  assert.equal(c.public_contract, undefined);
  assert.equal(c.canonical_cleanup, norm.scoped_using_v1.cleanup_member_candidate);
  assert.equal(c.resource_expression_evaluated_once,
               norm.scoped_using_v1.resource_expression_evaluated_once);
  assert.equal(c.normal_exit_cleanup_exactly_once, true);
  assert.equal(c.nonlocal_exit_cleanup_exactly_once, true);
  assert.equal(c.scope_alias, "affine_non_escaping");
  assert.equal(c.inter_actor_trace_context,
               "immutable_value_separate_from_span_scope");
  assert.equal(c.actor_transfer_of_scope_alias, "forbidden");
  assert.equal(c.no_user_defined_namespace_impersonation, true);
  assert.equal(c.source_must_not_call_cleanup_directly, true);
  assert.deepEqual(c.cleanup_effects, {
    no_throw: true, no_raise: true, no_panic: true,
    no_suspend: true, no_blocking_io: true
  });
  assert.deepEqual(c.permitted_observers,
    ["set_attribute", "add_event", "record_error", "set_status"]);
});

test("LLVM has narrow exact-head executable proof, not general parity", () => {
  const llvm = backends.llvm_host_aot;
  assert.equal(llvm.status, "EXECUTED_RESTRICTED_SUBSET");
  assert.equal(llvm.implementation, "opaque_compiler_owned_token");
  assert.equal(llvm.operation_argument, "string_literal_only");
  assert.equal(llvm.suspension, "compile_time_rejected");
  assert.equal(llvm.actor_migration, "compile_time_rejected");
  assert.equal(llvm.test_evidence.run_result, "SUCCESS");
  assert.match(llvm.test_evidence.source_sha, /^[a-f0-9]{40}$/);
  assert.equal(llvm.test_evidence.source_tree_mirrored, false);
  assert.equal(llvm.test_evidence.exact_blob_count, 48);
  assert.equal(llvm.test_evidence.positive_native_guest_cases, 5);
  assert.equal(llvm.test_evidence.negative_compiler_cases, 5);
  assert.deepEqual(llvm.test_evidence.host_linker_optimization, ["O0", "O2"]);
  assert.equal(llvm.test_evidence.test_receipt,
    "LLVM_AOT_GUEST_TELEMETRY_SCOPE_EXECUTION_PASS:5:5");
  assert.deepEqual(llvm.cleanup_paths_proven, [
    "fallthrough", "return", "nested_return",
    "conditional_taken", "conditional_not_taken"
  ]);
  assert.ok(llvm.limitations.includes("async_await"));
  assert.ok(llvm.limitations.includes("full_shared_nominal_SpanScope"));
});

test("LLVM same-process live activation is AOT dormant-probe control, never invented JIT", () => {
  const llvm = backends.llvm_host_aot;
  const live = llvm.live_probe_control;
  assert.equal(live.status, "EXECUTED_RESTRICTED_SUBSET");
  assert.equal(live.activation_kind, "precompiled_dormant_aot_probe");
  assert.equal(live.authority, "trusted_host_only");
  assert.equal(live.process_restarted, false);
  assert.equal(live.jit_added_new_probes, false);
  assert.equal(live.source_sha, llvm.test_evidence.source_sha);
  assert.equal(live.exact_blob_count, llvm.test_evidence.exact_blob_count);
  assert.equal(live.carrier_run, llvm.test_evidence.carrier_run);
  assert.equal(live.result, "SUCCESS");
  assert.equal(live.receipt, "LLVM_AOT_LIVE_PROBE_TOGGLE_EXECUTION_PASS:O0:O2");
  assert.deepEqual(live.same_process_activation, ["off", "on", "off", "on"]);
  assert.equal(live.guest_calls, 4);
  assert.equal(live.spans_recorded, 2);
  assert.equal(live.unchanged_guest_result, 51);
});

test("Java and other unexecuted backends cannot inherit LLVM execution status", () => {
  assert.equal(backends.java_graal.status, "SOURCE_ONLY_COMPILER_CANDIDATE");
  assert.equal(backends.java_graal.provider_identity,
               "test_defined_nominal_class_not_trusted_runtime_intrinsic");
  assert.equal(backends.java_graal.operation_argument,
               "nonempty_string_literal_at_most_256_utf8_bytes_candidate");
  assert.equal(backends.java_graal.source_scope_test_methods, 19);
  assert.equal(backends.java_graal.test_evidence.scope_junit_minimum_with_borrow_regression, 20);
  assert.equal(backends.java_graal.test_evidence.runtime_execution, "NOT_EXECUTED");
  assert.equal(backends.java_graal.test_evidence.source_ci_failure_reason,
               "JOB_ADMISSION_ZERO_STEPS");
  for (const name of ["forge", "net", "wasm"]) {
    assert.equal(backends[name].status, "NOT_EXECUTED");
  }
  assert.equal(parity.current, "NOT_MET");
  assert.equal(parity.cannot_claim_full_parity_with_source_only_tests, true);
  assert.equal(parity.cannot_claim_full_parity_with_host_C_tests, true);
  assert.equal(parity.authorized_exact_head_receipts_required, true);
});

test("backend capability claims are one-way, never silently upgraded", () => {
  const implementationTypes = new Set([
    "opaque_compiler_owned_token", "synthetic_lexical_binding_try_finally"
  ]);
  assert.ok(implementationTypes.has(backends.llvm_host_aot.implementation));
  assert.ok(implementationTypes.has(backends.java_graal.implementation));
  assert.notEqual(backends.java_graal.implementation,
                  backends.llvm_host_aot.implementation);
  assert.equal(c.disabled_probe_must_not_read_clock, true);
  assert.equal(c.disabled_probe_must_not_allocate, true);
  assert.equal(c.no_implicit_network_export, true);
  assert.equal(c.no_implicit_egress_permission, true);
  assert.equal(c.cancellation_cleanup_requires_continuation_ownership, true);
  assert.equal(c.suspension_must_not_end_live_scope, true);
  assert.equal(c.no_unbudgeted_hard_realtime_probe, true);
});
