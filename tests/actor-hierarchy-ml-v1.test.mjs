import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const spec = JSON.parse(readFileSync(
  new URL('../contracts/v1/actor-hierarchy-ml-v1.json', import.meta.url),
  'utf8'
));
const base = () => ({
  name: 'A1', kind: 'actor', domain: 'shared',
  parents: [{kind: 'actor_root', name: 'Actor', domain: 'shared'}],
  state_count: 1, inherited_state_count: 0,
  ancestry: [], interfaces: [], traits: [],
  methods: [{name: 'handle', arity: 1, visibility: 'public', params: ['Msg'], result: 'void'}],
  overrides: [], actor_ref_cast: null, share: false, send: false, sync: false
});
const key = m => m.name + '/' + m.arity;
const signature = m => JSON.stringify([m.params, m.result]);
function admit(input) {
  const a = {...base(), ...input};
  if (!['actor', 'class_extends_actor_root'].includes(a.kind)) return false;
  if (a.parents.length > 1) return false;
  const p = a.parents[0];
  if (p && !['actor', 'actor_root'].includes(p.kind)) return false;
  if (p && p.domain !== a.domain) return false;
  const roots = {shared:'Actor',private:'IsoActor',untrusted:'UntrustedActor'};
  if (p?.kind === 'actor_root' && p.name !== roots[a.domain]) return false;
  if (p?.kind === 'actor' && (!p.linked || !p.nominal_id)) return false;
  if (p && p.final) return false;
  if (p && p.sealed && !p.permits?.includes(a.name)) return false;
  if (a.ancestry.includes(a.name)) return false;
  if (a.state_count + a.inherited_state_count > 1) return false;
  if (a.share && (!a.send || !a.sync)) return false;
  if (a.actor_ref_cast &&
      (a.actor_ref_cast !== 'verified_interface' || !a.interfaces.length)) return false;
  const slots = new Map();
  for (const m of a.methods) {
    if (m.name.startsWith(spec.hierarchy.runtime_reserved_prefix)) return false;
    if (slots.has(key(m))) return false;
    slots.set(key(m), m);
  }
  for (const i of a.interfaces) {
    if (i.fields.length) return false;
    for (const required of i.methods) {
      const provided = slots.get(key(required));
      if (!provided || provided.visibility !== 'public') return false;
      if (signature(required) !== signature(provided)) return false;
    }
  }
  const traitSlots = new Set();
  for (const tr of a.traits) {
    if (tr.fields.length || tr.mutable_static) return false;
    if (tr.default_effects.some(effect => effect !== 'pure')) return false;
    for (const method of tr.methods ?? []) {
      if (traitSlots.has(key(method))) return false;
      traitSlots.add(key(method));
    }
  }
  for (const method of a.abstract_methods ?? []) {
    const implemented = slots.get(key(method));
    if (!implemented || signature(implemented) !== signature(method)) return false;
  }
  for (const m of a.overrides) {
    if (m.base_visibility === 'public' && m.visibility !== 'public') return false;
    if (JSON.stringify([m.params,m.result]) !== JSON.stringify([m.base_params,m.base_result])) return false;
  }
  return true;
}
test('schema stays non-promoting and five backend claims remain unexecuted', () => {
  assert.equal(spec.schema, 'oreslang.actor-hierarchy-ml.v1');
  assert.equal(spec.status, 'CONTRACT_ONLY_NOT_GUEST_EXECUTED');
  assert.deepEqual(spec.backends.map(x=>x.name), ['java','llvm','wasm','cranelift','net']);
  for (const b of spec.backends) {
    assert.equal(b.guest_execution, 'NOT_EXECUTED');
    assert.equal(b.outcome, 'NOT_CLAIMED');
  }
  assert.equal(spec.hierarchy.max_concrete_parents, 1);
  assert.equal(spec.hierarchy.single_effective_state_schema, true);
  assert.deepEqual(spec.hierarchy.share_requires, ['Send','Sync']);
});
test('every independently evaluated actor admission fixture matches its oracle', () => {
  assert.equal(new Set(spec.cases.map(x=>x.id)).size, spec.cases.length);
  assert.ok(spec.cases.length >= 30);
  let accepted=0, rejected=0;
  for (const c of spec.cases) {
    const actual = admit(c.override) ? 'accept' : 'reject';
    assert.equal(actual, c.expected, c.id);
    if (actual === 'accept') accepted++; else rejected++;
  }
  assert.ok(accepted >= 7);
  assert.ok(rejected >= 20);
});

