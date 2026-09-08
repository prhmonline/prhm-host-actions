'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const crypto=require('node:crypto');

const IMPL=path.join(__dirname,'control-plane-installer-refresh-l4-binding-repair-v1.js');
const sha=s=>crypto.createHash('sha256').update(s,'utf8').digest('hex');

test('builds exact dedicated L4 binding while preserving generic L3',()=>{
  const m=require(IMPL);
  const OLD='host_action.control_plane_root_scripts_stage_transport_v1';
  const NEW='host_action.control_plane_installer_refresh_root_stage_v1';
  const policy=JSON.stringify({
    schema_version:'prhm.approval-policy.v1',
    operations:{[OLD]:{level:3,risk:'high'}},
    typed_scopes:[
      {tool:'control_plane_root_scripts_stage_transport_apply_v1',project:'control_plane',environment:'production',action:'control_plane_root_scripts_stage_transport_v1',risk:'high',operation:OLD,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]},
      {tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:'control_plane_root_scripts_stage_transport_v1',risk:'high',operation:OLD,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}
    ]
  },null,2)+'\n';
  const mediator=[
    "export const FIXED_BINDING=Object.freeze({",
    "  principal_id:'mohammad',",
    "  role:'mcp-operator',",
    "  tool:'control_plane_root_scripts_stage_transport_apply_v1',",
    "  project:'control_plane',",
    "  environment:'production',",
    "  action:'control_plane_root_scripts_stage_transport_v1',",
    "  risk:'critical',",
    "  operation:'"+OLD+"'",
    "});",
    "export const CONFIRM_LITERAL='CONFIRM_LEVEL_4_CRITICAL';",
    "if(Number(request.level)!==4)throw new Error('request_binding_mismatch');",
    "if(String(second_confirmation||'')!==CONFIRM_LITERAL)throw new Error('critical_second_confirmation_required');"
  ].join('\n')+'\n';

  const out=m.buildCandidates(policy,mediator);
  const p=JSON.parse(out.policy);
  assert.equal(p.operations[OLD].level,3);
  assert.equal(p.operations[OLD].risk,'high');
  assert.equal(p.operations[NEW].level,4);
  assert.equal(p.operations[NEW].risk,'critical');
  assert.equal(p.operations[NEW].requires_second_confirmation,true);
  assert.equal(p.operations[NEW].one_time_use,true);
  const scopes=p.typed_scopes.filter(x=>x.operation===NEW);
  assert.equal(scopes.length,1);
  assert.deepEqual(scopes[0],{
    tool:'control_plane_root_scripts_stage_transport_apply_v1',
    project:'control_plane',
    environment:'production',
    action:'control_plane_root_scripts_stage_transport_v1',
    risk:'critical',
    operation:NEW,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
  });
  assert.match(out.mediator,/host_action\.control_plane_installer_refresh_root_stage_v1/);
  assert.doesNotMatch(out.mediator,/risk:'high'|CONFIRM_LEVEL_3_PRODUCTION/);
  assert.equal(out.production_mutation,false);
});

test('installer source is fixed SHA-bound transactional and rollback-safe',()=>{
  const m=require(IMPL);
  assert.equal(m.POLICY_SHA256,'494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70');
  assert.equal(m.MEDIATOR_SHA256,'e8fc3f5185f01efeca5563490461566f64fc8bda1534bad5a3c39e73a7108abb');
  const s=m.buildInstallerSource();
  for(const x of [
    '/opt/prhm-company-control-plane/config/approval-policy.json',
    '/opt/prhm-company-control-plane/root-scripts-stage-mediator-v1/control-plane-root-scripts-stage-mediator-v1.js',
    '/var/backups/prhm-installer-refresh-l4-binding-repair-v1',
    'prhm-company-approval.service',
    'prhm-root-scripts-stage-mediator-v1.service',
    'baseline_drift',
    'candidate_sha_mismatch',
    '--check',
    'JSON.parse',
    'rollback',
    'production_mutation:true'
  ]) assert.ok(s.includes(x),x);
  assert.doesNotMatch(s,/req\.body|destinationPath|callerContent|process\.argv\[[23]/);
  assert.match(m.INSTALLER_SOURCE_SHA256,/^[a-f0-9]{64}$/);
  assert.equal(m.INSTALLER_SOURCE_SHA256,sha(s));
});
