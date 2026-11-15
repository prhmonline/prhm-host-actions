'use strict';
/**
 * U06 real Root callback adapter, all 16 methods required by the coordinator.
 *
 * Construct ONLY from an installed Root HostAction v2 bridge after the official
 * Approval Center authorize-consume. The independent verifier still rechecks
 * the signed Ed25519 JWS + authoritative consumption ledger and burns a durable
 * one-use fence BEFORE provisioning MySQL. Verified GitHub owner OIDC remains
 * separately mandatory. No direct CLI, public HTTP route or approval issuer.
 *
 * Backend/Yii/Apache are never modified. Any untrusted or unknown state
 * fails closed and retains the Root lease/journal for manual reconciliation.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const cp=require('node:child_process'),crypto=require('node:crypto');
const Coordinator=require('./honartik-u06-owner-native-transaction-v1.cjs');
const Owner=require('./honartik-u06-owner-oidc-identity-gate-v1.cjs');
const Lease=require('./honartik-u06-native-root-lease-v1.cjs');
const Identity=require('./honartik-u06-native-root-mariadb-identity-v1.cjs');
const Shared=require('./honartik-u06-shared-exclusive-lock-v1.cjs');
const F=Coordinator.F;
const WORKER='/opt/prhm-agent-selfmaint-exec/actions/u06_live_native_root_worker_v1.py';
const WORKER_SHA='71fe3cd424289896fa7ee7033dbe6ac2508518b89deeebd8584fa4d930e43b89';
const BACKUPS='/var/backups/prhm-u06-native';
const ROOT=Lease.LIVE.directory;
const LOG_SAFE=/^[a-z0-9_-]{12,100}$/i;
const HEX=/^[a-f0-9]{64}$/;
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=x=>{throw Error('u06_real_native_root_'+x)};
const need=(v,x)=>{if(!v)fail(x)};
function rootDir(d){
 const x=fs.lstatSync(d);
 need(x.isDirectory()&&!x.isSymbolicLink()&&x.uid===0&&x.gid===0&&
  (x.mode&0o777)===0o700,'root_private_dir_required');
}
function trustedFile(p,sha,max=250000){
 const st=fs.lstatSync(p);
 need(st.isFile()&&!st.isSymbolicLink()&&st.uid===0&&st.gid===0&&
  (st.mode&0o022)===0&&st.nlink===1&&st.size>0&&st.size<=max,
  'untrusted_pinned_file');
 const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const now=fs.fstatSync(fd);
  need(now.ino===st.ino&&now.dev===st.dev&&now.size===st.size,'file_raced');
  const raw=fs.readFileSync(fd);
  if(sha)need(H(raw)===sha,'pinned_file_sha_drift');
  return raw;
 }finally{fs.closeSync(fd)}
}
function appFingerprint(){
 const p='/srv/deploy-control/honartik_back/production';
 const parts=[p,p+'/releases',p+'/prepared'];
 return H(Buffer.from(JSON.stringify(parts.map(item=>{
   const st=fs.lstatSync(item);
   need(st.isDirectory()&&!st.isSymbolicLink(),'application_path_drift');
   return {path:item,dev:st.dev,ino:st.ino,mtime:st.mtimeMs,ctime:st.ctimeMs};
 }))));
}
function atomicallyRestoreProfile(original,postHash){
 const p=Lease.LIVE.profile;
 const cur=trustedFile(p,null,100000);
 const actual=H(cur);
 need(actual===H(original)||actual===postHash,'rollback_profile_changed_by_other_actor');
 if(actual===H(original))return;
 const st=fs.lstatSync(p),temp=p+'.u06-rollback-'+crypto.randomBytes(8).toString('hex');
 const fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|
   fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{
  fs.writeFileSync(fd,original);
  fs.fchownSync(fd,st.uid,st.gid);
  fs.fchmodSync(fd,st.mode&0o777);
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 fs.renameSync(temp,p);
 const d=fs.openSync(path.dirname(p),fs.constants.O_RDONLY|
    fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
 need(H(trustedFile(p,null,100000))===H(original),
  'rollback_profile_not_exact');
}
function profileRequireOffsite(before){
 need(H(trustedFile(Lease.LIVE.profile,null,100000))===F.profile_sha256_before,
   'profile_changed_during_backup');
 const doc=JSON.parse(before.toString('utf8'));
 need(doc.backup&&doc.backup.offsite_required===false,'offsite_profile_baseline');
 doc.backup.offsite_required=true;
 const encoded=Buffer.from(JSON.stringify(doc,null,2)+'\n');
 const p=Lease.LIVE.profile;
 const st=fs.lstatSync(p);
 need(st.uid===0&&st.gid===0&&st.isFile()&&!st.isSymbolicLink(),
    'profile_not_root_regular');
 const tmp=p+'.u06-next-'+crypto.randomBytes(8).toString('hex');
 let fd;
 try{
  fd=fs.openSync(tmp,fs.constants.O_CREAT|fs.constants.O_EXCL|
   fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  fs.writeFileSync(fd,encoded);
  fs.fchownSync(fd,st.uid,st.gid);
  fs.fchmodSync(fd,st.mode&0o777);
  fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
  fs.renameSync(tmp,p);
  const dir=fs.openSync(path.dirname(p),fs.constants.O_RDONLY|
    fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}
 }finally{if(fd!==null&&fd!==undefined)fs.closeSync(fd)}
 need(H(trustedFile(p,null,100000))===H(encoded),
  'offsite_profile_postimage_invalid');
 return H(encoded);
}
function freshNode1CentralEvidence(){
 const dir='/var/lib/prhm-backup/node1-central';
 const list=fs.readdirSync(dir).filter(n=>/^run-20[0-9]{6}T[0-9]{6}Z\.json$/.test(n))
   .sort();
 need(list.length>0,'existing_independent_offsite_missing');
 const e=JSON.parse(trustedFile(path.join(dir,list[list.length-1]),null,20000));
 const end=Date.parse(e.finished_utc||'');
 need(e.schema==='prhm.node1-central-restic-evidence.v1'&&e.status==='PASS'&&
  e.full_restore_ok===true&&e.encrypted_offsite_backup_ok===true&&
  e.database_mutation===false&&
  /^[0-9a-f]{64}$/.test(e.restic_snapshot_id||'')&&
  Number.isFinite(end)&&Math.abs(Date.now()-end)<36*60*60*1000,
  'recent_independent_offsite_not_proven');
 return true;
}
function workerCall(step,runId,approvalId){
 need(['native_backup','verify_native','native_offsite'].includes(step) &&
  LOG_SAFE.test(runId||'')&&
  /^[0-9a-f-]{36}$/i.test(approvalId||''),'worker_step_invalid');
 trustedFile(WORKER,WORKER_SHA,200000);
 const code=[
 "import json,os,sys",
 "sys.path.insert(0,'/opt/prhm-agent-selfmaint-exec/actions')",
 "import u06_live_native_root_worker_v1 as m",
 "step=os.environ['U06_INTERNAL_STAGE']",
 "assert step in ('native_backup','verify_native','native_offsite')",
 "print(json.dumps(getattr(m,step)(os.environ['U06_RUN_ID'],os.environ['U06_APPROVAL_ID'])))"
 ].join('\n');
 const result=cp.spawnSync('/usr/bin/python3.11',['-c',code],{
   env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
     LC_ALL:'C',HOME:'/nonexistent',U06_INTERNAL_STAGE:step,
     U06_RUN_ID:runId,U06_APPROVAL_ID:approvalId},
   timeout:2*60*60*1000,maxBuffer:60000,
   stdio:['ignore','pipe','pipe'],encoding:'utf8'
 });
 // In no case relay stderr: Python/Docker/Restic may contain private output.
 need(!result.error&&result.status===0&&!result.signal,
   'fixed_native_worker_stage_failed_'+step);
 let record;try{record=JSON.parse(result.stdout.trim())}
 catch{fail('worker_response_not_json_'+step)}
 return record;
}
function makeRootCallbacks({requestId,sealedToken,authoritativeConsumed,ownerProof,sharedBinding}={}){
 Shared.assertSourceBoundLease(sharedBinding,'native_backup_transaction');
 need(process.getuid?.()===0&&os.hostname()===F.host,'trusted_root_host_required');
 need(Owner.proofVerifiedInCurrentProcess(ownerProof),
   'official_github_owner_oidc_not_verified');
 need(authoritativeConsumed&&authoritativeConsumed.valid===true&&
  authoritativeConsumed.consumed===true&&typeof sealedToken==='string'&&
  sealedToken.length>=120&&sealedToken.length<=16384,
  'trusted_official_l4_consume_context_missing');
 rootDir(ROOT);rootDir(path.join(ROOT,'l4-consumed'));rootDir(BACKUPS);
 const lease=Lease.createLiveRootLease(sharedBinding);
 const identity=Identity.createLiveBoundProvider(requestId,()=>sealedToken);
 let original=null,locked=false,journal=null,approval=null,created=false;
 let native=null,restored=null,node1=null,profilePost=null;
 let initialApp=null,rolledBack=false;
 const ensureJ=j=>{
   need(locked&&journal&&j&&j.id===journal.id&&
    LOG_SAFE.test(j.id),'journal_not_bound');
 };
 return Object.freeze({
  exclusiveU06Lock(){
   need(!locked,'already_locked');
   const out=lease.acquire();
   locked=true;
   return out;
  },
  readExactPreimage(){
   need(locked,'lock_missing');
   const p=lease.attestPreimage();
   identity.readOnlyPreflight();
   original=p.profile;
   initialApp=appFingerprint();
   return {
    host:F.host,project:F.project,adapter_sha256:p.adapter_sha256,
    profile_sha256:p.profile_sha256,native_credential_absent:true,
    offsite_required_before:false,database:F.database,
    provider_dependency_removed:true
   };
  },
  verifyIndependentNode1Recovery(){
   need(locked&&original,'preflight_missing');
   return freshNode1CentralEvidence();
  },
  prepareDurableRollbackJournal(){
   journal=lease.prepareJournal();return journal;
  },
  assertRollbackJournalDurable(_,j){
   ensureJ(j);
   return lease.journalState()==='PREPARED';
  },
  verifyNativeConsumedSignedLevel4(_,j){
   ensureJ(j);
   approval=identity.verifyNativeConsumedSignedLevel4(F,j);
   return approval;
  },
  reserveNativeLevel4ReplayFence(_,j,receipt){
   ensureJ(j);
   need(approval===receipt,'receipt_not_owner_verified');
   return identity.reserveNativeLevel4ReplayFence(F,j,receipt);
  },
  provisionBackupOnlyIdentityAndPrivateCredential(_,j){
   ensureJ(j);need(approval!==null,'consumed_approval_absent');
   const result=identity.provisionBackupOnlyIdentityAndPrivateCredential(F,j);
   need(result.grants_exact===true&&result.tcp_login_verified===true,
    'native_credential_failed');
   created=true;return result;
  },
  runInstalledUniversalNativeBackup(_,j){
   ensureJ(j);need(created,'no_native_identity');
   native=workerCall('native_backup',j.id,approval.approval_id);
   need(HEX.test(native.backup_sha256)&&native.source_finance_stable===true,
    'native_backup_receipt_invalid');
   return native;
  },
  verifyIsolatedRestoreAndFinancialIntegrity(_,j){
   ensureJ(j);need(native!==null,'native_backup_missing');
   restored=workerCall('verify_native',j.id,approval.approval_id);
   need(restored.backup_sha256===native.backup_sha256&&
    restored.restored_tables===69&&restored.restored_fk_count===49&&
    restored.finance_parity===true&&restored.mysqlcheck===true,
    'native_restore_or_finance_not_proven');
   return restored;
  },
  enableRequiredOffsiteWithRollback(_,j){
   ensureJ(j);need(restored!==null,'native_restore_missing');
   node1=workerCall('native_offsite',j.id,approval.approval_id);
   need(node1.node1_restored===true&&node1.full_finance_parity===true,
    'native_node1_restore_not_proven');
   profilePost=profileRequireOffsite(original);
   return true;
  },
  verifyExactPostflight(_,j){
   ensureJ(j);
   need(node1&&restored&&native&&profilePost,'postflight_missing');
   need(lease.journalState()==='PREPARED','root_journal_not_prepared');
   need(H(trustedFile(Lease.LIVE.profile,null,100000))===profilePost,
    'profile_postflight_sha_drift');
   const st=fs.lstatSync(Lease.LIVE.credential);
   need(st.isFile()&&!st.isSymbolicLink()&&st.uid===0&&
    (st.mode&0o777)===0o600,'credential_not_private');
   need(appFingerprint()===initialApp,'application_changed');
   const evidence=JSON.parse(trustedFile(path.join(BACKUPS,j.id,
    'native-node1-offsite-evidence.json'),null,200000));
   need(evidence.backup_sha256===native.backup_sha256&&
    evidence.restored_tables===69&&evidence.foreign_keys===49&&
    evidence.finance_parity===true&&
    evidence.full_restic_restore===true&&
    evidence.remote_independent_69_table_restore===true,
    'native_node1_evidence_invalid');
   return {
    native_backup_sha256:native.backup_sha256,
    actual_native_functions_executed:true,restored_tables:69,
    restored_fk_count:49,finance_counts_and_amounts_unchanged:true,
    wallet_and_reserve_integrity_verified:true,full_mysqlcheck_pass:true,
    offsite_required_true:true,offsite_remote_evidence_fresh:true,
    credential_file_private:true,root_journal_durable:true,
    production_application_unchanged:true,yii_migrations_unchanged:true
   };
  },
  commitDurableJournal(_,j,post){
   ensureJ(j);
   Coordinator.checkPostflight(post);
   need(profilePost&&node1&&native,'commit_unverified');
   return lease.verifyAndRecordCommit({
     full_real_native_verified:true,independent_native_node1_verified:true,
     backup_sha256:native.backup_sha256,post_profile_sha256:profilePost
   }).committed;
  },
  rollbackExactPreimage(_,j){
   ensureJ(j);
   if(profilePost)atomicallyRestoreProfile(original,profilePost);
   if(created){identity.rollbackOnlyThisTransaction(F,j);created=false;}
   const v=lease.verifyAndRecordRollback();
   rolledBack=v.rolled_back===true;
   return rolledBack;
  },
  verifyExactRollback(_,j){
   ensureJ(j);
   need(rolledBack&&lease.journalState()==='ROLLED_BACK'&&
    H(trustedFile(Lease.LIVE.profile,null,100000))===H(original),
    'rollback_source_not_verified');
   return true;
  },
  releaseU06Lock(){
   need(locked,'no_lease_to_release');
   const result=lease.release();
   locked=false;
   return result;
  }
 });
}
async function runOnlyFromTrustedRootBridge(input){
 need(input&&typeof input==='object'&&Object.keys(input).sort().join('|')===
  ['requestId','sealedToken','authoritativeConsumed','ownerProof','sharedBinding'].sort().join('|'),
  'trusted_invocation_shape');
 Shared.assertSourceBoundLease(input.sharedBinding,'native_backup_transaction');
 const native=makeRootCallbacks(input);
 return Coordinator.coordinateOwnerU06(native,input.ownerProof,{sharedBinding:input.sharedBinding});
}
module.exports=Object.freeze({
 WORKER,WORKER_SHA,makeRootCallbacks,runOnlyFromTrustedRootBridge,
 COMPLETE_16_ROOT_METHODS:true,
 REGISTERED_IN_PRODUCTION:false,
 BOOTSTRAP_INSTALLED:false,
 DIRECT_CLI_EXPORTED:false,
 APPROVAL_ISSUER_EXPORTED:false
});
if(require.main===module){
 process.stderr.write('U06 native Root module has no direct CLI, requires trusted L4 Root bridge.\n');
 process.exitCode=64;
}
