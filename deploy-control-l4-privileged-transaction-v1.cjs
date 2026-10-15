'use strict';
/**
 * Fixed-scope production cutover transaction for a FUTURE trusted Host Action.
 * No CLI, no root registration, no network and no generic command execution.
 * Effectful capabilities must be implemented by an independently reviewed,
 * root-owned executor. This module refuses to bootstrap itself.
 */
const {createHash}=require('node:crypto');
const {CONTRACT}=require('./deploy-control-cutover-contract-v1.cjs');
const ACTION='deploy_control_cutover_install_v1';
const OPERATION='host_action.'+ACTION;
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=c=>{throw Error('deploy_control_l4_transaction_'+c)};
const SCOPE=Object.freeze({
 principal_id:'mohammad',role:'mcp-operator',tool:'host_action_v2_apply',
 project:'control_plane',environment:'production',action:ACTION,
 operation:OPERATION,risk:'critical',level:4,one_time_use:true
});
const ASSETS=Object.freeze([
 Object.freeze({path:'/opt/prhm-company-control-plane/config/approval-policy.json',
   key:'policy',sha256:'ed527c12ee330b8e1f5616fcb0c712eb89dddd9395197b2d855f00d3deea0678',mode:0o644}),
 Object.freeze({path:'/usr/local/libexec/deploy-control/deploy-project-authorized-v1.mjs',
   key:'dispatcher',sha256:'25ac66479fee08ce895ace0f9180e1f1b6b861f9e513a9ae7685bf03c347fc6c',mode:0o755}),
 Object.freeze({path:'/usr/local/libexec/deploy-control/production-approval-core.mjs',
   key:'core',sha256:'7656e12f9771b73ea0635f7fd29a5be9eac00cb7342532916c27894374c2261f',mode:0o644}),
 Object.freeze({path:'/etc/sudoers.d/prhm-deploy-control-gated',
   key:'sudoers',sha256:'d28298461ad03b3b1ede4413036f386e69f3266865034e4bac9045aea7582ba3',mode:0o440})
]);
const LEGACY=Object.freeze([
 Object.freeze({path:'/etc/sudoers.d/aranob-deploy-runner',
  sha256:'e097c3bbf78cac08ce8083d695db3ab5a6420462465085ec44ad866d5be0f79d'}),
 Object.freeze({path:'/etc/sudoers.d/deploy-control-honartik',
  sha256:'5c03114513c2770d3a77d32047c8911ddb5c4adcddea3fd3ed173d376ed5803e'})
]);
const STAGING=Object.freeze({path:'/etc/sudoers.d/honartik-staging-canonical-dry-run',
  sha256:'0c0d3bd5f4830826e34e703c87436fad04676599e1ea2c62570a74705a2b3b19'});
const BACKUP=Object.freeze({path:'/root/prhm-cutover-backup-8ntRjFRD/preimage.tar',
  sha256:'8108ef30c1a5b56fc25bebf52a67857ec77165c4c159354c876e622e0e0304b2'});
const CONFIG='/etc/prhm-deploy-control/approval-gate.json';
const POLICY_BEFORE=Object.freeze({version:CONTRACT.live_policy_version,
  hash:CONTRACT.live_policy_object_sha256});
const POLICY_AFTER=Object.freeze({version:CONTRACT.candidate_policy_version,
  hash:CONTRACT.candidate_policy_object_sha256});
