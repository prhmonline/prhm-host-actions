const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('./agent-api-approval-center-refresh-once-wrapper-v1.js');

test('wrapper binds exact current server and approval baselines',()=>{
  assert.equal(m.BASE_SHA,'02e75837d0c8dacc5984aad676209ec003548a016136779090ab04818feeabf3');
  assert.equal(m.POLICY_SHA,'494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70');
  assert.equal(m.APPROVAL_SERVER_SHA,'de2569e481cd57b105b6a778cee7b32b2575fc88957d993c70760101ba39d13b');
  assert.equal(m.EXPECTED_OLD_APPROVAL_PID,3715344);
  assert.equal(m.SERVICE,'prhm-company-approval.service');
});

test('refresh restarts only exact old approval pid and verifies new pid plus policy',()=>{
  let pid=3715344;const restarts=[];
  const deps={readFile:p=>Buffer.from(p.endsWith('approval-policy.json')?JSON.stringify({version:m.POLICY_VERSION,operations:{[m.REQUIRED_OPERATION]:{level:3}},typed_scopes:[{tool:m.REQUIRED_TOOL,project:'control_plane',environment:'production',action:m.REQUIRED_ACTION,risk:'high',operation:m.REQUIRED_OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]}):'approval-server'),sha:b=>b.toString()==='approval-server'?m.APPROVAL_SERVER_SHA:m.POLICY_SHA,servicePid:()=>pid,restart:s=>{restarts.push(s);pid=4715344},health:()=>({ok:true,service:'prhm-company-approval',policy_version:m.POLICY_VERSION}),sleep:()=>{}};
  const r=m.refreshApprovalOnce(deps);
  assert.deepEqual(restarts,[m.SERVICE]);assert.equal(r.restarted,true);assert.equal(r.before_pid,3715344);assert.equal(r.after_pid,4715344);
});

test('refresh is idempotent after old pid is gone',()=>{
  const restarts=[];
  const deps={readFile:p=>Buffer.from(p.endsWith('approval-policy.json')?JSON.stringify({version:m.POLICY_VERSION,operations:{[m.REQUIRED_OPERATION]:{level:3}},typed_scopes:[{tool:m.REQUIRED_TOOL,project:'control_plane',environment:'production',action:m.REQUIRED_ACTION,risk:'high',operation:m.REQUIRED_OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]}):'approval-server'),sha:b=>b.toString()==='approval-server'?m.APPROVAL_SERVER_SHA:m.POLICY_SHA,servicePid:()=>999999,restart:s=>restarts.push(s),health:()=>({ok:true,service:'prhm-company-approval',policy_version:m.POLICY_VERSION}),sleep:()=>{}};
  const r=m.refreshApprovalOnce(deps);
  assert.deepEqual(restarts,[]);assert.equal(r.restarted,false);assert.equal(r.after_pid,999999);
});
