'use strict';
/**
 * U06 expired-owner OIDC: deterministic critical policy POSTIMAGE BUILDER.
 *
 * Reads caller-provided bytes only; NEVER writes the live policy or exposes
 * Host Actions, approval issuance, privileged APIs, or a CLI installer.
 * Source bytes and candidate bytes are both pinned to independent SHA-256.
 * The old already-installed native action is retained unchanged.
 */
const crypto=require('node:crypto');
const Admission=require('./honartik-u06-expired-owner-reconcile-l4-consumed-v1.cjs');
const Pre=require('./honartik-u06-expired-owner-four-owner-preflight-v1.cjs');
const POLICY_FILE=Pre.PATHS.approval_policy;
const BEFORE_SHA256=Pre.SHA256.approval_policy;
const AFTER_SHA256='f9af71eea8933792a7a518c9d7fc1d85a87afa80cda0c4716002f2fb39dec235';
const AFTER_BYTES=32919;
const ISSUER_POLICY_HASH_SHA256='b47c09eec7db73608caea8cea2967dbb08eab7d75211df4073cbaeec231474fe';
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const die=x=>{throw Error('u06_reconcile_policy_candidate_'+x)};
const requireThat=(v,x)=>{if(!v)die(x)};
function generatePinnedPolicyPostimage(bytes){
 requireThat(Buffer.isBuffer(bytes)&&bytes.length>100&&bytes.length<200000&&
   H(bytes)===BEFORE_SHA256,'live_policy_preimage_drift');
 let p;try{p=JSON.parse(bytes.toString('utf8'))}
 catch{die('invalid_policy_json')}
 Pre.strictPolicy(p);
 requireThat(p.issuer==='prhm-company-approval','trusted_issuer_drift');
 const action=Admission.ACTION,operation=Admission.OPERATION;
 requireThat(p.operations?.[operation]===undefined&&
   !p.typed_scopes.some(s=>s.operation===operation||s.action===action),
   'reconcile_action_already_exists');
 const nativeBefore=JSON.stringify(p.operations[Admission.NATIVE_OPERATION]);
 const nativeScopesBefore=JSON.stringify(p.typed_scopes.filter(
   s=>s.operation===Admission.NATIVE_OPERATION));
 p.operations[operation]={
  level:4,risk:'critical',requires_second_confirmation:true,
  one_time_use:true,requested_approver:'mohammad',
  expires_seconds:180,policy_version:p.version,
  rollback_reference:Admission.ROLLBACK
 };
 p.typed_scopes.push({
  tool:'host_action_v2_apply',project:'control_plane',
  environment:'production',action,risk:'critical',operation,
  principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
 });
 requireThat(JSON.stringify(p.operations[Admission.NATIVE_OPERATION])===nativeBefore&&
   JSON.stringify(p.typed_scopes.filter(
     s=>s.operation===Admission.NATIVE_OPERATION))===nativeScopesBefore,
   'existing_native_policy_changed');
 const result=Buffer.from(JSON.stringify(p,null,2)+'\n','utf8');
 requireThat(result.length===AFTER_BYTES&&H(result)===AFTER_SHA256,
   'reviewed_policy_postimage_drift');
 const checked=Admission.verifyFixedPolicy(result,AFTER_SHA256);
 requireThat(checked.signed_policy_hash===ISSUER_POLICY_HASH_SHA256&&
   checked.operation===Admission.OPERATION,'issuer_policy_binding_drift');
 return Object.freeze({
   file:POLICY_FILE,bytes:result,
   before_sha256:BEFORE_SHA256,after_sha256:AFTER_SHA256,
   issuer_policy_hash_sha256:ISSUER_POLICY_HASH_SHA256,
   native_operation_preserved:true,
   requires_separate_owner_signed_root_release:true,
   requires_fresh_level4_approval:true,
   production_install_authorized:false,
   level4_issued:false
 });
}
module.exports=Object.freeze({
 POLICY_FILE,BEFORE_SHA256,AFTER_SHA256,AFTER_BYTES,
 ISSUER_POLICY_HASH_SHA256,generatePinnedPolicyPostimage,
 PRODUCTION_APPLY_EXPORTED:false,APPROVAL_ISSUER:false,ROOT_INSTALLER:false
});
if(require.main===module){
 process.stderr.write('No direct policy installation; SHA-pinned review only.\n');
 process.exitCode=64;
}
