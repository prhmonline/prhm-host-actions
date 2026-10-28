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
 const {base,executor,mcp}=files;
 unique(base,API_EXISTING,'api_fixed_spec');
 unique(executor,EXEC_EXISTING,'executor_fixed_spec');
 unique(executor,DISPATCH_ANCHOR,'executor_dispatch');
 unique(mcp,MCP_ANCHOR,'mcp_enum');
 if(base.includes(API_NEW)||executor.includes(EXEC_NEW)||
  mcp.includes("'"+ACTION+"'")||executor.includes(DISPATCH_DENY))
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
   .replace(DISPATCH_ANCHOR,DISPATCH_ANCHOR+DISPATCH_DENY),
  mcp:mcp.replace(MCP_ANCHOR,MCP_ANCHOR+"'"+ACTION+"',")
 };
 const modifiedLevel3=patched.base.slice(
  patched.base.indexOf('const HOST_ACTION_V2_LEVEL3 = new Set('),
  patched.base.indexOf('function hostActionV2ApprovalMeta(action)'));
 if(modifiedLevel3.includes(ACTION))deny('level3_boundary_modified');
 if(patched.executor.split(DISPATCH_DENY).length!==2)deny('dispatch_deny_missing');
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
module.exports=Object.freeze({ACTION,OP,previewOwnerPatch,
 SOURCE_ONLY:true,PRODUCTION_INSTALL_AUTHORIZED:false});
