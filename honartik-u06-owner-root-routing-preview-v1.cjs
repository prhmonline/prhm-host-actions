'use strict';
/**
 * U06 narrowly scoped Host Action registry patch PREVIEW — source only.
 * SHA-binds the exact four Root owner preimages from owner's live console.
 *
 * Deliberately registers no action and changes no Production file. The
 * proposed dispatch is a DENY, not an executor. Approval policy is unchanged.
 * NEVER install or apply this preview; it is an integration review artifact.
 */
const crypto=require('node:crypto');
const {BASELINE}=require('./honartik-u06-owner-root-preimages-v1.cjs');
const ACTION=BASELINE.action;
const OPERATION='host_action.'+ACTION;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const P=BASELINE.owners;
const DENY='u06_native_root_dispatch_not_installed';
const A=Object.freeze({
 api:"  host_action_v2_installer_v1: { operation: 'host_action.host_action_v2_installer_v1', rollback: 'host-action-v2:host-action-v2-installer-v1:four-file-restore' },",
 executor:"  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',kind:'host_action_v2_installer_v1'},",
 enum:"const HostActionV2=z.enum([",
 dispatch:"applyHostActionV2=async function(action){",
 consumed:"const authz=await callBase('/v2/host-actions/authorize-consume','POST',{action,approval_token:token});",
 apply:"const result=await applyHostActionV2(action);",
 level3:"const HOST_ACTION_V2_LEVEL3 = new Set(",
 approvalMeta:"function hostActionV2ApprovalMeta(action)",
 health:"host_actions_v2: Object.keys(HOST_ACTION_V2_SPECS)"
});
const NEW=Object.freeze({
 api:"  "+ACTION+": { operation: '"+OPERATION+"', rollback: 'host-action-v2:honartik-u06-native-backup:durable-verified-root-rollback' },",
 executor:"  "+ACTION+":{operation:'"+OPERATION+"',kind:'"+ACTION+"'},",
 dispatch:"if(action==='"+ACTION+"')throw new Error('"+DENY+"');",
 mcp:"'"+ACTION+"',"
});
function fail(m){throw Error('u06_owner_registration_review_'+m);}
function requireOnce(content,anchor,label){
 if(content.split(anchor).length!==2)fail('anchor_missing_or_duplicated_'+label);
}
function validate(texts){
 const keys=['agent_api','root_executor','agent3_mcp','approval_policy'];
 if(!texts||typeof texts!=='object'||Array.isArray(texts)||
  Object.keys(texts).sort().join('|')!==keys.sort().join('|'))fail('four_owner_shape');
 const changed={};
 for(const k of keys){
  const b=texts[k];
  if(!Buffer.isBuffer(b)||b.length!==P[k].size||sha(b)!==P[k].sha256)
   fail('owner_source_drift_'+k);
  const t=b.toString('utf8');
  if(!Buffer.from(t,'utf8').equals(b))fail('owner_non_utf8_'+k);
  changed[k]=t;
 }
 return changed;
}
function previewExactOwnerSources(texts){
 const files=validate(texts);
 const api=files.agent_api,exec=files.root_executor,mcp=files.agent3_mcp;
 requireOnce(api,A.api,'api_registry');
 requireOnce(exec,A.executor,'exec_registry');
 requireOnce(exec,A.dispatch,'final_exec_dispatch');
 requireOnce(exec,A.consumed,'consume_authorization');
 requireOnce(exec,A.apply,'execute_after_authorization');
 requireOnce(mcp,A.enum,'mcp_enum');
 if(api.includes(NEW.api)||exec.includes(NEW.executor)||
    exec.includes(NEW.dispatch)||mcp.includes(NEW.mcp))fail('already_registered');
 if(!api.includes(A.level3)||!api.includes(A.approvalMeta)||
    !exec.includes(A.health))fail('control_plane_shape_drift');
 const level3=api.slice(api.indexOf(A.level3),api.indexOf(A.approvalMeta));
 if(level3.includes(ACTION))fail('u06_must_not_be_level3');
 if(exec.indexOf(A.consumed)>=exec.indexOf(A.apply))fail('approval_after_apply');
 const proposed={
  agent_api:api.replace(A.api,NEW.api+'\n'+A.api),
  root_executor:exec.replace(A.executor,NEW.executor+'\n'+A.executor)
    .replace(A.dispatch,A.dispatch+NEW.dispatch),
  agent3_mcp:mcp.replace(A.enum,A.enum+NEW.mcp),
  approval_policy:files.approval_policy
 };
 if(proposed.agent_api.slice(
   proposed.agent_api.indexOf(A.level3),
   proposed.agent_api.indexOf(A.approvalMeta)).includes(ACTION))
   fail('level3_promotion');
 if(!proposed.root_executor.includes(A.dispatch+NEW.dispatch))
   fail('denied_dispatch_missing');
 if(proposed.root_executor.indexOf(A.consumed)>=
    proposed.root_executor.indexOf(A.apply))fail('consume_order_drift');
 return Object.freeze({
  schema:'prhm.u06.owner-route-preview.no-install.v1',
  action:ACTION,
  operation:OPERATION,
  current_sha256:Object.freeze(Object.fromEntries(
    Object.entries(P).map(([k,v])=>[k,v.sha256]))),
  proposed_sha256:Object.freeze(Object.fromEntries(
    Object.entries(proposed).map(([k,v])=>[k,sha(Buffer.from(v,'utf8'))]))),
  proposed_source_review_only:Object.freeze(proposed),
  proposed_dispatch_explicitly_denied:true,
  authz_existing_consume_order_preserved:true,
  level4_not_downgraded_to_level3:true,
  root_executor_native_implemented:false,
  signed_owner_oidc_verified_in_root:false,
  approval_policy_modified:false,
  root_action_installed:false,
  production_backup_performed:false,
  production_changes_authorized:false
 });
}
function previewSyntheticFixture(source){
 if(!source||Object.keys(source).sort().join('|')!==
  ['agent_api','root_executor','agent3_mcp','approval_policy'].sort().join('|'))
  fail('synthetic_fixture_shape');
 for(const [k,v] of Object.entries(source)){
  if(typeof v!=='string'||!v.startsWith('// U06 SYNTHETIC FIXTURE ONLY\n'))
   fail('not_synthetic_'+k);
 }
 const api=source.agent_api,exec=source.root_executor,mcp=source.agent3_mcp;
 requireOnce(api,A.api,'api_registry');
 requireOnce(exec,A.executor,'exec_registry');
 requireOnce(exec,A.dispatch,'final_dispatch');
 requireOnce(exec,A.consumed,'v2_consume');
 requireOnce(exec,A.apply,'v2_apply');
 requireOnce(mcp,A.enum,'mcp_enum');
 if(!api.includes(A.level3)||!api.includes(A.approvalMeta)||
    !exec.includes(A.health)||exec.indexOf(A.consumed)>=exec.indexOf(A.apply))
  fail('synthetic_control_shape');
 if(api.slice(api.indexOf(A.level3),api.indexOf(A.approvalMeta)).includes(ACTION))
  fail('u06_promoted_to_level3');
 const output={
  agent_api:api.replace(A.api,NEW.api+'\n'+A.api),
  root_executor:exec.replace(A.executor,NEW.executor+'\n'+A.executor)
    .replace(A.dispatch,A.dispatch+NEW.dispatch),
  agent3_mcp:mcp.replace(A.enum,A.enum+NEW.mcp),
  approval_policy:source.approval_policy
 };
 return Object.freeze({source:Object.freeze(output),flags:{
   native_root_installed:false,approval_center_changed:false,production_apply:false
 }});
}
module.exports=Object.freeze({ACTION,OPERATION,BASELINE,A,NEW,DENY,
 previewExactOwnerSources,previewSyntheticFixture,
 SOURCE_ONLY:true,ROOT_INSTALL_ALLOWED:false,PRODUCTION_APPLY_ALLOWED:false});
