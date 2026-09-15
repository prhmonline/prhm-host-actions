'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');

const mod=require('./bootstrap-host-actions-readonly-bridge-repair-v1.js');
const sha=b=>crypto.createHash('sha256').update(Buffer.from(b)).digest('hex');

const FIXTURE=Object.freeze({
  base:`const HOST_ACTION_V2_SPECS = Object.freeze({\n  host_action_v2_installer_v1: { operation: 'host_action.host_action_v2_installer_v1', rollback: 'host-action-v2:host-action-v2-installer-v1:four-file-restore' },\n  control_plane_root_scripts_stage_transport_v1: { operation: 'host_action.control_plane_root_scripts_stage_transport_v1', rollback: 'host-action-v2:control-plane-root-scripts-stage-transport-v1:backup-restore' }\n});\n`,
  exec:`const HOST_ACTION_V2_SPECS = Object.freeze({\n  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',kind:'host_action_v2_installer_v1'},\n  control_plane_root_scripts_stage_transport_v1:{operation:'host_action.control_plane_root_scripts_stage_transport_v1',kind:'control_plane_root_scripts_stage_transport_v1'}\n});\nasync function applyHostActionV2(action){return action;}\nconst applyHostActionV2Original=applyHostActionV2;\napplyHostActionV2=async function(action){if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();return applyHostActionV2Original(action);};\n`,
  policy:JSON.stringify({
    schema_version:'prhm.approval-policy.v1',
    version:'test-policy',
    default_deny:true,
    one_time_use:true,
    levels:{'4':{max_ttl_seconds:180}},
    operations:{'host_action.host_action_v2_installer_v1':{level:4}},
    typed_scopes:[{
      action:'host_action_v2_installer_v1',environment:'production',
      operation:'host_action.host_action_v2_installer_v1',
      principals:[{principal_id:'mohammad',roles:['mcp-operator']}],
      project:'control_plane',risk:'critical',tool:'host_action_v2_apply'
    }]
  },null,2)+'\n',
  mcp:`const HostActionV2=z.enum(['host_action_v2_installer_v1','control_plane_root_scripts_stage_transport_v1']);\n`
});

test('installer constants are fixed to readonly bridge repair and current active MCP topology',()=>{
  assert.equal(mod.ACTION,'readonly_bridge_repair_registration_v1');
  assert.equal(mod.TARGET_ACTION,'readonly_bridge_repair_v1');
  assert.equal(mod.OPERATION,'host_action.readonly_bridge_repair_v1');
  assert.equal(mod.HELPER_SHA256,'068b519c3d0f23bd56eed84750e0cb74e44001250b81a08830e1baf61c928622');
  assert.deepEqual(mod.CORE_SERVICES,[
    'prhm-company-approval.service',
    'prhm-agent-selfmaint.service',
    'prhm-agent-selfmaint-exec.service'
  ]);
  assert.deepEqual(mod.MCP_LANES,[
    'prhm-agent-mcp-blue.service',
    'prhm-agent-mcp-green.service'
  ]);
  const all=[...mod.CORE_SERVICES,...mod.MCP_LANES];
  assert.equal(all.includes('prhm-agent-mcp.service'),false);
  assert.equal(all.includes('prhm-agent-mcp-router.service'),false);
  assert.equal(all.some(x=>x.includes('legacy')),false);
  assert.equal(all.some(x=>x.includes('recovery')),false);
});

test('buildCandidates adds exactly one bounded registration in all four owners',()=>{
  const next=mod.buildCandidates(FIXTURE);
  for(const key of ['base','exec','policy','mcp'])assert.equal(typeof next[key],'string');
  assert.equal((next.base.match(/readonly_bridge_repair_v1/g)||[]).length,2);
  assert.match(next.exec,/readonly_bridge_repair_v1/);
  assert.match(next.exec,new RegExp(mod.HELPER_SHA256));
  assert.match(next.exec,/--apply/);
  assert.match(next.mcp,/readonly_bridge_repair_v1/);
  const policy=JSON.parse(next.policy);
  assert.deepEqual(policy.operations[mod.OPERATION],{level:4,risk:'critical'});
  const scopes=policy.typed_scopes.filter(x=>x.operation===mod.OPERATION);
  assert.equal(scopes.length,1);
  assert.deepEqual(scopes[0],{
    action:mod.TARGET_ACTION,
    environment:'production',
    operation:mod.OPERATION,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}],
    project:'control_plane',
    risk:'critical',
    tool:'host_action_v2_apply'
  });
  assert.equal(policy.default_deny,true);
  assert.equal(policy.one_time_use,true);
  assert.equal(policy.levels['4'].max_ttl_seconds,180);
});