class Stage {
  constructor() {
    this.version=spec.ml.initial_weight_version;
    this.weight=spec.ml.initial_weight;
    this.contexts=new Map();
    this.microbatches=new Set();
    this.prepared=null;
    this.sealed=false;
    this.committed=false;
    this.cancelled=false;
    this.revision=0;
  }
  forward(microbatch, version=this.version) {
    assert.equal(this.cancelled,false, 'cancelled run');
    assert.equal(this.sealed,false, 'prepared barrier seals admission');
    assert.equal(version,this.version,'stale weight version');
    assert.equal(Number.isSafeInteger(microbatch),true,'invalid microbatch');
    assert.equal(this.microbatches.has(microbatch),false,'duplicate microbatch');
    assert.ok(this.contexts.size < spec.ml.max_inflight_contexts,'bounded activation credits');
    const ticket=Object.freeze({id:microbatch}); // identity-only host model; NOT a wire token
    this.contexts.set(ticket,{microbatch,version,contributions:new Map()});
    this.microbatches.add(microbatch);
    this.revision++;
    return ticket;
  }
  backward(ticket,edge,gradient,version=this.version) {
    assert.equal(this.cancelled,false,'cancelled');
    assert.equal(this.sealed,false,'sealed forward/backward phase');
    const ctx=this.contexts.get(ticket);
    assert.ok(ctx,'unknown or forged activation ticket');
    assert.equal(version,ctx.version,'wrong activation version');
    assert.ok(spec.ml.expected_edges.includes(edge),'unknown edge');
    assert.equal(ctx.contributions.has(edge),false,'duplicate gradient edge');
    assert.ok(Number.isFinite(gradient),'non-finite gradient');
    ctx.contributions.set(edge,gradient);
    this.revision++;
  }
  prepare() {
    assert.equal(this.cancelled,false,'cancelled');
    assert.equal(this.sealed,false,'already prepared');
    assert.equal(this.microbatches.size,spec.ml.planned_microbatches,'incomplete cohort');
    // Floating-point addition is non-associative: determinism requires a
    // canonical microbatch order as well as canonical per-edge order. Map
    // insertion order is transport scheduling, never a numerical contract.
    let total=0;
    const contexts=[...this.contexts.values()]
      .sort((a,b)=>a.microbatch-b.microbatch);
    for (const ctx of contexts) {
      assert.equal(ctx.contributions.size,spec.ml.expected_edges.length,'missing fan-in');
      for (const edge of spec.ml.expected_edges) {
        assert.ok(ctx.contributions.has(edge));
        total+=ctx.contributions.get(edge);
      }
    }
    const nextWeight=this.weight - spec.ml.learning_rate*total;
    assert.ok(Number.isFinite(nextWeight),'invalid candidate');
    assert.ok(Number.isSafeInteger(this.version+1),'version overflow');
    const receipt=Object.freeze({oldVersion:this.version, revision:this.revision, nextWeight});
    this.sealed=true;
    this.prepared=receipt;
    return receipt;
  }
  commit(receipt) {
    assert.equal(this.cancelled,false,'cancelled');
    assert.equal(this.committed,false,'double publish');
    assert.equal(receipt,this.prepared,'unissued prepare receipt');
    assert.equal(receipt.oldVersion,this.version,'stale version');
    assert.equal(receipt.revision,this.revision,'admission revision changed');
    this.weight=receipt.nextWeight;
    this.version++;
    this.committed=true;
    this.contexts.clear();
    return this.weight;
  }
  cancel() {
    this.cancelled=true;
    this.contexts.clear();
    this.microbatches.clear();
    this.prepared=null;
    this.sealed=true;
  }
}
const full = () => {
  const s=new Stage();
  const a=s.forward(10), b=s.forward(11);
  s.backward(a,'left',1);s.backward(a,'right',2);
  s.backward(b,'left',3);s.backward(b,'right',4);
  return {s,a,b};
};
test('forward, fan-in and backward yield a deterministic two-microbatch SGD update', () => {
  assert.deepEqual(spec.ml.expected_edges,['left','right']);
  assert.equal(spec.ml.stage_placement,'coarse_actor_per_stage_or_shard');
  const {s}=full();
  const receipt=s.prepare();
  assert.equal(s.weight,5,'prepare must not publish');
  assert.equal(s.commit(receipt),4);
  assert.equal(s.version,4);
  assert.throws(()=>s.commit(receipt),/double publish/);
});
test('missing fan-in and unplanned microbatch never prepare', () => {
  const s=new Stage(), a=s.forward(10);
  s.backward(a,'left',1);
  assert.throws(()=>s.prepare(),/incomplete cohort/);
  const b=s.forward(11);
  s.backward(b,'left',3);s.backward(b,'right',4);
  assert.throws(()=>s.prepare(),/missing fan-in/);
});
test('replayed and malformed gradient contributions never change accumulators', () => {
  const s=new Stage(),a=s.forward(10);
  assert.throws(()=>s.backward({...a},'left',9),/unknown or forged/);
  assert.throws(()=>s.backward(a,'other',9),/unknown edge/);
  assert.throws(()=>s.backward(a,'left',Infinity),/non-finite/);
  assert.throws(()=>s.backward(a,'left',1,4),/wrong activation version/);
  s.backward(a,'left',1);
  assert.throws(()=>s.backward(a,'left',2),/duplicate gradient/);
  assert.equal(s.contexts.get(a).contributions.size,1);
});
test('activation budget, unique microbatch and stale weight version are fail closed', () => {
  const s=new Stage();
  s.forward(10);
  assert.throws(()=>s.forward(10),/duplicate/);
  assert.throws(()=>s.forward(11,4),/stale/);
  s.forward(11);
  assert.throws(()=>s.forward(12),/bounded activation credits/);
});
test('prepare fences new forward/backward work and cannot be replayed or forged', () => {
  const {s,a}=full(), p=s.prepare();
  assert.throws(()=>s.forward(12),/prepared barrier/);
  assert.throws(()=>s.backward(a,'left',1),/sealed/);
  assert.throws(()=>s.commit({...p}),/unissued prepare receipt/);
  assert.equal(s.weight,5);
  assert.equal(s.commit(p),4);
});
test('cancel before commit revokes prepare receipt and keeps weight/version immutable', () => {
  const {s}=full(),p=s.prepare();
  s.cancel();
  assert.throws(()=>s.commit(p),/cancelled/);
  assert.equal(s.weight,5);
  assert.equal(s.version,3);
  assert.equal(s.contexts.size,0);
});
test('version overflow refuses candidate before publication', () => {
  const {s}=full();
  s.version=Number.MAX_SAFE_INTEGER;
  assert.throws(()=>s.prepare(),/version overflow/);
  assert.equal(s.weight,5);
});

