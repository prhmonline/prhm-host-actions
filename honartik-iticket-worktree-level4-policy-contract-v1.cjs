'use strict';
/**
 * Source-only policy contract for future signed registration of the
 * currently INERT honartik_git_worktree_fixed_v1 action.
 * No filesystem, runtime, network, tokens, approvals, or installation.
 * Does not assert that a new action is already installed or executable.
 */
const crypto=require('node:crypto');
const EXPECTED_ORIGINAL_POLICY_SHA='148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174';
const EXISTING_VERSION='2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1';
const CANDIDATE_VERSION='2026-10-18.1-honartik-worktree-level4-v1';
const ACTION='honartik_git_worktree_fixed_v1';
const OPERATION='host_action.'+ACTION;
const ROLLBACK='host-action-v2:honartik-git-worktree-fixed-v1:worktree-remove';
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=why=>{throw Error('honartik_l4_policy_blocked_'+why);};
function validateGlobal(p){
  if(!p||typeof p!=='object'||p.schema_version!=='prhm.approval-policy.v1'||
    p.version!==EXISTING_VERSION)fail('global_schema_or_version');
  if(p.default_deny!==true||p.one_time_use!==true||p.issuer!=='prhm-company-approval')
    fail('global_fail_closed');
  if(p.high_risk_approver!=='mohammad')fail('approver_mismatch');
  const l4=p.levels?.['4'];
  if(!l4||l4.human_approval!==true||
    l4.second_confirmation_required!==true||
    l4.required_approver!=='mohammad'||l4.max_ttl_seconds!==180||
    !Array.isArray(l4.risks)||!l4.risks.includes('critical'))
    fail('level4_effective_structure');
  if(!p.operations||typeof p.operations!=='object'||Array.isArray(p.operations)||
    !Array.isArray(p.typed_scopes))fail('missing_registry');
  // Ensure this action cannot slip through the old Level3 exception.
  const known=p.operations['host_action.host_action_v2_installer_v1'];
  if(!known||known.level!==3)fail('previous_installer_policy_drift');
  if(Object.hasOwn(p.operations,OPERATION)||
      p.typed_scopes.some(s=>s&&(s.action===ACTION||s.operation===OPERATION)))
    fail('action_already_exists');
  return true;
}
function transform(text){
  if(typeof text!=='string'||!text.length||text.length>250000)fail('policy_text_invalid');
  let p;
  try{p=JSON.parse(text);}catch{fail('json_invalid');}
  validateGlobal(p);
  p.version=CANDIDATE_VERSION;
  p.operations[OPERATION]={
    level:4,risk:'critical',requires_second_confirmation:true,
    one_time_use:true,requested_approver:'mohammad',expires_seconds:180,
    policy_version:CANDIDATE_VERSION,rollback_reference:ROLLBACK
  };
  p.typed_scopes.push({
    tool:'host_action_v2_apply',project:'control_plane',environment:'production',
    action:ACTION,risk:'critical',operation:OPERATION,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
  });
  return JSON.stringify(p,null,2)+'\n';
}
function audit(original){
  if(!Buffer.isBuffer(original)||sha256(original)!==EXPECTED_ORIGINAL_POLICY_SHA)
    fail('original_sha');
  const text=original.toString('utf8');
  if(!Buffer.from(text,'utf8').equals(original))fail('original_utf8');
  const patched=transform(text);
  return Object.freeze({
    schema:'prhm.honartik.iticket.worktree-level4-policy-source.v1',
    source_only:true,
    preimage_sha256:EXPECTED_ORIGINAL_POLICY_SHA,
    prospective_postimage_sha256:sha256(Buffer.from(patched,'utf8')),
    prospective_policy_version:CANDIDATE_VERSION,
    action:ACTION,
    requested_level:4,one_time_use:true,second_confirmation:true,
    expires_seconds:180,rollback_reference:ROLLBACK,
    effective_runtime_enforcement:'NOT_ATTESTED',
    registration_authorized:false,install_authorized:false,
    production_mutation:false
  });
}
module.exports=Object.freeze({ACTION,OPERATION,ROLLBACK,EXPECTED_ORIGINAL_POLICY_SHA,
  EXISTING_VERSION,CANDIDATE_VERSION,validateGlobal,transform,audit});
