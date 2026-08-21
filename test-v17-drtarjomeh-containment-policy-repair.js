'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { patchPolicyObject }=require('./bootstrap-host-actions-v17-drtarjomeh-containment-policy-repair.js');

function fixture(){
  return {
    schema_version:'prhm.approval-policy.v1',
    version:'2026-08-21.1-honartik-iticket-dark-backend-batch2-v1',
    default_deny:true,
    operations:{
      'host_action.drtarjomeh_security_containment_v1':{level:4}
    },
    typed_scopes:[
      {
        tool:'host_action_v2_apply',
        project:'control_plane',
        environment:'production',
        action:'drtarjomeh_security_containment_v1',
        risk:'critical',
        principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
      }
    ]
  };
}

test('repairs exactly the missing operation field without widening scope',()=>{
  const input=fixture();
  const before=JSON.parse(JSON.stringify(input));
  const out=patchPolicyObject(input);
  assert.equal(out.typed_scopes[0].operation,'host_action.drtarjomeh_security_containment_v1');
  const expected=before;
  expected.typed_scopes[0].operation='host_action.drtarjomeh_security_containment_v1';
  expected.version='2026-08-21.2-drtarjomeh-containment-scope-repair-v1';
  assert.deepEqual(out,expected);
});

test('fails closed when target scope is absent or duplicated',()=>{
  const missing=fixture(); missing.typed_scopes=[];
  assert.throws(()=>patchPolicyObject(missing),/target_scope_count:0/);
  const dup=fixture(); dup.typed_scopes.push({...dup.typed_scopes[0]});
  assert.throws(()=>patchPolicyObject(dup),/target_scope_count:2/);
});

test('fails closed if scope already has any operation or security invariants drift',()=>{
  const already=fixture(); already.typed_scopes[0].operation='host_action.other';
  assert.throws(()=>patchPolicyObject(already),/unexpected_existing_operation/);
  const weak=fixture(); weak.operations['host_action.drtarjomeh_security_containment_v1'].level=3;
  assert.throws(()=>patchPolicyObject(weak),/operation_level_mismatch/);
  const principal=fixture(); principal.typed_scopes[0].principals=[{principal_id:'someone',roles:['admin']}];
  assert.throws(()=>patchPolicyObject(principal),/principal_mismatch/);
});
