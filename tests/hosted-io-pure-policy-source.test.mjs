import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";

const manifest=JSON.parse(readFileSync(new URL("../contracts/hosted-io-pure-policy-v1.json",import.meta.url)));
const sources=manifest.sources;
const EXPECTED=new Map([
 ["stdlib/std/http_response_policy.atto","22757dafe89bc9601d04c8726a09ddf676206c7e"],
 ["stdlib/std/fs_text_policy.atto","0cd53216e91ef8de1a764ba5b80ce85c5796c1f2"]
]);
const TARGETS=["java","llvm","net","forge","cranelift","wasm","rs","js","atto","hdl","realtime"];
const blobSha=bytes=>createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");

test("canonical native .atto policy sources are pinned to exact Git blobs",()=>{
 assert.equal(manifest.schema,"atto.stdlib.hosted_io_pure_policy.v1");
 assert.equal(manifest.status,"CANDIDATE_SOURCE_ONLY");
 assert.equal(manifest.sourcePolicy,"NATIVE_ATTO_BYTES_ONLY");
 assert.deepEqual(sources.map(x=>x.path),[...EXPECTED.keys()].sort());
 for(const s of sources){
   assert.equal(s.git_blob_sha1,EXPECTED.get(s.path));
   const bytes=readFileSync(new URL("../"+s.path,import.meta.url));
   assert.equal(blobSha(bytes),s.git_blob_sha1,"drift: "+s.path);
   const source=bytes.toString("utf8");
   assert.equal(source.includes("\r"),false);
   assert.equal(source.endsWith("\n"),true);
   assert.equal(source.includes("\0"),false);
   assert.match(source,/pub fnc/);
   assert.doesNotMatch(source,/\b(?:extern|import|await|susp)\b/);
 }
});

test("pure policy functions are implemented without mocked HTTP/FS effects",()=>{
 const http=readFileSync(new URL("../stdlib/std/http_response_policy.atto",import.meta.url),"utf8");
 const fs=readFileSync(new URL("../stdlib/std/fs_text_policy.atto",import.meta.url),"utf8");
 for(const name of ["http_status_valid","http_status_success","http_status_redirect",
   "http_status_client_error","http_status_server_error","http_get_status_may_have_body"]){
   assert.match(http,new RegExp("pub fnc "+name+"\\("));
 }
 for(const name of ["fs_text_size_admissible","fs_text_range_admissible",
    "fs_text_replacement_admissible"]){
   assert.match(fs,new RegExp("pub fnc "+name+"\\("));
 }
 assert.doesNotMatch(http,/http\s*\.\s*get|fetch\s*\(/);
 assert.doesNotMatch(fs,/fs\s*\.\s*(?:read_text|write_text)|open\s*\(/);
});

test("all eleven backends have an explicit non-guest status",()=>{
 assert.deepEqual(manifest.targets.map(x=>x.backend),TARGETS);
 for(const t of manifest.targets){
   assert.equal(t.compiler,"NOT_EXECUTED");
   assert.equal(t.guest,"NOT_EXECUTED");
   assert.equal(t.http_fs_io,"NOT_IMPLEMENTED_BY_THIS_CONTRACT");
   assert.equal(t.source,["atto","hdl","realtime"].includes(t.backend)
     ?"NOT_STAGED":"STAGED_SHA_MATCHED_2026_11_19");
 }
 assert.equal(manifest.limitations.length,4);
});
