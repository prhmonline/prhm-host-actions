'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const g=require('./deploy-control-l4-registration-readiness-v1.cjs');
const c=require('./deploy-control-cutover-contract-v1.cjs');

const files=['PRHM_L4_POLICY_LIVE','PRHM_L4_POLICY_CANDIDATE','PRHM_L4_AGENT_HEALTH']
  .map(x=>process.env[x]);
test('strict operation matches original immutable source-review contract',()=>{
  assert.equal(g.ACTION,c.CONTRACT.action);
  assert.equal(g.OPERATION,c.CONTRACT.operation);
  assert.deepEqual(Object.keys(g).sort(),['ACTION','EXPECTED','OPERATION','inspect'].sort());
});
test('policy and registration snapshots are mandatory, not implied by an action name',()=>{
  for(const args of [{},{policy:{},health:{}},{policy:{operations:{},typed_scopes:[]},health:{}}])
    assert.throws(()=>g.inspect(args),/invalid_policy|invalid_registry_health/);
});

if(!files.every(Boolean)){
  test('authentic policy and Agent 3 health fixtures are required',{skip:'Provide three pinned read-only fixtures'},()=>{});
}else{
  const [live,candidate,health]=files.map(x=>JSON.parse(fs.readFileSync(x,'utf8')));
  const copy=x=>structuredClone(x);
  const criticalOperation={
    level:4,risk:'critical',requires_second_confirmation:true,
    one_time_use:true,requested_approver:'mohammad',expires_seconds:180
  };
  const criticalScope={...g.EXPECTED,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]};
  const proposed=()=>{
    const p=copy(candidate);
    p.operations[g.OPERATION]=copy(criticalOperation);
    p.typed_scopes.push(copy(criticalScope));
    const h=copy(health);
    h.host_actions_v2.push(g.ACTION);
    return {policy:p,health:h};
  };
  test('authentic live policy and registered actions prove L4 installer is ABSENT',()=>{
    const result=g.inspect({policy:live,health});
    assert.equal(live.typed_scopes.length,52);
    assert.equal(Object.keys(live.operations).length,75);
    assert.equal(result.source_review_gates_present,false);
    assert.equal(result.approved,false);
    assert.equal(result.may_install,false);
    assert.equal(result.existing_generic_installer_level,3);
    assert.ok(result.blockers.includes('dedicated_l4_operation_not_allowlisted'));
    assert.ok(result.blockers.includes('dedicated_l4_typed_scope_absent_or_invalid'));
    assert.ok(result.blockers.includes('dedicated_fixed_action_not_registered'));
  });
  test('reviewed policy candidate has three release scopes but NO L4 installer scope',()=>{
    const result=g.inspect({policy:candidate,health});
    assert.equal(candidate.typed_scopes.length,55);
    assert.equal(Object.keys(candidate.operations).length,75);
    assert.equal(result.source_review_gates_present,false);
    assert.equal(result.approved,false);
    assert.equal(result.may_install,false);
    assert.ok(result.blockers.includes('dedicated_l4_operation_not_allowlisted'));
    assert.ok(result.blockers.includes('dedicated_l4_typed_scope_absent_or_invalid'));
  });
  test('synthetic fully typed L4 action satisfies only source review, never authorizes execution',()=>{
    const out=g.inspect(proposed());
    assert.equal(out.source_review_gates_present,true);
    assert.deepEqual(out.blockers,[]);
    assert.equal(out.existing_generic_installer_level,3);
    assert.equal(out.approved,false);
    assert.equal(out.execution_authorized,false);
    assert.equal(out.may_install,false);
  });
  test('Level-3 action cannot masquerade as independent critical Level-4 permission',()=>{
    const x=proposed();x.policy.operations[g.OPERATION].level=3;
    assert.ok(g.inspect(x).blockers.includes('dedicated_l4_operation_contract_mismatch'));
  });
  test('missing second confirmation, one-time use, or human approver blocks installation',()=>{
    for(const key of ['requires_second_confirmation','one_time_use','requested_approver']){
      const x=proposed();
      x.policy.operations[g.OPERATION][key]=key==='requested_approver'?'service-account':false;
      assert.ok(g.inspect(x).blockers.includes('dedicated_l4_operation_contract_mismatch'),key);
    }
    const x=proposed();x.policy.levels['4'].human_approval=false;
    assert.ok(g.inspect(x).blockers.includes('critical_human_authorization_not_enforced'));
  });
  test('wrong scope project, wildcard principal, multiple principals and duplicate fail',()=>{
    for(const mutant of [
      s=>s.project='*',s=>s.principals[0].principal_id='*',
      s=>s.principals.push({principal_id:'admin',roles:['mcp-operator']}),
      s=>s.principals[0].roles.push('admin')
    ]){
      const x=proposed();mutant(x.policy.typed_scopes.at(-1));
      assert.ok(g.inspect(x).blockers.includes('dedicated_l4_typed_scope_absent_or_invalid'));
    }
    const x=proposed();x.policy.typed_scopes.push(copy(criticalScope));
    assert.ok(g.inspect(x).blockers.includes('dedicated_l4_typed_scope_absent_or_invalid'));
  });
  test('missing and duplicate registered tool fail even with a seemingly valid policy',()=>{
    const a=proposed();a.health.host_actions_v2=a.health.host_actions_v2.filter(x=>x!==g.ACTION);
    assert.ok(g.inspect(a).blockers.includes('dedicated_fixed_action_not_registered'));
    const b=proposed();b.health.host_actions_v2.push(g.ACTION);
    assert.ok(g.inspect(b).blockers.includes('action_registry_uniqueness_failure'));
  });
  test('registry unhealthy does not authorize source-reviewed operation',()=>{
    const x=proposed();x.health.ok=false;
    assert.ok(g.inspect(x).blockers.includes('host_action_registry_health_invalid'));
  });
}
