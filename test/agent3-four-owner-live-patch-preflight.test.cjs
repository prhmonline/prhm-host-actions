'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const path=require('node:path');
const preflight=require('../ops/agent3-universal-backup/four-owner-live-patch-preflight.cjs');
const original=require('../ops/agent3-universal-backup/four-owner-readonly-preflight.cjs');
const contract=require('../ops/agent3-universal-backup/production-registration-contract.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(){
 const originals=Object.fromEntries(preflight.NAMES.map(k=>
  [k,Buffer.from('// synthetic owner '+k+'\nconst ready = false;\n')]));
 const hashes=Object.fromEntries(preflight.NAMES.map(k=>[k,sha(originals[k])]));
 const candidates={
  base:Buffer.from('const agent3BaseRegistered = true;\n'),
  executor:Buffer.from('const agent3ExecutorSpecOnly = true;\n'),
  policy:Buffer.from(JSON.stringify({operations:{[contract.operation]:{level:4,risk:'critical'}},
   typed_scopes:[{action:contract.action,risk:'critical'}]},null,2)+'\n'),
  mcp:Buffer.from('const agent3McpEnumOnly = true;\n')
 };
 const after=Object.fromEntries(preflight.NAMES.map(k=>[k,sha(candidates[k])]));
 const evidence={schema:'prhm.agent3.registry-owner-evidence.v1',mode:'READ_ONLY_PREFLIGHT',
  production_mutation:false,enrollment_authorized:false,cryptographically_signed:false,
  owner_count:4,service_count:4,
  owners:Object.fromEntries(preflight.NAMES.map(k=>[k,{
   path:original.OWNERS[k],sha256:hashes[k],size:originals[k].length}])),
  hashes,
  services:original.SERVICES.map(unit=>({unit,loaded:true,active:true,running:true}))};
 const plan={
  action:contract.action,candidate_buffers:candidates,after_sha256:after,
  dispatcher_connected:false,execution_adapter_reviewed:false,
  ready_for_registration_manifest:false,
  registration_performed:false,approval_consumed:false,production_mutation:false
 };
 return {evidence,ownerBytes:originals,plan,verifyPin:()=>true,
  build:()=>plan};
}
test('only four in-memory SHA-checked candidates are reported; no source bytes returned',()=>{
 const f=fixture(),r=preflight.assess(f);
 assert.equal(r.ok,true);
 assert.equal(r.mode,'READ_ONLY_INCOMPLETE_PATCH_PREVIEW');
 assert.deepEqual(r.candidate_after_sha256,f.plan.after_sha256);
 assert.equal(r.owner_count,4);
 assert.equal(r.original_owner_bytes_disclosed,false);
 assert.equal(r.candidate_bytes_disclosed,false);
 assert.equal(r.dispatcher_connected,false);
 assert.equal(r.ready_for_registration_manifest,false);
 assert.equal(r.approval_consumed,false);
 assert.equal(r.production_mutation,false);
 assert.equal(r.next_gate,'REVIEW_AND_BIND_TRUSTED_FIVE_FIELD_LEVEL4_EXECUTOR_BEFORE_MANIFEST');
 assert.equal(Object.hasOwn(r,'candidate_buffers'),false);
 assert.equal(JSON.stringify(r).includes('synthetic owner'),false);
});
test('production pin verifier is mandatory in default call; synthetic evidence never passes',()=>{
 const f=fixture();
 delete f.verifyPin;
 assert.throws(()=>preflight.assess(f),/preimage_mismatch|untrusted_contract|incomplete_live_evidence/);
});
test('byte/evidence mismatch refuses patch before builder is called',()=>{
 const f=fixture();
 let calls=0;
 f.build=()=>{calls++;return f.plan;};
 f.ownerBytes.base=Buffer.from('changed');
 assert.throws(()=>preflight.assess(f),/bytes_not_bound_to_evidence:base/);
 assert.equal(calls,0);
});
test('abort on extra or incomplete owner set, invalid candidate digests and executable syntax',()=>{
 for(const edit of [
  f=>{f.ownerBytes.extra=Buffer.from('extra')},
  f=>{delete f.ownerBytes.mcp},
  f=>{f.plan.after_sha256.policy='0'.repeat(64)},
  f=>{f.plan.candidate_buffers.executor=Buffer.from('function bad( {')},
  f=>{f.plan.candidate_buffers.policy=Buffer.from('[]')},
  f=>{f.plan.dispatcher_connected=true},
  f=>{f.plan.ready_for_registration_manifest=true},
  f=>{f.plan.approval_consumed=true},
  f=>{f.plan.production_mutation=true}
 ]){
  const f=fixture();edit(f);
  assert.throws(()=>preflight.assess(f));
 }
});
test('no unlisted file can be read and unknown modes never trigger installation',()=>{
 assert.throws(()=>preflight.safeReadPinned('arbitrary'),/unlisted_owner/);
 const file=path.join(__dirname,'../ops/agent3-universal-backup/four-owner-live-patch-preflight.cjs');
 const result=cp.spawnSync(process.execPath,[file,'--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,64);
 assert.match(result.stderr,/read-only --check only/);
});

test('valid MCP ES module imports pass syntax-only check without being loaded',()=>{
 const candidate=Buffer.from("import {readFileSync} from 'node:fs';\nexport const name = 'safe';\n");
 assert.doesNotThrow(()=>preflight.checkSyntax('mcp',candidate));
 const f=fixture();
 f.plan.candidate_buffers.mcp=candidate;
 f.plan.after_sha256.mcp=sha(candidate);
 const v=preflight.assess(f);
 assert.equal(v.ok,true);
 assert.equal(v.candidate_bytes_disclosed,false);
});
test('malformed MCP ES module and CommonJS syntax fail closed',()=>{
 assert.throws(()=>preflight.checkSyntax('mcp',Buffer.from("import { from 'node:fs';\n")),
  /mcp_module_syntax_invalid/);
 assert.throws(()=>preflight.checkSyntax('executor',Buffer.from('function broken ( {')),
  /SyntaxError/);
 assert.throws(()=>preflight.checkSyntax('policy',Buffer.from('{}')),
  /invalid_syntax_check_target/);
});
test('MCP syntax check never executes top-level code or side effects',()=>{
 const candidate=Buffer.from("import 'node:fs';\nthrow new Error('NEVER_EXECUTED');\n");
 assert.doesNotThrow(()=>preflight.checkSyntax('mcp',candidate));
});
