// Source-only identity and native-Atto API gate. It does NOT execute Atto guest code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const contract=JSON.parse(readFileSync(new URL('contracts/native-future-family-v1.json',root),'utf8'));
const source=readFileSync(new URL(contract.canonicalSource,root));
const text=source.toString('utf8');
const SHA256=bytes=>createHash('sha256').update(bytes).digest('hex');
const signatures=[
  /pub susp fnc await_future<T>\(Future<T> receipt\) -> T \{\s*return await receipt;\s*\}/,
  /pub susp fnc await_task<T>\(TaskFuture<T> child\) -> T \{\s*return await child;\s*\}/,
  /pub susp fnc await_actor<T>\(ActorFuture<T> reply\) -> T \{\s*return await reply;\s*\}/,
  /pub susp fnc await_actor_result<T,E>\(ActorFuture<Result<T,E>> reply\) -> Result<T,E> \{\s*return await reply;\s*\}/
];

test('canonical native Atto source is exact SHA/size-pinned',()=>{
  assert.equal(contract.schema,'atto.stdlib.native-future-family.v1');
  assert.equal(contract.status,'TARGET_NOT_EXECUTED');
  assert.equal(contract.level,'std');
  assert.equal(contract.canonicalSource,'stdlib/std/future_family.atto');
  assert.equal(source.length,contract.sourceBytes);
  assert.equal(SHA256(source),contract.canonicalSha256);
  assert.equal(contract.sourceIsNativeAtto,true);
});
test('Future family adapters use Atto syntax, not host-language implementations',()=>{
  assert.match(text,/define module future_family as/);
  assert.match(text,/\nend\s*$/);
  for(const pattern of signatures)assert.match(text,pattern);
  assert.equal((text.match(/pub susp fnc /g)||[]).length,signatures.length);
  assert.doesNotMatch(text,/\b(?:extern|foreign|ffi|syscall|dlopen)\b\s*(?:fnc|\(|;)/);
  assert.doesNotMatch(text,/\b(?:Java|C\+\+|JVM|JSPI)\s*\./);
});
test('affine, actor and Result boundaries stay explicit and guests unverified',()=>{
  assert.deepEqual(contract.compilerSealedTypes,['Future<T>','TaskFuture<T>','ActorFuture<T>']);
  assert.equal(Object.values(contract.semanticBoundaries).every(v=>v===true),true);
  assert.equal(Object.values(contract.targets).length,11);
  assert.equal(Object.values(contract.targets).every(v=>v==='NOT_EXECUTED'),true);
  assert.doesNotMatch(text,/\bActorStream\s*</); // no stream-to-Future conversion
  assert.doesNotMatch(text,/\.cancel_task\s*\(/); // no control via plain Future
});
