'use strict';
/* Pure in-memory Root-of-Trust registration proposal.
   Does NOT write files, install helpers, restart services or issue approvals.
   An independently reviewed and APPROVED trusted Root transaction must install
   these five exact-preimage candidates atomically with full rollback. */
const crypto=require('node:crypto');
const contract=require('./pbcinema-l4-root-admission-contract-v1');
const actions=contract.ACTIONS;
const EXECUTOR_DEST='/opt/prhm-agent-selfmaint-exec/actions/pbcinema-l4-native-executor-v1.js';
const CONTRACT_DEST='/opt/prhm-agent-selfmaint-exec/actions/pbcinema-l4-root-admission-contract-v1.js';
const BLOB_SHA256=Object.freeze({
 native:'0ce667693cea6049eb858f3000db617db74546ba3197fd07360e548f59aaf3cf',
 contract:'f5113557e78204884eac7c8897997d6b78818337b8258f05817ae103b8723f22'
});
function fail(reason){throw Error('pbcinema_registration_blocked:'+reason);}
function replaceOne(s,oldValue,newValue,tag){
 const i=s.indexOf(oldValue);
 if(i===-1||s.indexOf(oldValue,i+oldValue.length)!==-1)fail('invalid_anchor:'+tag);
 return s.slice(0,i)+newValue+s.slice(i+oldValue.length);
}
function makeReceipt(){
 return "{action,operation:hostActionV2Spec(action).operation,request_id:requestId,level:Number(record.level),risk:String(record.risk),verified_by_trusted_issuer:authz.valid===true,approval_consumed:authz.consumed===true,universal_git_sha:'"+contract.RELEASE.universal_git_sha+"',disabled_profile_digest:'"+contract.RELEASE.disabled_profile_digest+"'}";
}
function buildCandidates(source){
 if(!source||typeof source!=='object')fail('source_absent');
 for(const key of ['base','executor','policy','mcp','mcp_candidate']) {
   if(typeof source[key]!=='string')fail('source_missing:'+key);
   if(contract.sha256(source[key])!==contract.TARGETS[key].sha256)fail('preimage_drift:'+key);
 }
 for(const a of actions){
  for(const key of ['base','executor','mcp','mcp_candidate','policy'])
   if(source[key].includes(a.action))fail('partial_registration:'+key);
 }
 const baseAnchor="  control_plane_current_owner_bootstrap_repair_v1: { operation: 'host_action.control_plane_current_owner_bootstrap_repair_v1'";
 const baseEntries=actions.map(a=>"  "+a.action+": { operation: '"+a.operation+"', rollback: 'host-action-v2:"+a.action+":exact-preimage-and-account-compensation' },").join('\n')+'\n';
 const base=replaceOne(source.base,baseAnchor,baseEntries+baseAnchor,'base_registry');
 const execAnchor="  control_plane_current_owner_bootstrap_repair_v1:{operation:'host_action.control_plane_current_owner_bootstrap_repair_v1'";
 const execEntries=actions.map(a=>"  "+a.action+":{operation:'"+a.operation+"',kind:'"+a.action+"'},").join('\n')+'\n';
 let executor=replaceOne(source.executor,execAnchor,execEntries+execAnchor,'exec_registry');
 const dispatchAnchor='async function applyHostActionV2(action){const spec=hostActionV2Spec(action);';
 const dispatch=dispatchAnchor.replace('applyHostActionV2(action)','applyHostActionV2(action,receipt)')+
  "if(action==='pbcinema_mysql_backup_credential_issue_v1'||action==='pbcinema_universal_installer_upgrade_v1') {"+
  "const effects=require('"+EXECUTOR_DEST+"');"+
  "return action==='pbcinema_mysql_backup_credential_issue_v1'?effects.issueCredential(receipt):effects.upgradeInstaller(receipt);}";
 executor=replaceOne(executor,dispatchAnchor,dispatch,'exec_dispatch');
 const runAnchor='const result=await applyHostActionV2(action);';
 executor=replaceOne(executor,runAnchor,'const result=await applyHostActionV2(action,'+makeReceipt()+');','exec_receipt');
 const enumAnchor="'control_plane_current_owner_bootstrap_repair_v1',";
 const enumEntries=actions.map(a=>"'"+a.action+"',").join('');
 const mcp=replaceOne(source.mcp,enumAnchor,enumEntries+enumAnchor,'mcp_enum');
 const mcp_candidate=replaceOne(source.mcp_candidate,enumAnchor,enumEntries+enumAnchor,'mcp_candidate_enum');
 let policy;
 try{policy=JSON.parse(source.policy)}catch{fail('policy_invalid_json')}
 if(policy.enabled!==true||policy.default_deny!==true||!Array.isArray(policy.typed_scopes)||!policy.operations)fail('policy_not_fail_closed');
 for(const a of actions) {
   if(policy.operations[a.operation])fail('already_registered:'+a.action);
   policy.operations[a.operation]={level:4};
   policy.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',
      environment:'production',action:a.action,risk:'critical',operation:a.operation,
      principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
 }
 const result={base,executor,policy:JSON.stringify(policy,null,2)+'\n',mcp,mcp_candidate};
 for(const a of actions){
   if(!result.base.includes(a.operation)||!result.executor.includes(a.operation)||
      !result.mcp.includes("'"+a.action+"'")||!result.mcp_candidate.includes("'"+a.action+"'"))fail('incomplete_candidate:'+a.action);
 }
 return result;
}
function prepareForTrustedInstaller({readOwner,readArtifact}){
 if(typeof readOwner!=='function'||typeof readArtifact!=='function')fail('missing_reader');
 const source={};
 for(const [key,val] of Object.entries(contract.TARGETS))
   source[key]=readOwner(val.path);
 const candidates=buildCandidates(source);
 const blobs={native:readArtifact('pbcinema-l4-native-executor-v1.js'),
              contract:readArtifact('pbcinema-l4-root-admission-contract-v1.js')};
 if(contract.sha256(blobs.native)!==BLOB_SHA256.native||
    contract.sha256(blobs.contract)!==BLOB_SHA256.contract)fail('reviewed_artifact_sha_mismatch');
 return Object.freeze({ready_for_independent_review:true,installed:false,
   root_transaction_required:true,source_sha256:contract.TARGETS,
   candidates,helper_artifacts:Object.freeze([
     {path:EXECUTOR_DEST,sha256:BLOB_SHA256.native},
     {path:CONTRACT_DEST,sha256:BLOB_SHA256.contract}
   ])});
}
module.exports={EXECUTOR_DEST,CONTRACT_DEST,BLOB_SHA256,buildCandidates,prepareForTrustedInstaller};
