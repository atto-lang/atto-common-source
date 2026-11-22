// Source-only structural contract tests. These NEVER execute Atto guest code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const contract=JSON.parse(readFileSync(new URL('contracts/native-future-family-v1.json',root),'utf8'));
const source=readFileSync(new URL(contract.canonicalSource,root));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const code=source.toString('utf8');
const tokenize=s=>s.replace(/^\s*\/\/[^\n]*(?:\n|$)/gm,' ').replace(/\s+/g,' ').trim();
const expectedSource=`
define module future_family as
  pub susp fnc await_future<T>(take! Future<T> receipt) -> T {
    return await receipt;
  }
  pub susp fnc await_task<T>(take! TaskFuture<T> child) -> T {
    return await child;
  }
  pub susp fnc await_actor<T>(take! ActorFuture<T> reply) -> T {
    return await reply;
  }
  pub susp fnc await_actor_result<T,E>(take! ActorFuture<Result<T,E>> reply) -> Result<T,E> {
    return await reply;
  }
end
`;
const requireExactNativeSource=(s)=>{
  assert.equal(tokenize(s),tokenize(expectedSource), 'Unexpected Atto code, unsafe await, or ownership-mode change');
};

test('canonical native .atto source has reviewed byte length and SHA-256',()=>{
  assert.equal(contract.schema,'atto.stdlib.native-future-family.v1');
  assert.equal(contract.status,'TARGET_NOT_EXECUTED');
  assert.equal(contract.canonicalSource,'stdlib/std/future_family.atto');
  assert.equal(contract.level,'std');
  assert.equal(contract.sourceIsNativeAtto,true);
  assert.equal(source.length,contract.sourceBytes);
  assert.equal(sha256(source),contract.canonicalSha256);
});
test('native Atto functions explicitly move affine Future receipts',()=>{
  requireExactNativeSource(code);
  assert.equal((tokenize(code).match(/pub susp fnc /g)||[]).length,4);
  assert.deepEqual(contract.compilerSealedTypes,['Future<T>','TaskFuture<T>','ActorFuture<T>']);
  assert.deepEqual(contract.exports,['await_future<T>','await_task<T>','await_actor<T>','await_actor_result<T,E>']);
  assert.equal(contract.ownershipMode,'take!');
  assert.equal(contract.taskControlAfterAwaitTask,'MOVED');
});
test('no claim of compiler AOT or independent backend execution',()=>{
  assert.equal(Object.values(contract.semanticBoundaries).every(v=>v===true),true);
  assert.deepEqual(Object.keys(contract.targets).sort(),[
    'atto','cranelift','forge','hdl','java','js','llvm','net','realtime','rs','wasm'
  ].sort());
  assert.equal(Object.values(contract.targets).every(v=>v==='NOT_EXECUTED'),true);
});
test('negative mutations fail closed at source-contract boundary',()=>{
  const attacks=[
    ["implicit borrowed Future await",code.replace('take! Future<T> receipt','Future<T> receipt')],
    ["implicit borrowed TaskFuture await",code.replace('take! TaskFuture<T> child','TaskFuture<T> child')],
    ["implicit borrowed ActorFuture await",code.replace('take! ActorFuture<T> reply','ActorFuture<T> reply')],
    ["actor Result receipt borrowed",code.replace('take! ActorFuture<Result<T,E>> reply','ActorFuture<Result<T,E>> reply')],
    ["duplicate await",code.replace('return await receipt;', 'await receipt; return await receipt;')],
    ["unwrap Result",code.replace('return await reply;\n  }\nend', 'return (await reply).unwrap();\n  }\nend')],
    ["change TaskFuture into Future",code.replace('take! TaskFuture<T> child','take! Future<T> child')],
    ["stream coercion",code.replace('take! ActorFuture<T> reply','take! ActorStream<T> reply')],
    ["duplicate reply",code.replace('return await reply;', 'return await reply; await reply;')],
    ["fabricate actor authority",code.replace('return await reply;', 'return await actor_future_int(7,41);')],
    ["return forged scalar",code.replace('return await child;', 'return 42;')],
    ["FFI callback",code.replace('return await child;', 'foreign fnc x(); return await child;')],
    ["unbounded retry",code.replace('return await receipt;', 'while true { await receipt; }')],
    ["second module declaration",code+'\ndefine module forged as end\n'],
    ["sneak in a second implementation",code.replace('end\n','end\npub susp fnc fake() -> int { return 0; }\n')],
    ["unapproved actor terminal conversion",code.replace('return await reply;','return Result.Ok(await reply);')],
  ];
  for(const [name,evil] of attacks)assert.throws(()=>requireExactNativeSource(evil),name);
  // Comments are not executable capabilities; source audit ignores comments.
  requireExactNativeSource('// extern fnc danger();\n'+code);
});
