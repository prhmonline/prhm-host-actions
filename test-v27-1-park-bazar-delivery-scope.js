
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('./bootstrap-host-actions-v27-park-bazar-delivery.js');

test('Park delivery is Level-3 high and not critical',()=>{
  const p={schema_version:'prhm.approval-policy.v1',version:'2026-09-05.3-autonomous-operator-v1',operations:{},typed_scopes:[]};
  const out=JSON.parse(m.buildPolicyCandidate(JSON.stringify(p)));
  assert.deepEqual(out.operations[m.OPERATION],{
    level:3,risk:'high',requires_second_confirmation:false,one_time_use:true,requested_approver:'mohammad',expires_seconds:180,policy_version:m.POLICY_VERSION,rollback_reference:'host-action-v2:park-bazar-delivery-patch-v1:file-rollback'
  });
  assert.equal(out.typed_scopes[0].risk,'high');
});

test('Park executor sandbox writes only tenant app plus action backup/result state',()=>{
  const src=[
    "control_plane_root_scripts_stage_transport_v1:{operation:'host_action.control_plane_root_scripts_stage_transport_v1',kind:'control_plane_root_scripts_stage_transport_v1'},};",
    "if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();"
  ].join('\n');
  const out=m.buildExecCandidate(src,'f'.repeat(64));
  assert.ok(out.includes("--property=ReadWritePaths=/home/cfpark/domains/dashboard.park.prhm.ir/public_html/app /var/backups/park-bazar-delivery-v27 /var/lib/prhm-agent-selfmaint-exec/park-bazar-delivery-patch-v1"));
  assert.equal(out.includes('ReadWritePaths=/home/cfpark '),false);
});

test('Park helper pins exact release commit and final file SHAs without runtime git worktree',()=>{
  const h=m.buildHelperSource();
  assert.ok(h.includes("const RELEASE_COMMIT='451501c30fb4fcb71ce4220cacb0bee169796399'"));
  for(const sha of [
    'f065f436e934c4b5f13d35012bc5e94099cc2879fd8f2f3a8128e70ebe48d755',
    '6dbc336c45ab3157b39050c78077a254f3229bba89983e06380cc2acc29d587e',
    '0f4aaee23daba71468f3780fd85e0d63de5ba87854f527141cacdc03d2f730ce'
  ]) assert.ok(h.includes(sha));
  assert.equal(h.includes('git worktree'),false);
  assert.equal(h.includes("'/usr/bin/git'"),false);
});
