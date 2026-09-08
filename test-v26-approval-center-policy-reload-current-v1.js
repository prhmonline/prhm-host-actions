const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('./bootstrap-host-actions-v26-approval-center-policy-reload-current-v1.js');

test('contract is fixed and zero-input',()=>{
  assert.equal(m.ACTION,'approval_center_policy_reload_v1');
  assert.equal(m.POLICY_VERSION,'2026-09-05.3-autonomous-operator-v1');
  assert.equal(m.POLICY_SHA,'494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70');
  assert.equal(m.APPROVAL_SERVER_SHA,'de2569e481cd57b105b6a778cee7b32b2575fc88957d993c70760101ba39d13b');
  assert.equal(m.SERVICE,'prhm-company-approval.service');
  assert.equal(m.REQUIRED_OPERATION,'host_action.control_plane_root_scripts_stage_transport_v1');
  assert.equal(m.REQUIRED_TOOL,'host_action_v2_apply');
  assert.equal(m.REQUIRED_ACTION,'control_plane_root_scripts_stage_transport_v1');
});

test('preflight validates policy and server without mutation',()=>{
  const policy={version:m.POLICY_VERSION,operations:{[m.REQUIRED_OPERATION]:{level:3}},typed_scopes:[{tool:m.REQUIRED_TOOL,project:'control_plane',environment:'production',action:m.REQUIRED_ACTION,risk:'high',operation:m.REQUIRED_OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]};
  const deps={readFile:(p)=>{if(p===m.POLICY_PATH)return Buffer.from(JSON.stringify(policy));if(p===m.APPROVAL_SERVER_PATH)return Buffer.from('server');throw new Error('bad path')},sha:(buf)=>buf.toString()==='server'?m.APPROVAL_SERVER_SHA:m.POLICY_SHA,servicePid:()=>123,health:()=>({ok:true,service:'prhm-company-approval',policy_version:'old'})};
  const r=m.preflight(deps);
  assert.equal(r.ok,true);assert.equal(r.preflight_only,true);assert.equal(r.file_mutation,false);assert.equal(r.database_mutation,false);assert.equal(r.service_restart,false);
});

test('apply restarts only approval service and verifies pid change plus live policy version',()=>{
  const policy={version:m.POLICY_VERSION,operations:{[m.REQUIRED_OPERATION]:{level:3}},typed_scopes:[{tool:m.REQUIRED_TOOL,project:'control_plane',environment:'production',action:m.REQUIRED_ACTION,risk:'high',operation:m.REQUIRED_OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]};
  let pid=111;const calls=[];
  const deps={readFile:(p)=>{if(p===m.POLICY_PATH)return Buffer.from(JSON.stringify(policy));if(p===m.APPROVAL_SERVER_PATH)return Buffer.from('server');throw new Error('bad path')},sha:(buf)=>buf.toString()==='server'?m.APPROVAL_SERVER_SHA:m.POLICY_SHA,servicePid:()=>pid,restart:(service)=>{calls.push(service);pid=222},health:()=>({ok:true,service:'prhm-company-approval',policy_version:m.POLICY_VERSION}),sleep:()=>{}};
  const r=m.apply(deps);
  assert.deepEqual(calls,[m.SERVICE]);assert.equal(r.ok,true);assert.equal(r.service_restart,true);assert.equal(r.before_pid,111);assert.equal(r.after_pid,222);assert.equal(r.file_mutation,false);assert.equal(r.database_mutation,false);
});
