'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('./control-plane-typed-bootstrap-fixed-verifier-native-install-v1.js');

const currentSha={...m.BASELINE_SHA};
const base=`const HOST_ACTIONS_V2={
  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' }
};`;
const executor=`const HOST_ACTIONS_V2={
  imotion_credential_bind_v1:{operation:'host_action.imotion_credential_bind_v1',kind:'imotion_credential_bind_v1'}
};
applyHostActionV2=async function(action){return applyHostActionV2Original(action);};`;
const mcp=`const HostActionV2=z.enum(['agent_api_process_sandbox_v1','imotion_credential_bind_v1']);`;
const policy=JSON.stringify({schema_version:'prhm.approval-policy.v1',default_deny:true,one_time_use:true,levels:{'4':{second_confirmation_required:true}},operations:{'host_action.imotion_credential_bind_v1':{level:4}}},null,2)+'\n';
const input=()=>({baseSource:base,executorSource:executor,mcpSource:mcp,policySource:policy,currentSha:{...currentSha}});

test('fixed native installer contract is zero-input and current-baseline bound',()=>{
 assert.equal(m.ACTION,'control_plane_typed_bootstrap_fixed_verifier_native_install_v1');
 assert.equal(m.TARGET_ACTION,'control_plane_typed_bootstrap_fixed_verifier_bootstrap_v1');
 assert.equal(m.VERIFIER_SHA,'f5e3cb6a9ce6c88229ffbd2fafd1e48742562f8c3edbc7aac113e2cb4f292b5a');
 assert.equal(m.BOOTSTRAP_COMMIT,'0d40e9e051cc39d23fed106fd7b301c7e1654568');
 assert.equal(m.LEVEL4_REQUIRED,true); assert.equal(m.ZERO_INPUT,true);
 assert.deepEqual(m.BASELINE_SHA,{base:'e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd',executor:'1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd',mcp:'44520b67bb352ab243698c5cf50b39d09a65c833fee9cfd3ebc5a50379ecaa71',policy:'76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d'});
});
for(const k of ['base','executor','mcp','policy']) test('fails closed on '+k+' baseline drift',()=>{const i=input();i.currentSha[k]='0'.repeat(64);assert.throws(()=>m.planNativeInstall(i),new RegExp('baseline_drift:'+k));});
test('planner registers only the fixed target in all four surfaces',()=>{const p=m.planNativeInstall(input());assert.match(p.after.base,/control_plane_typed_bootstrap_fixed_verifier_bootstrap_v1/);assert.match(p.after.executor,/applyControlPlaneTypedBootstrapFixedVerifierBootstrapV1/);assert.match(p.after.mcp,/control_plane_typed_bootstrap_fixed_verifier_bootstrap_v1/);const po=JSON.parse(p.after.policy);assert.deepEqual(po.operations[m.TARGET_OPERATION],{level:4});assert.equal(p.level4_required,true);assert.equal(p.zero_input,true);});
test('rejects conflicting pre-registration on each code surface',()=>{for(const key of ['baseSource','executorSource','mcpSource']){const i=input();i[key]+='\n'+m.TARGET_ACTION;assert.throws(()=>m.planNativeInstall(i),/conflict/);}});
test('rejects missing and ambiguous anchors',()=>{let i=input();i.baseSource='x';assert.throws(()=>m.planNativeInstall(i),/base_anchor_missing/);i=input();i.mcpSource=mcp+"\n'imotion_credential_bind_v1'";assert.throws(()=>m.planNativeInstall(i),/mcp_enum_anchor_ambiguous/);});
test('rejects malformed policy and conflicting policy operation',()=>{let i=input();i.policySource='{';assert.throws(()=>m.planNativeInstall(i),/policy_json_invalid/);i=input();let p=JSON.parse(policy);p.operations[m.TARGET_OPERATION]={level:3};i.policySource=JSON.stringify(p);assert.throws(()=>m.planNativeInstall(i),/policy_target_conflict/);});
test('execution contract rejects every arbitrary input surface',()=>{for(const k of ['command','path','repo','payload','url','host','service','sql','credential','args'])assert.throws(()=>m.validateExecutionContract({[k]:'x'}),/arbitrary_input_rejected/);assert.equal(m.validateExecutionContract({}).level4_required,true);});
for(const point of ['base','executor','mcp','policy']) test('rollback restores exact before-images after '+point+' failure',()=>{const i=input();const r=m.simulateTransactionalInstall(i,point);assert.equal(r.ok,false);assert.equal(r.rollbackPerformed,true);assert.deepEqual(r.state,{base:i.baseSource,executor:i.executorSource,mcp:i.mcpSource,policy:i.policySource});});
test('successful transaction reports no rollback',()=>{const r=m.simulateTransactionalInstall(input(),null);assert.equal(r.ok,true);assert.equal(r.rollbackPerformed,false);});

test('second identical run is idempotent and reports unchanged',()=>{
  const first=m.planNativeInstall(input());
  const secondInput={baseSource:first.after.base,executorSource:first.after.executor,mcpSource:first.after.mcp,policySource:first.after.policy,currentSha:{...currentSha}};
  const second=m.planNativeInstall(secondInput);
  assert.equal(second.changed,false);
  assert.deepEqual(second.after,second.before);
});

test('source contains no forbidden execution surfaces',()=>{const fs=require('node:fs');const s=fs.readFileSync(require.resolve('./control-plane-typed-bootstrap-fixed-verifier-native-install-v1.js'),'utf8');for(const x of ['sshpass','systemd-run','park_bazar_migrate_v1','DROP DATABASE','CREATE DATABASE','honartik_git_worktree_fixed_v1','ProtectHome=','ReadWritePaths='])assert.equal(s.includes(x),false,x);});

test('manifest binds tested repository bytes',()=>{
  const fs=require('node:fs'); const crypto=require('node:crypto');
  const manifest=JSON.parse(fs.readFileSync('./control-plane-typed-bootstrap-fixed-verifier-native-install-v1.manifest.json','utf8'));
  const h=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  assert.equal(manifest.schema_version,'prhm.control-plane-typed-bootstrap-fixed-verifier-native-install-manifest.v1');
  assert.equal(manifest.action,m.ACTION); assert.equal(manifest.target_action,m.TARGET_ACTION);
  assert.equal(manifest.verifier_sha256,m.VERIFIER_SHA); assert.equal(manifest.level4_required,true); assert.equal(manifest.zero_input,true); assert.equal(manifest.park_production_mutation,false);
  assert.deepEqual(manifest.baseline_sha,m.BASELINE_SHA);
  assert.equal(manifest.implementation_sha256,h('./control-plane-typed-bootstrap-fixed-verifier-native-install-v1.js'));
  assert.equal(manifest.test_sha256,h('./test-v1-control-plane-typed-bootstrap-fixed-verifier-native-install.js'));
});
