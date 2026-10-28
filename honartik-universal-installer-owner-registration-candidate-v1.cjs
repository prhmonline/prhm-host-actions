'use strict';
/**
 * Honartik Issue #217 — review-only owner registration source patch.
 * The operator supplied read-only snippets of the ACTUAL installed files.
 * This module NEVER writes files, restarts services, issues/consumes Level 4
 * approvals, or authorizes installation. Its executor dispatch is deliberately
 * DENIED until an independently reviewed native root transaction is wired.
 *
 * Every caller must use byte-exact, SHA-pinned live owner files. No CLI entry.
 */
const crypto=require('node:crypto');
const fs=require('node:fs');
const REG=require('./honartik-universal-installer-registration-review-pack-v1.cjs');
const ACTION='honartik_universal_installer_upgrade_v1';
const OP='host_action.'+ACTION;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function deny(s){throw Error('honartik217_owner_patch_'+s)}
function unique(source,anchor,name){
 const a=source.split(anchor);
 if(a.length!==2)deny('ambiguous_'+name);
 return true;
}
const API_EXISTING="  host_action_v2_installer_v1: { operation: 'host_action.host_action_v2_installer_v1', rollback: 'host-action-v2:host-action-v2-installer-v1:four-file-restore' },";
const EXEC_EXISTING="  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',kind:'host_action_v2_installer_v1'},";
const MCP_ANCHOR="const HostActionV2=z.enum([";
const DISPATCH_ANCHOR='applyHostActionV2=async function(action){';
const V2_CONSUME_ANCHOR="const authz=await callBase('/v2/host-actions/authorize-consume','POST',{action,approval_token:token});";
const V2_APPLY_ANCHOR='const result=await applyHostActionV2(action);';
// The token is created by the server-side trusted confirm call and was
// consumed by the authoritative Approval Center immediately before APPLY.
// Never serialize or return it through MCP, records, logs or status output.
const V2_BOUND_APPLY=`const result=await applyHostActionV2(action,action==='${ACTION}'?Object.freeze({action,request_id:requestId,level,confirmation:body.second_confirmation,authorization_consumed:authz.valid===true&&authz.consumed===true,loadConsumedServerToken:(expectedId)=>{if(expectedId!==requestId)throw new Error('honartik217_request_identity_mismatch');return token;}}):undefined);`;
const L4_CONTEXT_GUARD=`if(action==='${ACTION}'){if(!l4Binding||l4Binding.action!==action||l4Binding.level!==4||l4Binding.confirmation!=='CONFIRM_LEVEL_4_CRITICAL'||l4Binding.authorization_consumed!==true||typeof l4Binding.loadConsumedServerToken!=='function')throw new Error('honartik217_trusted_consumed_context_missing');`;
const L4_CONTEXT_DENY="throw new Error('honartik_universal_installer_upgrade_v1_native_root_dispatch_not_reviewed');}";
const API_NEW="  "+ACTION+": { operation: '"+OP+"', rollback: 'host-action-v2:honartik-universal-installer-upgrade-v1:locked-preimage-journal-rollback' },";
const EXEC_NEW="  "+ACTION+":{operation:'"+OP+"',kind:'"+ACTION+"'},";
const DISPATCH_DENY="if(action==='"+ACTION+"')throw new Error('honartik_universal_installer_upgrade_v1_native_root_dispatch_not_reviewed');";
function previewOwnerPatch(readOwner){
 if(typeof readOwner!=='function')deny('trusted_reader_missing');
 const files={};
 for(const key of ['base','executor','mcp']){
  const pin=REG.TARGETS[key];
  const raw=readOwner(pin.path);
  if(!Buffer.isBuffer(raw)||raw.length===0||raw.length>2_000_000)
   deny('owner_bytes_unavailable_'+key);
  if(sha(raw)!==pin.sha256)deny('owner_sha_drift_'+key);
  files[key]=raw.toString('utf8');
  if(Buffer.from(files[key],'utf8').compare(raw)!==0)
   deny('owner_not_utf8_'+key);
 }
 return transformOwnerSourceForReview(files);
}
function transformOwnerSourceForReview(files){
 const {base,executor,mcp}=files;
 unique(base,API_EXISTING,'api_fixed_spec');
 unique(executor,EXEC_EXISTING,'executor_fixed_spec');
 unique(executor,DISPATCH_ANCHOR,'executor_dispatch');
 unique(executor,V2_CONSUME_ANCHOR,'executor_authorize_consume');
 unique(executor,V2_APPLY_ANCHOR,'executor_v2_apply_call');
 unique(mcp,MCP_ANCHOR,'mcp_enum');
 if(base.includes(API_NEW)||executor.includes(EXEC_NEW)||
  mcp.includes("'"+ACTION+"'")||executor.includes(DISPATCH_DENY)||
  executor.includes('loadConsumedServerToken'))
  deny('already_patched');
 if(!base.includes('const HOST_ACTION_V2_LEVEL3 = new Set(')||
  !base.includes('function hostActionV2ApprovalMeta(action)'))
  deny('api_policy_classifier_drift');
 if(!executor.includes('host_actions_v2: Object.keys(HOST_ACTION_V2_SPECS)'))
  deny('executor_health_registry_drift');
 // This is intentionally NOT a signed registration. The exact operation
 // must have no entry in LEVEL3; the server classifies it as Level 4.
 const apiLevel3=base.slice(base.indexOf('const HOST_ACTION_V2_LEVEL3 = new Set('),
  base.indexOf('function hostActionV2ApprovalMeta(action)'));
 if(apiLevel3.includes(ACTION))deny('operation_misclassified_as_level3');
 const patched={
  base:base.replace(API_EXISTING,API_NEW+'\n'+API_EXISTING),
  executor:executor.replace(EXEC_EXISTING,EXEC_NEW+'\n'+EXEC_EXISTING)
   .replace(DISPATCH_ANCHOR,
    'applyHostActionV2=async function(action,l4Binding){'+L4_CONTEXT_GUARD+L4_CONTEXT_DENY)
   .replace(V2_APPLY_ANCHOR,V2_BOUND_APPLY),
  mcp:mcp.replace(MCP_ANCHOR,MCP_ANCHOR+"'"+ACTION+"',")
 };
 const modifiedLevel3=patched.base.slice(
  patched.base.indexOf('const HOST_ACTION_V2_LEVEL3 = new Set('),
  patched.base.indexOf('function hostActionV2ApprovalMeta(action)'));
 if(modifiedLevel3.includes(ACTION))deny('level3_boundary_modified');
 if(patched.executor.split(L4_CONTEXT_DENY).length!==2)deny('dispatch_deny_missing');
 if(patched.executor.split(V2_BOUND_APPLY).length!==2)
  deny('consumed_request_context_binding_missing');
 // Existing Level-4 confirm + authorize-consume order is not modified;
 // the token closure is created only AFTER that route has consumed L4.
 if(patched.executor.indexOf(V2_CONSUME_ANCHOR)>=
    patched.executor.indexOf(V2_BOUND_APPLY))
  deny('consumption_not_before_execution');
 return Object.freeze({
  schema:'prhm.honartik217.owner-registration-review-only.v1',
  action:ACTION,operation:OP,
  source_preimages:Object.freeze(Object.fromEntries(['base','executor','mcp']
   .map(k=>[k,REG.TARGETS[k].sha256]))),
  proposed_sha256:Object.freeze(Object.fromEntries(
   Object.entries(patched).map(([k,v])=>[k,sha(Buffer.from(v,'utf8'))]))),
  // Candidate text can be handed ONLY to independent authorized reviewer.
  // Never run this function as a root-script or deploy by generic installer.
  proposed_owner_text:Object.freeze(patched),
  security_boundary:Object.freeze({
   level4_only:true,added_to_level3:false,
   root_dispatch_explicitly_denied:true,
   fixed_authenticated_request_context_injected_after_consume:true,
   consumed_token_remains_in_executor_memory:true,
   signed_token_revalidated_by_root_transaction:false,
   root_native_bridge_integrated:false,
   independent_review_approved:false,
   live_policy_activated:false,
   trusted_root_registration_complete:false,
   signed_level4_available:false,
   install_authorized:false,
   backend_deployed:false,
   production_mutation:false
  })
 });
}
function previewIsolatedSyntheticFixture(files){
 // For negative/contract CI only. Cannot run under root and cannot read or
 // write any Production path. No output can authorize an actual installer.
 if(typeof process.getuid!=='function'||process.getuid()===0)
  deny('fixture_requires_unprivileged_linux');
 if(!files||!['base','executor','mcp'].every(k=>
   typeof files[k]==='string'&&
   files[k].startsWith('// PRHM217 SYNTHETIC TEST ONLY\n')))
  deny('fixture_not_synthetic');
 return transformOwnerSourceForReview(files);
}
module.exports=Object.freeze({ACTION,OP,previewOwnerPatch,
 previewIsolatedSyntheticFixture,
 SOURCE_ONLY:true,PRODUCTION_INSTALL_AUTHORIZED:false});