test('portable scalar gradient fixture has exact bytes and independent hand-derived numeric outputs', () => {
  const f = spec.ml.scalar_i64_guest_fixture;
  const bytes = readFileSync(new URL('../' + f.path, import.meta.url));
  const actual = createHash('sha256').update(bytes).digest('hex');
  assert.equal(actual, f.sha256, 'source drift would invalidate exact-head guest identity');
  assert.equal(bytes.toString('utf8').trim(), 'fnc main(w:int,x:int,t:int,rate:int):int{return w-rate*(w*x-t)*x;}');
  assert.equal(f.scope, 'hand_derived_numeric_intersection_only');
  for (const x of f.cases) {
    const [w, input, target, rate] = x.args;
    assert.equal(w - rate * (w * input - target) * input, x.result);
  }
  assert.equal(f.overflow_args.length, 4);
  // Executing this arithmetic in Node is NOT an Oreslang backend pass.
});

test('same no-argument scalar guest is byte-pinned and remains explicitly unexecuted', () => {
  const f = spec.ml.portable_noargs_scalar_guest;
  const bytes = readFileSync(new URL('../' + f.path, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), f.sha256);
  assert.equal(f.source_blob_sha, '5affedebfcc7bf6aab2bdd6451f80ea5a71a5624');
  assert.equal(bytes.toString('utf8'), 'pub fnc main(): int { return 2 - 1 * (2 * 1 - 42) * 1; }\n');
  assert.equal(f.expected_result, 42);
  assert.equal(f.execution_status, 'NOT_EXECUTED');
  assert.deepEqual(f.backends, spec.backends.map(x => x.name));
});

