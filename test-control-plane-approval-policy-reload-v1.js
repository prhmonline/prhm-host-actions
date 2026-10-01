'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const MOD='./control-plane-approval-policy-reload-v1.js';
const ACTION='control_plane_current_owner_bootstrap_repair_v1';
const VERSION='2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1';

function exactPolicy(){return {
  version:VERSION,
  operations:{['host_action.'+ACTION]:{level:4}},
  typed_scopes:[{
    tool:'host_action_v2_apply',project:'control_plane',environment:'production',
    action:ACTION,risk:'critical',operation:'host_action.'+ACTION,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
  }]
};}

function fakeAdapter(h,{loaded=false,badPost=false,badPolicy=false}={}){
  const p=badPolicy?{version:'bad',operations:{},typed_scopes:[]}:exactPolicy();
  const runtimeHash=h.__test.runtimePolicyHash(p);
  let restarts=0;
  return {
    policy:()=>p,
    policySha:()=>h.manifest().expected_policy_sha256,
    serviceActive:async()=>true,
    health:async()=>{
      const fresh=loaded||restarts>0;
      return {ok:true,service:'prhm-company-approval',policy_version:fresh?VERSION:'old',policy_hash:badPost&&restarts?'bad':(fresh?runtimeHash:'old')};
    },
    restart:async service=>{assert.equal(service,'prhm-company-approval.service');restarts++;},
    restartCount:()=>restarts
  };
}

test('manifest is fixed zero-input and non-database',()=>{
  const h=require(MOD),m=h.manifest();
  assert.equal(m.action,ACTION);assert.equal(m.service,'prhm-company-approval.service');
  assert.equal(m.zero_input,true);assert.equal(m.database_mutation,false);assert.equal(m.arbitrary_command,false);assert.equal(m.arbitrary_path,false);
});

test('stale cached policy reloads exactly once',async()=>{
  const h=require(MOD),a=fakeAdapter(h),r=await h.apply(a);
  assert.equal(r.result,'SUCCEEDED');assert.equal(r.service_control,true);assert.equal(a.restartCount(),1);
});

test('already loaded policy is idempotent',async()=>{
  const h=require(MOD),a=fakeAdapter(h,{loaded:true}),r=await h.apply(a);
  assert.equal(r.result,'ALREADY_APPLIED');assert.equal(a.restartCount(),0);
});

test('wrong policy contract fails before restart',async()=>{
  const h=require(MOD),a=fakeAdapter(h,{badPolicy:true});
  await assert.rejects(()=>h.apply(a),/policy_contract_mismatch/);assert.equal(a.restartCount(),0);
});

test('bad post-reload health fails closed',async()=>{
  const h=require(MOD),a=fakeAdapter(h,{badPost:true});
  await assert.rejects(()=>h.apply(a),/approval_reload_postcondition_failed/);
});

test('unexpected cli argument is denied',()=>{
  const h=require(MOD);assert.throws(()=>h.main(['x']),/unexpected_cli_argument/);
});