test('duplicate registration fails closed',()=>{
  const once=mod.buildCandidates(FIXTURE);
  assert.throws(()=>mod.buildCandidates(once),/already_registered|duplicate/i);
});

test('malformed owner anchors fail closed',()=>{
  assert.throws(()=>mod.buildCandidates({...FIXTURE,base:'const nope=true;\n'}),/anchor|spec/i);
  assert.throws(()=>mod.buildCandidates({...FIXTURE,mcp:'const nope=true;\n'}),/anchor|enum/i);
  assert.throws(()=>mod.buildCandidates({...FIXTURE,exec:'const nope=true;\n'}),/anchor|dispatcher|exec/i);
});

test('registration plan is deterministic, source-free and binds all live/candidate hashes',()=>{
  const current=Object.fromEntries(Object.entries(FIXTURE).map(([k,v])=>[k,sha(v)]));
  const candidates=mod.buildCandidates(FIXTURE);
  const candidate=Object.fromEntries(Object.entries(candidates).map(([k,v])=>[k,sha(v)]));
  candidate.helper=mod.HELPER_SHA256;
  const a=mod.buildRegistrationPlan(current,candidate);
  const b=mod.buildRegistrationPlan({...current},{...candidate});
  assert.deepEqual(a,b);
  assert.match(a.plan_sha256,/^[0-9a-f]{64}$/);
  assert.deepEqual(a.current_sha256,current);
  assert.deepEqual(a.candidate_sha256,candidate);
  assert.equal(a.target_action,mod.TARGET_ACTION);
  assert.equal(JSON.stringify(a).includes(FIXTURE.exec),false);
});

test('plan digest changes on any owner drift and assertPlanStillValid rejects stale plans',()=>{
  const current=Object.fromEntries(Object.entries(FIXTURE).map(([k,v])=>[k,sha(v)]));
  const candidates=mod.buildCandidates(FIXTURE);
  const candidate=Object.fromEntries(Object.entries(candidates).map(([k,v])=>[k,sha(v)]));
  candidate.helper=mod.HELPER_SHA256;
  const plan=mod.buildRegistrationPlan(current,candidate);
  const drift={...current,mcp:'0'.repeat(64)};
  const driftPlan=mod.buildRegistrationPlan(drift,candidate);
  assert.notEqual(plan.plan_sha256,driftPlan.plan_sha256);
  assert.throws(()=>mod.assertPlanStillValid(plan,drift,candidate),/plan|drift|sha/i);
  assert.equal(mod.assertPlanStillValid(plan,current,candidate),true);
});

test('known readable production SHA pins are exact',()=>{
  assert.equal(mod.KNOWN_BASELINE.exec,'451c5a4762a4c7a04d64d526a79cf6e86b0cf7c978c559cf303d874e0f08fc48');
  assert.equal(mod.KNOWN_BASELINE.policy,'494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70');
  assert.equal(mod.KNOWN_BASELINE.base,null);
  assert.equal(mod.KNOWN_BASELINE.mcp,null);
});

test('helper executor contract is narrowly scoped',()=>{
  const next=mod.buildCandidates(FIXTURE);
  assert.match(next.exec,/readonly-bridge-repair-v1\.js/);
  assert.match(next.exec,/\/etc\/prhm-readonly-http\.env/);
  assert.match(next.exec,/\/var\/backups\/prhm-readonly-bridge-repair-v1/);
  assert.doesNotMatch(next.exec,/docker|mysql|mariadb|postgres|nginx|httpd/);
  assert.doesNotMatch(next.exec,/prhm-recovery-agent\.service/);
});