function lossTwoLayer(x,w1,w2,target) {
  const hidden=w1*x;
  const residual=w2*hidden-target;
  return 0.5*residual*residual;
}
test('two-layer scalar backprop VJP matches independent symmetric finite differences', () => {
  const x=2, w1=3, w2=4, target=20;
  const hidden=w1*x, residual=w2*hidden-target;
  const analyticW1=residual*w2*x, analyticW2=residual*hidden;
  assert.equal(lossTwoLayer(x,w1,w2,target), 8);
  assert.equal(analyticW1,32);
  assert.equal(analyticW2,24);
  const eps=1e-5;
  const fdW1=(lossTwoLayer(x,w1+eps,w2,target)-
              lossTwoLayer(x,w1-eps,w2,target))/(2*eps);
  const fdW2=(lossTwoLayer(x,w1,w2+eps,target)-
              lossTwoLayer(x,w1,w2-eps,target))/(2*eps);
  assert.ok(Math.abs(fdW1-analyticW1)<1e-7);
  assert.ok(Math.abs(fdW2-analyticW2)<1e-7);
});
test('shared tensor operand has two separately admitted backward contributions', () => {
  const s=new Stage(), ticket=s.forward(10);
  s.backward(ticket,'left',3);
  s.backward(ticket,'right',3);
  assert.equal(s.contexts.get(ticket).contributions.size,2);
  assert.equal([...s.contexts.get(ticket).contributions.values()].reduce((a,b)=>a+b,0),6);
  assert.throws(()=>s.backward(ticket,'right',3),/duplicate gradient/);
});
test('out-of-order gradient deliveries still complete exact edge ledger once', () => {
  const s=new Stage(),a=s.forward(10),b=s.forward(11);
  s.backward(b,'right',4);
  s.backward(a,'right',2);
  s.backward(b,'left',3);
  s.backward(a,'left',1);
  const receipt=s.prepare();
  assert.equal(s.commit(receipt),4);
  assert.equal(s.version,4);
});

test('non-finite optimizer candidate never prepares, publishes or changes weight', () => {
  const s=new Stage(), a=s.forward(10), b=s.forward(11);
  for (const ticket of [a,b]) {
    s.backward(ticket,'left',1e308);
    s.backward(ticket,'right',1e308);
  }
  assert.throws(()=>s.prepare(),/invalid candidate/);
  assert.equal(s.weight,5);
  assert.equal(s.version,3);
  assert.equal(s.sealed,false);
  assert.equal(s.prepared,null);
  s.cancel();
  assert.throws(()=>s.prepare(),/cancelled/);
});
test('failed incomplete prepare cannot be used as a commit receipt', () => {
  const s=new Stage(), a=s.forward(10);
  s.backward(a,'left',1);
  assert.throws(()=>s.prepare(),/incomplete cohort/);
  assert.throws(()=>s.commit(Object.freeze({oldVersion:3,revision:2,nextWeight:0})),
    /unissued prepare receipt/);
  assert.equal(s.weight,5);
  assert.equal(s.version,3);
  assert.equal(s.committed,false);
});
test('cancellation permanently revokes activation tickets and any future admission', () => {
  const s=new Stage(),a=s.forward(10);
  s.cancel();
  assert.throws(()=>s.backward(a,'left',1),/cancelled|unknown or forged/);
  assert.throws(()=>s.forward(11),/cancelled run/);
  assert.equal(s.version,3);
  assert.equal(s.weight,5);
});
test('gradient arrivals are commutative at the expected-edge ledger, not transport order', () => {
  const leftToRight=full(), rightToLeft=new Stage();
  const a=rightToLeft.forward(10),b=rightToLeft.forward(11);
  rightToLeft.backward(b,'right',4);
  rightToLeft.backward(a,'left',1);
  rightToLeft.backward(b,'left',3);
  rightToLeft.backward(a,'right',2);
  assert.equal(leftToRight.s.commit(leftToRight.s.prepare()),4);
  assert.equal(rightToLeft.commit(rightToLeft.prepare()),4);
  assert.equal(leftToRight.s.version,rightToLeft.version);
});

test('gradient accumulation is invariant to forward microbatch admission order', () => {
  // An unsorted Map accumulates the same contributions in different orders:
  // (1e16 + -1e16) + 1 = 1, but (1e16 + 1) + -1e16 = 0.
  // The expected ordering is microbatch ID ascending, then expected_edges.
  const fill=(order)=>{
    const s=new Stage();
    const tickets=new Map();
    for (const id of order) tickets.set(id,s.forward(id));
    for (const id of [10,11]) {
      s.backward(tickets.get(id),'left', id===10 ? 1e16 : -1e16);
      s.backward(tickets.get(id),'right', id===10 ? 1 : 0);
    }
    return s.commit(s.prepare());
  };
  assert.equal(fill([10,11]),4);
  assert.equal(fill([11,10]),4);
});
test('backward edge delivery order is numerically irrelevant to optimizer commit', () => {
  const fill=(order)=>{
    const s=new Stage(),a=s.forward(10),b=s.forward(11);
    const tickets=new Map([[10,a],[11,b]]);
    const values=new Map([['10:left',1e16],['10:right',1],
      ['11:left',-1e16],['11:right',0]]);
    for(const [id,edge] of order)
      s.backward(tickets.get(id),edge,values.get(id+':'+edge));
    return s.commit(s.prepare());
  };
  const sequence=[[10,'left'],[10,'right'],[11,'left'],[11,'right']];
  assert.equal(fill(sequence),fill([...sequence].reverse()));
});
