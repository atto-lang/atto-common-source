// HOST-ONLY CONTRACT POLICY. This is not a compiler/guest test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const path='contracts/v1/oresllm-actor-f32-host-abi-v1.json';
const data=JSON.parse(readFileSync(path,'utf8'));
const expectedNegatives=[
  'no_turn','foreign_thread_copied_claim','stopping_actor',
  'restarted_generation','foreign_actor_scope','invalid_shape',
  'output_quota','stale_tensor_generation','forged_pool_ref',
  'use_after_take','loan_across_await'
];
function verify(c){
 assert.equal(c.contract,'attolang.oresllm.actor-f32-host-bridge');
 assert.equal(c.version,1);
 assert.equal(c.status,'DESIGN_AND_PREFLIGHT_ONLY');
 assert.deepEqual(c.scope.target_backends,['java-graal','llvm']);
 assert.equal(c.limits.max_axis,32);
 assert.equal(c.limits.max_output_bytes,4096);
 assert.equal(c.limits.bytes_per_f32,4);
 assert.equal(c.limits.pool_slots,16);
 assert.equal(c.scope.origin,'trusted scheduler dispatch, not guest-authored actor/tenant integers');
 assert.equal(c.caller.all_fields_host_supplied,true);
 assert.equal(c.caller.guest_controls_authority_fields,false);
 assert.equal(c.caller.allocation_kind,'ACTOR');
 assert.equal(c.caller.backend_validator,'live physically owned RUNNING actor turn');
 assert.equal(c.caller.requires_revocation_and_restart_fence,true);
 assert.equal(c.caller.new_operations_after_stop,'DENY');
 assert.equal(c.tensors.guest_native_pointer_exposure,false);
 assert.equal(c.tensors.lifetime,'inputs borrowed for full operation; result exclusively owned until release');
 assert.match(c.tensors.failure,/rollback unpublished output/);
 assert.deepEqual(c.tensors.ownership_compiler_requirements,[
  'reject_use_after_take','reject_mutable_alias',
  'reject_borrow_across_suspend_unpinned','reject_stale_or_foreign_actor_domain',
  'drop_on_exception_and_cancellation'
 ]);
 assert.equal(c.abi_candidate.symbol,'ores_f32_guest_gemm_v1');
 assert.equal(c.abi_candidate.binding_kind,'TRUSTED_RUNTIME_INTERNAL_ONLY');
 assert.equal(c.abi_candidate.expose_to_guest,'NEVER');
 assert.equal(c.abi_candidate.direct_ffi_compiler_lowering,'NOT_IMPLEMENTED');
 assert.equal(c.abi_candidate.source_typechecker_intrinsic,'NOT_IMPLEMENTED');
 assert.deepEqual(c.negative_cases,expectedNegatives);
 assert.deepEqual(c.release_gates,[
  'exact_source_head_host_native_matrix','executed_compiler_guest_java',
  'executed_compiler_guest_llvm','executed_graalvm_native_image',
  'executed_llvm_aot','ownership_compile_negative',
  'actor_derived_runtime_authority',
  'no_cross_org_private_compiler_source_without_approval'
 ]);
 assert.equal(c.security_incident,'ores-llm/ores-llm-ml-conformance-tests#29');
 assert.deepEqual(c.certification,{
  compiler_emitted_guest:'NOT_EXECUTED',java_aot:'NOT_EXECUTED',
  llvm_aot:'NOT_EXECUTED',tenant_isolation:'NOT_CERTIFIED',release_ready:false
 });
}
test('f32 actor ABI v1 scope remains trusted-host-only and compiler unimplemented',()=>verify(data));
test('forged readiness, pointer exposure and unsafe ownership changes are rejected',()=>{
 const bad=change=>{const copy=structuredClone(data);change(copy);assert.throws(()=>verify(copy));};
 bad(c=>c.certification.release_ready=true);
 bad(c=>c.certification.compiler_emitted_guest='PASSED');
 bad(c=>c.scope.origin='guest supplied');
 bad(c=>c.caller.allocation_kind='TASK');
 bad(c=>c.caller.guest_controls_authority_fields=true);
 bad(c=>c.caller.new_operations_after_stop='ALLOW');
 bad(c=>c.tensors.guest_native_pointer_exposure=true);
 bad(c=>c.tensors.ownership_compiler_requirements.pop());
 bad(c=>c.abi_candidate.direct_ffi_compiler_lowering='IMPLEMENTED');
 bad(c=>c.abi_candidate.expose_to_guest='YES');
 bad(c=>c.negative_cases.pop());
 bad(c=>c.release_gates.pop());
 bad(c=>c.security_incident='CLOSED');
});

