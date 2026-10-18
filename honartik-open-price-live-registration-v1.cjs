'use strict';
/**
 * SOURCE-ONLY Level-4 registration transaction for the NEW production DDL
 * action. No CLI, direct installer, host command, signer or production access.
 *
 * The separate, existing TRUSTED root installer is solely responsible for
 * making approved owner-file patches and consuming a signed registration
 * approval distinct from subsequent LIVE migration approval.
 */
const crypto=require('node:crypto');
const ACTION='honartik_open_price_live_migrations_v1';
const INSTALL_OP='host_action.honartik_open_price_live_migrations_registration_v1';
const LIVE_OP='host_action.honartik_open_price_live_migrations_v1';
const SOURCES=Object.freeze({
  coordinator:Object.freeze({
    repository:'prhmonline/prhm-host-actions',
    path:'honartik-open-price-live-ddl-coordinator-v1.cjs',
    destination:'/opt/prhm-agent-selfmaint-exec/actions/honartik-open-price-live-ddl-coordinator-v1.cjs',
    gitBlob:'f18b83a2266a38637e6b945ca4a75aee75f92145'
  }),
  adapter:Object.freeze({
    repository:'prhmonline/prhm-host-actions',
    path:'honartik-open-price-live-native-adapter-v1.cjs',
    destination:'/opt/prhm-agent-selfmaint-exec/actions/honartik-open-price-live-native-adapter-v1.cjs',
    gitBlob:'447508cbeab5a39b1250f9492acd92f7b05e1142'
  })
});
const OWNERS=Object.freeze({
  base:Object.freeze({path:'/opt/prhm-agent-selfmaint/server.js',
    sha256:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406'}),
  executor:Object.freeze({path:'/opt/prhm-agent-selfmaint-exec/server.js',
    sha256:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0'}),
  mcp:Object.freeze({path:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
    sha256:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'}),
  policy:Object.freeze({path:'/opt/prhm-company-control-plane/config/approval-policy.json',
    sha256:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174'})
});
const KEYS=Object.freeze(['coordinator','adapter','base','executor','mcp','policy']);
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const gitBlob=b=>crypto.createHash('sha1')
  .update('blob '+b.length+'\0').update(b).digest('hex');
const fail=(x)=>{throw new Error('live_ddL_reg_'+x)};
function exact(o,names) {
 return !!o && typeof o==='object' && !Array.isArray(o) &&
   Object.keys(o).sort().join('|')===names.slice().sort().join('|');
}
function verifyCandidate(files){
 if(!exact(files,KEYS))fail('candidate_keyset');
 const result={};
 for(const key of KEYS){
   const source=SOURCES[key],owner=OWNERS[key],expected=source?.destination||owner?.path;
   const f=files[key];
   if(!f || f.path!==expected || !Buffer.isBuffer(f.bytes) ||
      f.bytes.length<100 || f.sha256!==sha256(f.bytes))
      fail('invalid_bytes_path_or_hash_'+key);
   if(source && gitBlob(f.bytes)!==source.gitBlob)
      fail('pinned_git_blob_mismatch_'+key);
   if(owner &&
      (!f.bytes.includes(Buffer.from(ACTION)) ||
       !f.bytes.includes(Buffer.from(LIVE_OP))))
      fail('owner_not_reviewed_for_live_action_'+key);
   result[key]=f.sha256;
 }
 return Object.freeze(result);
}
/**
 * cap is provided **only** by the installed root-only executor and must have
 * no caller JSON source. It owns owner patch generation, secret-free snapshots,
 * signer integration and one-time token storage.
 */
async function applyTrustedRegistration(cap){
 const methods=['readOwner','readPinnedSource','buildReviewedOwnerCandidate',
   'consumeSignedInstallLevel4','acquireRegistrationLock','snapshotOwners',
   'writeVerifiedOwner','verifyInstalledOwner','verifyExactActionRegistration',
   'restoreOwners','appendSignedAudit'];
 for(const k of methods)if(typeof cap?.[k]!=='function')
   fail('trusted_capability_missing_'+k);
 const preimage={};
 for(const [k,owner] of Object.entries(OWNERS)){
   const file=await cap.readOwner(owner.path);
   if(!file || !Buffer.isBuffer(file.bytes) || file.symlink!==false ||
     sha256(file.bytes)!==owner.sha256 || file.sha256!==owner.sha256)
      fail('owner_preimage_drift_'+k);
   preimage[k]=file;
 }
 const payload={};
 for(const [k,source] of Object.entries(SOURCES)){
   const present=await cap.readOwner(source.destination);
   if(present!==null)fail('already_installed_'+k);
   const bytes=await cap.readPinnedSource(source.repository,source.path,source.gitBlob);
   if(!Buffer.isBuffer(bytes) || gitBlob(bytes)!==source.gitBlob)
      fail('candidate_source_mismatch_'+k);
   payload[k]=bytes;
 }
 const reviewed=await cap.buildReviewedOwnerCandidate({
   action:ACTION,liveOperation:LIVE_OP,installOperation:INSTALL_OP,
   reviewedSourceGitBlobs:Object.fromEntries(Object.entries(SOURCES)
     .map(([k,v])=>[k,v.gitBlob]))
 },Object.freeze({...preimage}),Object.freeze({...payload}));
 const files={};
 for(const key of KEYS){
   const source=SOURCES[key],owner=OWNERS[key];
   const bytes=source?payload[key]:reviewed?.[key];
   files[key]={path:source?.destination||owner.path,bytes,
     sha256:Buffer.isBuffer(bytes)?sha256(bytes):null};
 }
 const digests=verifyCandidate(files);
 // Two distinct grants are required. Registration consumes ONLY this one;
 // live financial DDL requires a separate, later exact signed request.
 const receipt=await cap.consumeSignedInstallLevel4({
   action:ACTION,operation:INSTALL_OP,level:4,risk:'critical',
   ownerSha256:Object.fromEntries(Object.entries(OWNERS).map(([k,v])=>[k,v.sha256])),
   reviewedSourceBlobs:Object.fromEntries(Object.entries(SOURCES).map(([k,v])=>[k,v.gitBlob])),
   candidateSha256:digests,
   liveOperationIsNotGranted:true
 });
 if(!receipt || receipt.consumed!==true || receipt.level!==4 ||
    receipt.operation!==INSTALL_OP || receipt.action!==ACTION ||
    receipt.issuerChecked!==true || receipt.oneTime!==true ||
    receipt.liveDDLAuthorized!==false ||
    !exact(receipt.candidateSha256,KEYS) ||
    KEYS.some(k=>receipt.candidateSha256[k]!==digests[k]) ||
    !exact(receipt.ownerSha256,Object.keys(OWNERS)) ||
    Object.keys(OWNERS).some(k=>receipt.ownerSha256[k]!==OWNERS[k].sha256) ||
    !exact(receipt.reviewedSourceBlobs,Object.keys(SOURCES)) ||
    Object.keys(SOURCES).some(k=>receipt.reviewedSourceBlobs[k]!==SOURCES[k].gitBlob) ||
    typeof receipt.requestId!=='string' || receipt.requestId.length<16)
      fail('signed_install_scope_mismatch');
 const lock=await cap.acquireRegistrationLock(ACTION);
 let backup=null,attempted=false;
 try{
   for(const [key,owner] of Object.entries(OWNERS)){
      const now=await cap.readOwner(owner.path);
      if(!now || !Buffer.isBuffer(now.bytes) || now.symlink!==false ||
        sha256(now.bytes)!==owner.sha256 || now.sha256!==owner.sha256)
         fail('owner_changed_under_install_lock_'+key);
   }
   for(const src of Object.values(SOURCES))
     if(await cap.readOwner(src.destination)!==null)
       fail('new_action_appeared_under_lock');
   backup=await cap.snapshotOwners(KEYS.map(k=>files[k].path));
   if(!backup || backup.verified!==true)fail('rollback_snapshot_missing');
   attempted=true;
   for(const key of KEYS){
     const f=files[key];
     const mode=({coordinator:0o600,adapter:0o600,base:0o644,
       executor:0o755,mcp:0o600,policy:0o644})[key];
     await cap.writeVerifiedOwner(f.path,f.bytes,{
       owner:'root',group:'root',mode,sha256:f.sha256});
     await cap.verifyInstalledOwner(f.path,f.sha256);
   }
   const result=await cap.verifyExactActionRegistration({
     action:ACTION,liveOperation:LIVE_OP,registrationOperation:INSTALL_OP,
     installationSha256:digests,
     independentlyVerifiedLiveIssuer:true,
     noPermissionToRunDDLFromInstall:true,
     existingHostActionsPreserved:true
   });
   if(!result || result.registered!==true ||
      result.rootOwned!==true || result.issuerBound!==true ||
      result.durableAuditBound!==true || result.existingActionsPreserved!==true ||
      result.liveDDLExecuted!==false || result.liveGrantIssued!==false)
        fail('registered_runtime_unproven');
   const audit=await cap.appendSignedAudit({
     action:ACTION,operation:INSTALL_OP,requestId:receipt.requestId,
     event:'installed',candidateSha256:digests,
     productionDatabaseMutation:false,liveDDLApprovalConsumed:false
   });
   if(!audit || audit.persisted!==true)fail('install_audit_missing');
   return Object.freeze({ok:true,registered:true,requestId:receipt.requestId,
      productionDatabaseChanged:false,liveDDLAuthorized:false,digests});
 }catch(e){
   if(attempted){
     try{
       const restored=await cap.restoreOwners(backup);
       if(restored?.verified!==true)fail('rollback_result_unverified');
       const logged=await cap.appendSignedAudit({
         action:ACTION,operation:INSTALL_OP,requestId:receipt.requestId,
         event:'rollback',productionDatabaseMutation:false});
       if(!logged || logged.persisted!==true)fail('rollback_audit_missing');
     }catch{fail('rollback_failed_manual_intervention_required')}
   }
   throw e;
 }finally{await lock?.release?.()}
}
if(require.main===module){
 process.stderr.write('No CLI: only trusted installer with separate signed Level-4 registration grant.\n');
 process.exitCode=2;
}
module.exports=Object.freeze({ACTION,INSTALL_OP,LIVE_OP,SOURCES,OWNERS,KEYS,
  sha256,gitBlob,verifyCandidate,applyTrustedRegistration});
