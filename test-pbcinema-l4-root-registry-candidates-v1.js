'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),crypto=require('node:crypto');
const registry=require('./pbcinema-l4-root-registry-candidates-v1');
const trust=require('./pbcinema-l4-root-admission-contract-v1');
const actions=trust.ACTIONS;
function source(){
 return Object.fromEntries(Object.entries(trust.TARGETS).map(([key,v])=>[key,fs.readFileSync(v.path,'utf8')]));
}
test('registered actions are exactly two fixed critical operations',()=>{
 assert.deepEqual(actions.map(a=>a.action),['pbcinema_mysql_backup_credential_issue_v1','pbcinema_universal_installer_upgrade_v1']);
 assert.equal(registry.EXECUTOR_DEST,'/opt/prhm-agent-selfmaint-exec/actions/pbcinema-l4-native-executor-v1.js');
});
test('unmodified live five-file preimage is safe to inspect, read only',()=>{
 if(process.env.PBCINEMA_ROOT_REGISTRATION_READONLY!=='1')return;
 const before=source();
 for(const [key,v] of Object.entries(trust.TARGETS))assert.equal(trust.sha256(before[key]),v.sha256,key);
 const out=registry.buildCandidates(before);
 assert.deepEqual(Object.keys(out).sort(),Object.keys(before).sort());
 for(const key of Object.keys(before))assert.notEqual(out[key],before[key]);
 for(const a of actions){
  assert.match(out.base,new RegExp(a.action));
  assert.match(out.executor,new RegExp(a.action));
  assert.ok(out.mcp.includes(a.action));
  assert.ok(out.mcp_candidate.includes(a.action));
 }
 assert.equal(JSON.parse(out.policy).operations[actions[0].operation].level,4);
 assert.equal(JSON.parse(out.policy).operations[actions[1].operation].level,4);
 const liveAfter=source();
 assert.deepEqual(liveAfter,before,'pure patcher must never alter installed authority');
});
test('source drift, partial registration, missing owner fail closed',()=>{
 const bad={base:'changed',executor:'',policy:'{}',mcp:'',mcp_candidate:''};
 assert.throws(()=>registry.buildCandidates(bad),/preimage_drift:base/);
 assert.throws(()=>registry.buildCandidates({}),/source_missing:base/);
});
test('approved helper blob SHA checks and no mutating API exposed',()=>{
 assert.match(registry.BLOB_SHA256.native,/^[a-f0-9]{64}$/);
 assert.match(registry.BLOB_SHA256.contract,/^[a-f0-9]{64}$/);
 assert.equal(typeof registry.apply, 'undefined');
 assert.equal(typeof registry.install,'undefined');
 assert.equal(typeof registry.register,'undefined');
});
test('recheck trusted registered policy remains default-deny',()=>{
 if(process.env.PBCINEMA_ROOT_REGISTRATION_READONLY!=='1')return;
 const p=JSON.parse(source().policy);
 assert.equal(p.enabled,true);assert.equal(p.default_deny,true);
 assert.ok(Array.isArray(p.typed_scopes));
 for(const a of actions)assert.equal(p.operations[a.operation],undefined);
});
