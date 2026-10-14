'use strict';
// Pure, fail-closed source review of the *missing* critical Host Action registration.
// This is NOT a registration interface, request issuer, approval validator,
// root installer, production executor or authority to consume a grant.
const ACTION='deploy_control_cutover_install_v1';
const OPERATION='host_action.'+ACTION;
const PRINCIPAL='mohammad';
const EXPECTED={
  tool:'host_action_v2_apply',project:'control_plane',environment:'production',
  action:ACTION,operation:OPERATION,risk:'critical'
};
function fail(reason){throw Error('deploy_control_l4_registration_'+reason)}
function validScope(s){
  return !!s&&typeof s==='object'&&!Array.isArray(s)&&
    Object.entries(EXPECTED).every(([k,v])=>s[k]===v)&&
    Array.isArray(s.principals)&&s.principals.length===1&&
    s.principals[0]?.principal_id===PRINCIPAL&&
    Array.isArray(s.principals[0].roles)&&
    s.principals[0].roles.length===1&&s.principals[0].roles[0]==='mcp-operator';
}
function inspect({policy,health}){
  if(!policy||typeof policy!=='object'||Array.isArray(policy)||
     !policy.operations||typeof policy.operations!=='object'||
     !Array.isArray(policy.typed_scopes))
    fail('invalid_policy');
  if(!health||typeof health!=='object'||Array.isArray(health)||
     !Array.isArray(health.host_actions_v2))
    fail('invalid_registry_health');

  const blockers=[];
  const op=policy.operations[OPERATION];
  if(!op)blockers.push('dedicated_l4_operation_not_allowlisted');
  else if(op.level!==4||op.risk!=='critical'||
          op.requires_second_confirmation!==true||
          op.one_time_use!==true||
          op.requested_approver!==PRINCIPAL)
    blockers.push('dedicated_l4_operation_contract_mismatch');
  const level4=policy.levels?.['4'];
  if(level4?.human_approval!==true||
     level4?.required_approver!==PRINCIPAL||
     level4?.second_confirmation_required!==true)
    blockers.push('critical_human_authorization_not_enforced');
  const scopes=policy.typed_scopes.filter(s=>s?.action===ACTION||
    s?.operation===OPERATION);
  if(scopes.length!==1||!validScope(scopes[0]))
    blockers.push('dedicated_l4_typed_scope_absent_or_invalid');
  if(!health.host_actions_v2.includes(ACTION))
    blockers.push('dedicated_fixed_action_not_registered');
  if(health.host_actions_v2.filter(x=>x===ACTION).length!==1)
    blockers.push('action_registry_uniqueness_failure');
  if(health.ok!==true||health.service!=='prhm-agent-selfmaint-exec')
    blockers.push('host_action_registry_health_invalid');
  return Object.freeze({
    schema_version:'prhm.deploy-control-l4-registration-source-preflight.v1',
    action:ACTION,operation:OPERATION,
    blockers:Object.freeze([...new Set(blockers)]),
    source_review_gates_present:blockers.length===0,
    existing_generic_installer_level:policy.operations['host_action.host_action_v2_installer_v1']?.level??null,
    // A registry+policy view is NEVER a live signed authorization.
    approved:false,execution_authorized:false,may_install:false,
    needs:'independent_signed_one_time_level4_confirmation_and_trusted_runtime_attestation'
  });
}
module.exports=Object.freeze({ACTION,OPERATION,EXPECTED,inspect});