const CAPABILITIES=Object.freeze([
 'assertTrustedRootExecutor','attestExactGitCommitAndBlobs','freezeAllDeployEntrypoints',
 'readTrustedFile','attestRootFileSha256','assertAbsent','inspectEffectiveSudoGrants',
 'verifyBackupArchive','createDurableRecoveryJournal','verifyRecoveryIsReady',
 'readPrivateExecutorToken','consumeSignedExactLevel4Authorization',
 'atomicWriteRootFile','removeExactLegacySudoers','validateFullSudoers',
 'reloadApprovalCenter','getApprovalCenterHealth','getFixedToolDiscovery',
 'verifyInstalledPostimages','restoreJournalAndReload','durableAudit',
 'unfreezeAllDeployEntrypoints'
]);
function keys(o,ks){
 return !!o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join('|')===ks.slice().sort().join('|');
}
function boundHost(h){
 if(!keys(h,CAPABILITIES)||CAPABILITIES.some(k=>typeof h[k]!=='function'))
   fail('missing_trusted_executor_capabilities');
 return h;
}
function verifySource(assets){
 if(!keys(assets,ASSETS.map(a=>a.key)))fail('untrusted_asset_set');
 for(const a of ASSETS)if(!Buffer.isBuffer(assets[a.key])||
    sha(assets[a.key])!==a.sha256)fail('source_blob_mismatch_'+a.key);
 return true;
}
function health(h,phase){
 const p=phase==='before'?POLICY_BEFORE:POLICY_AFTER;
 if(!h||h.ok!==true||h.service!=='prhm-company-approval'||
   h.mode!=='mcp-operator'||h.algorithm!=='Ed25519'||
   h.one_time_use!==true||h.policy_version!==p.version||
   h.policy_hash!==p.hash)fail('issuer_policy_'+phase+'_mismatch');
}
async function preflight(host,assets){
 const h=boundHost(host);
 verifySource(assets);
 if(await h.assertTrustedRootExecutor()!==true)fail('trusted_root_not_attested');
 if(await h.attestExactGitCommitAndBlobs({
     repository:'prhmonline/deploy-control',
     commit:'1e16bbb633a2d7b62d1322fe4c93bf9df346a748',
     policy_repository:'prhmonline/prhm-company-control-plane',
     policy_commit:'acffc7f9e02073f7aaf6ba92777f7acff6481f81',
     asset_hashes:Object.fromEntries(ASSETS.map(x=>[x.key,x.sha256]))
   })!==true)fail('git_source_not_attested');
 for(const rec of LEGACY){
   const b=await h.readTrustedFile(rec.path);
   if(!Buffer.isBuffer(b)||sha(b)!==rec.sha256)fail('legacy_sudoers_drift');
 }
 const staging=await h.readTrustedFile(STAGING.path);
 if(!Buffer.isBuffer(staging)||sha(staging)!==STAGING.sha256)
   fail('staging_grant_drift');
 // Root-owned executor must safely hash the on-disk policy preimage itself.
 if(await h.attestRootFileSha256(ASSETS[0].path)!==
    CONTRACT.live_policy_raw_sha256)fail('live_policy_drift');
 for(const target of ASSETS.slice(1))if(await h.assertAbsent(target.path)!==true)
   fail('unexpected_existing_target');
 if(await h.assertAbsent(CONFIG)!==true)fail('unexpected_private_config');
 if(await h.verifyBackupArchive(BACKUP)!==true)fail('recovery_archive_invalid');
 const before=await h.getApprovalCenterHealth();
 health(before,'before');
 if(await h.inspectEffectiveSudoGrants({phase:'before',
    old:LEGACY.map(x=>x.path),staging:STAGING.path})!==true)
   fail('legacy_sudo_expansion_unreviewed');
 const privateToken=await h.readPrivateExecutorToken();
 if(typeof privateToken!=='string'||privateToken.length<32||privateToken.length>4096)
   fail('private_executor_token_not_provisioned');
 // Never log the token. It must come from the root-owned private issuer bridge.
 const config=Buffer.from(JSON.stringify({
   base_url:'http://127.0.0.1:18133',
   expected_policy_version:POLICY_AFTER.version,
   expected_policy_hash:POLICY_AFTER.hash,
   executor_token:privateToken
 })+'\n');
 return {ok:true,config};
}
async function applyFixedCutover({host,assets}){
 // No runtime-selected action/project/paths/SHA/commands accepted here.
 const h=boundHost(host);
 let frozen=false,recorded=false,receiptConsumed=false,success=false;
 let recovery=null,stage='preflight',failure=null;
 try {
   const checked=await preflight(h,assets);
   if(checked.ok!==true)fail('preflight_failed');
   if(await h.freezeAllDeployEntrypoints()!==true)
     fail('external_deploy_freeze_unattested');
   frozen=true;
   recovery=await h.createDurableRecoveryJournal({
     backup:BACKUP,
     preimages:[ASSETS[0].path,...LEGACY.map(x=>x.path),STAGING.path],
     initially_absent:[...ASSETS.slice(1).map(x=>x.path),CONFIG],
     action:ACTION
   });
   if(!recovery||typeof recovery.id!=='string'||
      await h.verifyRecoveryIsReady(recovery)!==true)
     fail('durable_rollback_not_ready');
   recorded=true;
   stage='authorization';
   // Existing host executor MUST independently verify an Ed25519 signature,
   // active typed scope, exact Git release and one-time consumption. A boolean
   // or a user-supplied confirmation string is NOT sufficient.
   const receipt=await h.consumeSignedExactLevel4Authorization(SCOPE);
   if(!receipt||receipt.operation!==OPERATION||
      receipt.action!==ACTION||receipt.level!==4||
      receipt.risk!=='critical'||receipt.signed!==true||
      receipt.consumed_once!==true||receipt.source_git_pinned!==true||
      typeof receipt.request_id!=='string')
     fail('signed_one_time_l4_receipt_missing');
   receiptConsumed=true;
   const rollbackId=recovery.id,requestId=receipt.request_id;
   await h.durableAudit({action:ACTION,event:'authorized',rollbackId,requestId});
   stage='write_root_assets';
   for(const x of ASSETS.slice(1,3))
     if(await h.atomicWriteRootFile(x.path,assets[x.key],x.mode)!==true)
       fail('root_asset_install_failed');
   if(await h.atomicWriteRootFile(CONFIG,checked.config,0o600)!==true)
     fail('private_config_install_failed');
   if(await h.atomicWriteRootFile(ASSETS[3].path,assets.sudoers,0o440)!==true)
     fail('new_sudoers_install_failed');
   if(await h.validateFullSudoers()!==true)fail('candidate_sudoers_invalid');
   stage='revoke_legacy_grants';
   for(const old of LEGACY)
     if(await h.removeExactLegacySudoers(old.path,old.sha256)!==true)
       fail('legacy_grant_removal_failed');
   if(await h.validateFullSudoers()!==true)fail('sudoers_invalid_after_revoke');
   if(await h.inspectEffectiveSudoGrants({phase:'after',
      only_new:'/etc/sudoers.d/prhm-deploy-control-gated',
      staging:STAGING.path})!==true)fail('postinstall_sudo_expansion_untrusted');
   stage='activate_policy';
   if(await h.atomicWriteRootFile(ASSETS[0].path,assets.policy,0o644)!==true)
     fail('policy_install_failed');
   if(await h.reloadApprovalCenter()!==true)fail('policy_activation_failed');
   health(await h.getApprovalCenterHealth(),'after');
   if(await h.getFixedToolDiscovery(ACTION)!==true)
     fail('l4_action_not_registered_by_trusted_executor');
   if(await h.verifyInstalledPostimages({
       assets:ASSETS.map(({path,sha256,mode})=>({path,sha256,mode})),
       legacy_absent:LEGACY.map(x=>x.path),staging:STAGING
     })!==true)fail('postimage_or_staging_verification_failed');
   stage='audit_completion';
   await h.durableAudit({action:ACTION,event:'installed',rollbackId,requestId,
      status:'success',policy_version:POLICY_AFTER.version});
   success=true;
   return Object.freeze({ok:true,action:ACTION,request_id:requestId,
      rollback:'not_needed',fixed_action_discovered:true});
 } catch(e) {
   failure=String(e?.message||e).slice(0,180);
   if(recorded){
     stage='rollback';
     let restored=false;
     try {
       restored=await h.restoreJournalAndReload(recovery)===true;
       if(restored){
         health(await h.getApprovalCenterHealth(),'before');
         for(const old of LEGACY){
           const b=await h.readTrustedFile(old.path);
           if(!Buffer.isBuffer(b)||sha(b)!==old.sha256)restored=false;
         }
       }
     }catch{restored=false}
     if(!restored){
       try{await h.durableAudit({action:ACTION,event:'rollback_unverified',stage,failure})}catch{}
       throw Error('deploy_control_l4_transaction_ROLLBACK_UNVERIFIED');
     }
     try{await h.durableAudit({action:ACTION,event:'rollback_verified',stage,failure,
       receiptConsumed})}catch{
       throw Error('deploy_control_l4_transaction_ROLLBACK_VERIFIED_AUDIT_FAILED');
     }
   }
   throw Error('deploy_control_l4_transaction_DENIED_OR_ROLLED_BACK');
 } finally {
   if(frozen){
     try {
       if(await h.unfreezeAllDeployEntrypoints()!==true)
         throw Error('unfreeze_failed');
     }catch{
       if(success)throw Error('deploy_control_l4_transaction_UNFREEZE_FAILED_MANUAL_CHECK');
       // On prior error preserve fail-closed state; report through root journal.
     }
   }
 }
}
module.exports=Object.freeze({ACTION,OPERATION,SCOPE,ASSETS,LEGACY,STAGING,BACKUP,
 CAPABILITIES,verifySource,preflight,applyFixedCutover});
