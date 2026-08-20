'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const implPath=path.join(__dirname,'bootstrap-host-actions-agent-zdt-existing-topology-rolling-refresh-v1.js');
function implementation(){delete require.cache[require.resolve(implPath)];return require(implPath);}
const APPLY='agent_zdt_existing_topology_rolling_refresh_v1';
const ROLLBACK='agent_zdt_existing_topology_rolling_refresh_rollback_v1';
const FINALIZE='agent_zdt_existing_topology_rolling_refresh_finalize_v1';
const ACTIONS=[APPLY,ROLLBACK,FINALIZE];

test('installer exists',()=>assert.equal(fs.existsSync(implPath),true,'installer must exist'));

test('installer pins exact three actions, helper and live four-layer baseline',()=>{
  const m=implementation();
  assert.deepEqual(m.TARGET_ACTIONS,ACTIONS);
  assert.equal(m.HELPER_SHA,'71bd4afde341148f85f8264c6a07cae924caa23c1be59eb1c14d8ed25bb70381');
  assert.deepEqual(m.BEFORE,{
    mcp:'4432f904eaea786d6c184ffee10577402d3620484680f4e2e8d116dd9f8b3bba',
    base:'849a86143358e7208e9c641604676875dac8972f25364ee262fb6778cb79a13f',
    exec:'ff1034c25d8878d75af087ea570d6387a094b409dabe17b00134bfe02082d90b',
    policy:'ad935f12e427597cf972670b8ee1eccfc4b74bb6a666dde3ffe00db077187e10'
  });
});

test('patchMcp inserts all three fixed actions exactly once into enum',()=>{
  const {patchMcp}=implementation();
  const src="const HostActionV2=z.enum(['agent_zero_downtime_bootstrap_v1','host_action_v2_installer_v1','imotion_marketing_target_register_v1','drtarjomeh_security_containment_v1']);\n";
  const out=patchMcp(src);
  for(const a of ACTIONS) assert.equal(out.split(`'${a}'`).length-1,1);
  assert.match(out,/imotion_marketing_target_register_v1/);
});

test('patchBase appends three fixed rollback-aware specs',()=>{
  const {patchBase}=implementation();
  const src="  imotion_marketing_target_register_v1: { operation: 'host_action.imotion_marketing_target_register_v1', rollback: 'host-action-v2:imotion-marketing-target-register-v1:source-restore' },\n  drtarjomeh_security_containment_v1: { operation: 'host_action.drtarjomeh_security_containment_v1', rollback: 'host-action-v2:drtarjomeh-security-containment-v1:backup-restore' }\n});\n";
  const out=patchBase(src);
  for(const a of ACTIONS){assert.match(out,new RegExp(a));assert.match(out,new RegExp(`host_action\\.${a}`));}
  assert.match(out,/rolling-refresh-v1:evidence-restore/);
});

test('patchExec registers three specs and fixed phase dispatch without caller-controlled mode',()=>{
  const {patchExec}=implementation();
  const src=[
    "  imotion_marketing_target_register_v1:{operation:'host_action.imotion_marketing_target_register_v1',kind:'imotion_marketing_target_register_v1'},",
    "  drtarjomeh_security_containment_v1: { operation: 'host_action.drtarjomeh_security_containment_v1', kind: 'drtarjomeh_security_containment_v1' }",
    "});",
    "const applyHostActionV2Original=applyHostActionV2;",
    "applyHostActionV2=async function(action){",
    "if(action==='drtarjomeh_security_containment_v1')return applyDrTarjomehSecurityContainmentV1();if(action==='imotion_marketing_target_register_v1')return applyImotionMarketingTargetRegisterV1();if(action==='host_action_v2_installer_v1')return applyHostActionV2InstallerV1();if(action==='agent_zero_downtime_bootstrap_v1')return applyAgentZeroDowntimeBootstrapV1();return applyHostActionV2Original(action);};"
  ].join('\n');
  const out=patchExec(src);
  for(const a of ACTIONS) assert.match(out,new RegExp(a));
  assert.match(out,/--apply/);assert.match(out,/--rollback/);assert.match(out,/--finalize/);
  assert.match(out,/applyAgentZdtExistingTopologyRollingApplyV1/);
  assert.match(out,/applyAgentZdtExistingTopologyRollingRollbackV1/);
  assert.match(out,/applyAgentZdtExistingTopologyRollingFinalizeV1/);
  assert.equal(/process\.argv\[[^\]]+\].*--apply/.test(out),false);
});

test('patchPolicy registers three independent Level-4 operations and typed scopes exactly once',()=>{
  const {patchPolicy}=implementation();
  const src=JSON.stringify({operations:{'host_action.imotion_marketing_target_register_v1':{level:4}},enabled:true,scope_state:'selfmaint-drtarjomeh-production',scope_freeze:true,typed_scopes:[{tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:'imotion_marketing_target_register_v1',risk:'critical',operation:'host_action.imotion_marketing_target_register_v1',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]},null,2)+'\n';
  const out=JSON.parse(patchPolicy(src));
  for(const a of ACTIONS){
    assert.deepEqual(out.operations[`host_action.${a}`],{level:4});
    const scopes=out.typed_scopes.filter(x=>x.action===a);
    assert.equal(scopes.length,1);
    assert.equal(scopes[0].tool,'host_action_v2_apply');
    assert.equal(scopes[0].risk,'critical');
    assert.deepEqual(scopes[0].principals,[{principal_id:'mohammad',roles:['mcp-operator']}]);
  }
});

test('installer has no caller-controlled command, path, phase or action arguments',()=>{
  const s=fs.readFileSync(implPath,'utf8');
  assert.equal(/process\.argv\[[^\]]+\]/.test(s),false);
  assert.match(s,/const TARGET_ACTIONS=Object\.freeze/);
  assert.match(s,/const PHASE_BY_ACTION=Object\.freeze/);
  assert.match(s,/agent-zdt-existing-topology-rolling-refresh-v1\.js/);
});
