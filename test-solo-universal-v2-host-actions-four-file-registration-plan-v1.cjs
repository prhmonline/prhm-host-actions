'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const p=require('./solo-universal-v2-host-actions-four-file-registration-plan-v1.cjs');
const file=path.join(__dirname,'solo-universal-v2-host-actions-four-file-registration-plan-v1.cjs');
const base=[
"const HOST_ACTION_V2_SPECS = Object.freeze({",
"  host_action_v2_installer_v1: { operation: 'host_action.host_action_v2_installer_v1', rollback: 'host-action-v2:host-action-v2-installer-v1:four-file-restore' },",
"});",
'const HOST_ACTION_V2_LEVEL3 = new Set(["leadops_language_gate_v1"]);'
].join('\n');
const exec=[
'const HOST_ACTION_V2_SPECS = Object.freeze({',
"  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',kind:'host_action_v2_installer_v1'},",
'});',
"applyHostActionV2=async function(action){if(action==='solo_company_runtime_install_v1')return applySoloCompanyRuntimeInstallV1();return applyHostActionV2Original(action);};"
].join('\n');
const mcp="const HostActionV2=z.enum(['host_action_v2_installer_v1','imotion_marketing_target_register_v1']);";

test('fixed owner operation is explicitly critical, not L3 and source-only',()=>{
  assert.equal(p.ACTION,'universal_existing_stateful_service_observe_adoption_v2');
  assert.equal(p.OPERATION,'host_action.'+p.ACTION);
  assert.equal(p.DRIVER_SHA,'d9d4a3a5d4cb6e6fe6744637e73113c6759709f9');
  const out=p.patchBase(base);
  assert.match(out,/host_action\.universal_existing_stateful_service_observe_adoption_v2/);
  assert.doesNotMatch(out.split('HOST_ACTION_V2_LEVEL3')[1],/universal_existing_stateful_service_observe_adoption_v2/);
  assert.equal(out.split(p.ACTION).length,2);
});

test('executor action delegates exclusively to reviewed existing canonical root driver',()=>{
  const out=p.patchExec(exec);
  assert.match(out,/solo-universal-v2-native-root-dispatcher-v1\.cjs/);
  assert.match(out,/d9d4a3a5d4cb6e6fe6744637e73113c6759709f9/);
  assert.match(out,/applyAuthorizedRelease\(\)/);
  assert.match(out,/managed_for_deployment!==false/);
  assert.match(out,/source_directory_untrusted/);
  assert.match(out,/immutable_git_source_drift/);
  assert.doesNotMatch(out,/systemctl restart|deploy-project.*deploy|eval\(/);
  assert.equal(out.split('applySoloUniversalV2A04();').length,2);
});

test('approval policy contains critical, one-use, 180s and exact typed scope',()=>{
  const doc={operations:{'host_action.old':{level:3}},typed_scopes:[],other:'unchanged'};
  const out=JSON.parse(p.patchPolicy(JSON.stringify(doc)));
  const op=out.operations[p.OPERATION];
  assert.equal(op.level,4);
  assert.equal(op.risk,'critical');
  assert.equal(op.one_time_use,true);
  assert.equal(op.requires_second_confirmation,true);
  assert.equal(op.expires_seconds,180);
  assert.equal(out.typed_scopes.length,1);
  assert.equal(out.typed_scopes[0].action,p.ACTION);
  assert.equal(out.typed_scopes[0].operation,p.OPERATION);
  assert.equal(out.other,'unchanged');
  assert.throws(()=>p.patchPolicy(JSON.stringify(out)),/already_defined/);
});

test('MCP allowlist is exact and cannot accidentally add broad command execution',()=>{
  const output=p.patchMcp(mcp);
  assert.match(output,new RegExp(p.ACTION));
  assert.equal(output.split(p.ACTION).length,2);
  assert.throws(()=>p.patchMcp(output),/unique_anchor_missing/);
});

test('preimage SHA drift rejects before assembling a live registration plan',()=>{
  const bad={base,exec,policy:'{"operations":{},"typed_scopes":[]}',mcp};
  assert.throws(()=>p.review(bad),/sha256_preimage_mismatch_base/);
  assert.throws(()=>p.review({...bad,other:''}),/four_exact_sources_required/);
  assert.throws(()=>p.review({}),/four_exact_sources_required/);
  for(const [name,sha] of Object.entries(p.BEFORE))
    assert.match(sha,/^[a-f0-9]{64}$/,name);
});

test('source-only review planner does not expose signer, root mutation or CLI',()=>{
  for(const method of ['install','apply','issuePermit','register','restart','deploy','sign'])
    assert.equal(typeof p[method],'undefined');
  const source=fs.readFileSync(file,'utf8');
  assert.doesNotMatch(source,/fs\.writeFileSync\(/);
  assert.doesNotMatch(source,/cp\.spawnSync\(/);
  assert.doesNotMatch(source,/generateKeyPair\(/);
  const result=cp.spawnSync(process.execPath,[file],{encoding:'utf8'});
  assert.equal(result.status,64);
  assert.match(result.stderr,/SOURCE_ONLY_NO_PRODUCTION_REGISTRATION/);
});