test('latest actual host pin and native production bridge are not compiler/AOT evidence',()=>{
 const h=data.host_stage;
 assert.equal(h.classification,'LOCALLY_EXECUTED_TRUSTED_HOST_COMPONENTS_NOT_COMPILER_BRIDGE');
 assert.equal(h.java_actor_pin.pr,2731);
 assert.equal(h.java_actor_pin.local_execution,'PASS_JDK_21_HOST_ONLY');
 assert.equal(h.java_actor_pin.scheduler_dispatch_wiring,'NOT_IMPLEMENTED');
 assert.equal(h.java_actor_pin.runtime_blob,'ed5793389fe7c10a4ef9b9560b7ce8cc4e871afc');
 assert.equal(h.llvm_actor_pin.pr,1628);
 assert.equal(h.llvm_actor_pin.local_execution,'PASS_GCC_CLANG_O1_O2_ASAN_UBSAN_HOST_ONLY');
 assert.equal(h.llvm_actor_pin.lease_blob,'60730da754b9edd1e8486c1f37d346352c8894fe');
 assert.equal(h.llvm_actor_pin.compiler_lowering,'NOT_IMPLEMENTED');
 assert.equal(h.production_host_broker.pr,30);
 assert.equal(h.production_host_broker.local_execution,'PASS_REAL_C11_GCC_CLANG_O1_O2_ASAN_UBSAN');
 assert.equal(h.production_host_broker.implementation_blob,'7b08c7f652bdc14c0b981fa0f3d95cb0817023e7');
 assert.equal(h.production_host_broker.test_blob,'cbd21637de91ad99989e6da3bb9a154b14e15134');
 assert.equal(h.production_host_broker.golden,'22,28,49,64');
 assert.equal(h.production_host_broker.forced_commit_rollbacks,256);
 assert.equal(h.production_host_broker.forced_stop_during_allocator,true);
 assert.equal(h.production_host_broker.executor_callbacks,'TEST_MODEL_ONLY');
 assert.equal(h.compiler_intrinsic_call,'NOT_IMPLEMENTED');
 assert.equal(h.java_native_image,'NOT_EXECUTED');
 assert.equal(h.llvm_aot_guest,'NOT_EXECUTED');
 assert.equal(h.borrow_take_compile_negative,'NOT_EXECUTED');
 assert.equal(h.source_github_actions,'BLOCKED_ZERO_STEP');
 assert.equal(h.source_security_incident,'OPEN');
 assert.equal(h.cross_org_private_compiler_source_copy,false);
 assert.equal(h.release_ready,false);
 const corrupt=(fn)=>{
  const copy=structuredClone(h);fn(copy);
  assert.notDeepEqual(copy,h);
  const ok=copy.compiler_intrinsic_call==='NOT_IMPLEMENTED' &&
    copy.production_host_broker.executor_callbacks==='TEST_MODEL_ONLY' &&
    copy.llvm_aot_guest==='NOT_EXECUTED' &&
    copy.java_native_image==='NOT_EXECUTED' &&
    copy.borrow_take_compile_negative==='NOT_EXECUTED' &&
    copy.source_security_incident==='OPEN' &&
    copy.cross_org_private_compiler_source_copy===false &&
    copy.release_ready===false;
  assert.equal(ok,false);
 };
 corrupt(x=>x.compiler_intrinsic_call='IMPLEMENTED');
 corrupt(x=>x.production_host_broker.executor_callbacks='PRODUCTION_ACTOR_SCHEDULER');
 corrupt(x=>x.java_native_image='PASS');
 corrupt(x=>x.llvm_aot_guest='PASS');
 corrupt(x=>x.borrow_take_compile_negative='PASS');
 corrupt(x=>x.source_security_incident='CLOSED');
 corrupt(x=>x.cross_org_private_compiler_source_copy=true);
 corrupt(x=>x.release_ready=true);
});
