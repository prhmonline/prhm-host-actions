'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const audit=require('./honartik-u06-expired-owner-four-owner-preflight-v1.cjs');
const source=path.join(__dirname,'honartik-u06-expired-owner-four-owner-preflight-v1.cjs');
function policy(){
 return {
  schema_version:'prhm.approval-policy.v1',default_deny:true,
  scope_freeze:true,one_time_use:true,
  levels:{'4':{human_approval:true,second_confirmation_required:true,max_ttl_seconds:180}},
  operations:{[audit.NATIVE_OPERATION]:{level:4,risk:'critical'}},
  typed_scopes:[{action:audit.NATIVE_ACTION,operation:audit.NATIVE_OPERATION,
   tool:'host_action_v2_apply',risk:'critical'}]
 };
}
test('exact current Root source preimages are explicit, typed and immutable',()=>{
 const four=['agent_api','root_executor','agent3_mcp','approval_policy'];
 assert.deepEqual(Object.keys(audit.SHA256).sort(),four.sort());
 assert.deepEqual(Object.keys(audit.PATHS).sort(),four.sort());
 assert.equal(audit.SHA256.approval_policy,
  'aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934');
 for(const sha of Object.values(audit.SHA256))assert.match(sha,/^[0-9a-f]{64}$/);
 assert.ok(Object.isFrozen(audit.SHA256));
 assert.ok(Object.isFrozen(audit.PATHS));
 assert.equal(audit.KIND.action,'honartik_u06_expired_owner_oidc_reconcile_v1');
 assert.notEqual(audit.KIND.operation,audit.NATIVE_OPERATION);
});
test('valid critical L4 one-use policy preconditions are accepted for inspection ONLY',()=>{
 assert.equal(audit.strictPolicy(policy()),true);
 assert.equal(audit.PRODUCTION_AUTHORIZED,false);
 assert.equal(audit.ROOT_INSTALLER_EXPORTED,false);
 assert.equal(audit.LEVEL4_ISSUER,false);
 assert.equal(audit.execute,undefined);
 assert.equal(audit.install,undefined);
});
test('policy drift refuses missing default-deny, scope freeze or one use',()=>{
 for(const key of ['default_deny','scope_freeze','one_time_use']){
  const p=policy();p[key]=false;
  assert.throws(()=>audit.strictPolicy(p),/policy_fail_closed_guards/);
 }
});
test('policy drift refuses weak critical L4 or TTL',()=>{
 for(const [key,value] of [['human_approval',false],
   ['second_confirmation_required',false],['max_ttl_seconds',600]]){
  const p=policy();p.levels['4'][key]=value;
  assert.throws(()=>audit.strictPolicy(p),/policy_level4_guards/);
 }
});
test('already-registered recovery or absent native registration is denied',()=>{
 const old=policy();old.operations[audit.KIND.operation]={level:4};
 assert.throws(()=>audit.strictPolicy(old),/policy_operation_scope_drift/);
 const duplicated=policy();duplicated.typed_scopes.push({action:audit.KIND.action,
   operation:audit.KIND.operation});
 assert.throws(()=>audit.strictPolicy(duplicated),/policy_operation_scope_drift/);
 const absent=policy();delete absent.operations[audit.NATIVE_OPERATION];
 assert.throws(()=>audit.strictPolicy(absent),/policy_operation_scope_drift/);
 const typed=policy();typed.typed_scopes=[];
 assert.throws(()=>audit.strictPolicy(typed),/policy_operation_scope_drift/);
});
test('read-only preflight rejects wrong host, incomplete owners and fake contents',()=>{
 const x={host:audit.KIND.owner,policy:policy(),ownerBytes:{}};
 assert.throws(()=>audit.auditReadOnly(x),/four_owner_shape/);
 const miss={...x,host:'node1'};
 assert.throws(()=>audit.auditReadOnly(miss),/wrong_host/);
 const fake=Object.fromEntries(Object.keys(audit.PATHS)
  .map(k=>[k,Buffer.alloc(512,'z')]));
 assert.throws(()=>audit.auditReadOnly({...x,ownerBytes:fake}),
  /owner_preimage_sha_drift_/);
 const notBytes={...fake,agent_api:'a'.repeat(512)};
 assert.throws(()=>audit.auditReadOnly({...x,ownerBytes:notBytes}),
  /owner_bytes_untrusted_agent_api/);
});
test('review module exposes no CLI, Root mutation, credential access or signer',()=>{
 const p=spawnSync(process.execPath,[source],{encoding:'utf8'});
 assert.equal(p.status,64);assert.match(p.stderr,/no Root apply/);
 assert.equal(p.stdout,'');
 const s=fs.readFileSync(source,'utf8');
 assert.doesNotMatch(s,/child_process|execSync|spawnSync|unlinkSync|renameSync|writeFileSync|mkdirSync|chmodSync|chownSync|systemctl/);
 assert.equal(audit.ROOT_INSTALLER_EXPORTED,false);
});
