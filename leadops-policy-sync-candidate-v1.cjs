'use strict';
// Git-first, source-only fixed policy synchronization candidate.
// No CLI or executable bootstrap. A trusted externally reviewed installer must
// verify/consume a SIGNED one-use Level-4 request BEFORE calling applyPrepared().
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const ACTION='control_plane_approval_policy_canonical_sync_v1';
const OPERATION='host_action.'+ACTION;
const SOURCE_COMMIT='68e1fbfe20abe0d2b7bf60a207aac69f2c9cd89e';
const TARGET='/opt/prhm-company-control-plane/config/approval-policy.json';
const MEDIATOR='/opt/prhm-company-control-plane/root-scripts-stage-mediator-v1/control-plane-root-scripts-stage-mediator-v1.js';
const LIVE_SHA='148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174';
const MEDIATOR_SHA='26ec21a51e3b0cb5e5aafd8a70531efb84243409557f2af186d16e90b673b3ee';
const CANON_BLOB='7e7d22bee0156e4fa3def84b3739f84e8b614bcd';
const CANON_FILE=path.join(__dirname,'leadops-policy-sync-canonical-20261012.json');
function hash(b){return crypto.createHash('sha256').update(b).digest('hex');}
function blob(b){return crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');}
function fail(reason){throw Error(reason);}
function norm(o){
 if(Array.isArray(o))return o.map(norm);
 if(o&&typeof o==='object')return Object.fromEntries(Object.keys(o).sort().map(k=>[k,norm(o[k])]));
 return o;
}
function canonComparable(p){
 const c={...p};delete c.version;delete c.deployment_integrity;
 // Order of scopes has no authorization semantics; each full entry must match.
 c.typed_scopes=c.typed_scopes.map(norm).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return JSON.stringify(norm(c));
}
function verifyPolicySemantics(live,canon){
 const a=JSON.parse(live.toString('utf8')),b=JSON.parse(canon.toString('utf8'));
 if(a.schema_version!=='prhm.approval-policy.v1'||b.schema_version!==a.schema_version)
   fail('schema_mismatch');
 if(a.version!=='2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1')
   fail('live_version_mismatch');
 if(b.version!=='2026-10-12.1-policy-git-live-reconciliation-v1')
   fail('canonical_version_mismatch');
 if(Object.prototype.hasOwnProperty.call(a,'deployment_integrity'))
   fail('live_integrity_already_present_or_drift');
 if(Object.keys(b.operations||{}).length!==75||b.typed_scopes?.length!==52)
   fail('canonical_scope_count_mismatch');
 if(Object.keys(a.operations||{}).length!==75||a.typed_scopes?.length!==52)
   fail('live_scope_count_mismatch');
 if(canonComparable(a)!==canonComparable(b))
   fail('policy_semantic_grant_difference');
 const integrity=b.deployment_integrity;
 if(!integrity||integrity.git_first_required!==true||
   integrity.exact_commit_sha_required_for_production!==true||
   integrity.direct_production_file_edit_forbidden!==true||
   integrity.failed_commit_preserved!==true||integrity.automatic_git_reset!==false||
   integrity.automatic_git_revert!==false)fail('git_first_integrity_invalid');
 if(b.default_deny!==true||b.one_time_use!==true||
   b.scope_freeze!==true||b.levels?.['4']?.human_approval!==true||
   b.levels?.['4']?.second_confirmation_required!==true)
   fail('approval_guards_invalid');
 if('host_action.leadops_backup_role_provision_v1' in b.operations)
   fail('unexpected_leadops_role_registration');
 return {operations:75,scopes:52,only_change:['version','deployment_integrity']};
}
function getPlan({livePolicy,mediator,canonical}){
 if(!Buffer.isBuffer(livePolicy)||hash(livePolicy)!==LIVE_SHA)
   fail('live_policy_sha_drift');
 if(!Buffer.isBuffer(mediator)||hash(mediator)!==MEDIATOR_SHA)
   fail('mediator_sha_drift');
 if(!Buffer.isBuffer(canonical)||blob(canonical)!==CANON_BLOB)
   fail('canonical_git_blob_mismatch');
 const facts=verifyPolicySemantics(livePolicy,canonical);
 return Object.freeze({
   schema:'prhm.control-plane.policy-sync.plan.v1',action:ACTION,operation:OPERATION,
   reviewed_source_commit:SOURCE_COMMIT,source_sha256:LIVE_SHA,
   target_sha256:hash(canonical),mediator_sha256:MEDIATOR_SHA,
   target:TARGET,mediator:MEDIATOR,
   ...facts,requires_signed_level4:true,production_mutation_authorized:false,
   rollback_required:true
 });
}
async function applyPrepared(plan,adapter){
 if(plan?.schema!=='prhm.control-plane.policy-sync.plan.v1'||
    plan.action!==ACTION||plan.operation!==OPERATION||
    plan.target!==TARGET||plan.source_sha256!==LIVE_SHA||
    plan.mediator_sha256!==MEDIATOR_SHA||plan.reviewed_source_commit!==SOURCE_COMMIT)
    fail('plan_identity_invalid');
 for(const m of ['assertConsumedSignedLevel4','assertReviewedCommit','lock','fileState',
   'readFile','saveDurableBackup','atomicReplace','reloadAndHealth',
   'restoreBackup','recordAudit']){
   if(typeof adapter?.[m]!=='function')fail('trusted_adapter_required:'+m);
 }
 const auth=await adapter.assertConsumedSignedLevel4({
   action:ACTION,operation:OPERATION,level:4,
   source_sha256:LIVE_SHA,target_sha256:plan.target_sha256,
   reviewed_source_commit:SOURCE_COMMIT
 });
 if(auth?.signed!==true||auth?.consumed!==true||auth?.one_time!==true||
    auth?.level!==4||auth?.operation!==OPERATION||
    auth?.approver!=='mohammad'||typeof auth?.request_id!=='string')
    fail('level4_approval_not_verified');
 if(await adapter.assertReviewedCommit(SOURCE_COMMIT)!==true)
   fail('source_commit_not_verified');
 const release=await adapter.lock(ACTION);
 if(typeof release!=='function')fail('lock_failed');
 let snapshot=null,changed=false;
 try{
   const l=await adapter.fileState(TARGET),m=await adapter.fileState(MEDIATOR);
   if(l?.regular!==true||l?.symlink!==false||l?.sha256!==LIVE_SHA||
      l?.uid!==0||l?.mode!==0o644)fail('live_policy_preimage_drift');
   if(m?.regular!==true||m?.symlink!==false||m?.sha256!==MEDIATOR_SHA)
      fail('live_mediator_preimage_drift');
   const live=await adapter.readFile(TARGET),mediator=await adapter.readFile(MEDIATOR);
   const canonical=fs.readFileSync(CANON_FILE);
   const actual=getPlan({livePolicy:live,mediator,canonical});
   if(actual.target_sha256!==plan.target_sha256)
      fail('prepared_plan_drift');
   snapshot=await adapter.saveDurableBackup(TARGET,live,{
     source_sha256:LIVE_SHA,mode:l.mode,uid:l.uid,gid:l.gid
   });
   if(snapshot?.durable!==true||snapshot?.sha256!==LIVE_SHA)
      fail('durable_backup_unverified');
   changed=true; // must mark before any possibly partial replacement
   await adapter.atomicReplace(TARGET,canonical,{
     expected_before_sha256:LIVE_SHA,expected_after_sha256:plan.target_sha256,
     mode:0o644,uid:0,gid:0
   });
   const current=await adapter.fileState(TARGET);
   if(current?.regular!==true||current?.symlink!==false||
      current?.sha256!==plan.target_sha256)
      fail('postwrite_sha_mismatch');
   await adapter.reloadAndHealth({expected_policy_sha256:plan.target_sha256});
   const audit={ok:true,action:ACTION,operation:OPERATION,request_id:auth.request_id,
     source_commit:SOURCE_COMMIT,policy_sha256_before:LIVE_SHA,
     policy_sha256_after:plan.target_sha256,
     mediator_sha256:MEDIATOR_SHA,policy_reloaded:true,
     changed_paths:[TARGET],role_created:false,
     outbox_changed:false,rollback_performed:false};
   await adapter.recordAudit(audit);
   return audit;
 }catch(e){
   if(changed){
     try{
       await adapter.restoreBackup(TARGET,snapshot);
       const restored=await adapter.fileState(TARGET);
       if(restored?.sha256!==LIVE_SHA)fail('rollback_sha_mismatch');
       await adapter.reloadAndHealth({expected_policy_sha256:LIVE_SHA});
       await adapter.recordAudit({ok:false,action:ACTION,request_id:auth.request_id,
         error_code:'POLICY_SYNC_ROLLED_BACK',rollback_performed:true});
     }catch(err){
       throw Error('policy_sync_rollback_incomplete:'+err.message);
     }
   }
   throw Error('policy_sync_failed:'+e.message);
 }finally{await release();}
}
module.exports={ACTION,OPERATION,SOURCE_COMMIT,TARGET,MEDIATOR,LIVE_SHA,MEDIATOR_SHA,
 CANON_BLOB,CANON_FILE,hash,blob,canonComparable,verifyPolicySemantics,getPlan,applyPrepared};
