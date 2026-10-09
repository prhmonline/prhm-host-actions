/* Read-only candidate contract tests. No server, no deployment, no credentials. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const reg=require('./rahekomak-web-only-host-action-registry-candidate-v1.js');
const base="const HOST_ACTION_V2_SPECS = Object.freeze({\n"+
"  rahekomak_production_deploy_v1: { operation: 'host_action.rahekomak_production_deploy_v1', rollback: 'host-action-v2:rahekomak-production-deploy-v1:helper-transaction-rollback' },\n});";
const exec="const HOST_ACTION_V2_SPECS=Object.freeze({\n"+
"  rahekomak_production_deploy_v1:{operation:'host_action.rahekomak_production_deploy_v1',kind:'rahekomak_production_deploy_v1'},\n});\n"+
"applyHostActionV2=async function(action){return null;}";
const mcp="const HostActionV2=z.enum(['rahekomak_production_deploy_v1','other']);";
const policy=JSON.stringify({schema_version:'prhm.approval-policy.v1',version:reg.POLICY_BASE,
 default_deny:true,operations:{},typed_scopes:[]});
test('registration adds exactly one fixed Level-4 action to each boundary',()=>{
 const b=reg.patchBase(base),e=reg.patchExecutor(exec),m=reg.patchMcp(mcp),p=JSON.parse(reg.patchPolicy(policy));
 assert.equal(b.split(reg.ACTION).length-1,1);
 assert.ok(e.includes('applyRahKomakWebOnlyReleaseV1()'));
 assert.ok(e.includes('RAHEKOMAK_WEB_SCRIPT_SHA='));
 assert.ok(e.includes('RAHEKOMAK_RELEASE_APPROVAL_MODE=approved_web_only'));
 assert.ok(m.includes("'"+reg.ACTION+"'"));
 assert.equal(p.operations[reg.OPERATION].level,4);
 assert.equal(p.operations[reg.OPERATION].requires_second_confirmation,true);
 assert.equal(p.typed_scopes[0].action,reg.ACTION);
});
test('duplicate and drift registration fail closed',()=>{
 for(const [f,s] of [[reg.patchBase,base],[reg.patchExecutor,exec],[reg.patchMcp,mcp],[reg.patchPolicy,policy]]){
  assert.throws(()=>f(f(s)));
  assert.throws(()=>f('wrong baseline'));
 }
});
test('source SHA mismatch blocks candidate construction before any patch',()=>{
 assert.throws(()=>reg.buildCandidates({base,executor:exec,mcp,policy}),/preimage_sha_mismatch/);
});
test('registration payload cannot alter app, API, DB, Apache or host services',()=>{
 const b=reg.patchExecutor(exec);
 for(const token of ['artisan','migrate','db:seed','--property=ReadWritePaths=/etc',
  'systemctl restart','httpd -t']){
  assert.equal(b.includes(token),false,token);
 }
 assert.ok(b.includes("'/usr/bin/systemd-run'"));
 assert.ok(b.includes("RAHEKOMAK_WEB_SHA='"+reg.SHA+"'"));
});
