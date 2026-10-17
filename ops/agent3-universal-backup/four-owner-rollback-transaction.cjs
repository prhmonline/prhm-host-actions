'use strict';
/**
 * Four-Control-Plane-owner write-ahead rollback TRANSACTION PROTOTYPE.
 *
 * Restricted to a privately owned /tmp fixture tree. This is intentionally
 * NOT callable on Production owners. It cannot mint/consume approvals, invoke
 * a root executor, register tools, spawn a shell or restart systemd. The actual
 * trusted root adapter must separately attest the four immutable Git postimage
 * blobs, live preimages, signed consumed Level-4 JWS, matching native request
 * ID, root capabilities, service restarts and rollback before production use.
 *
 * It provides real descriptor-checked backup, O_EXCL lock, fsync barriers,
 * per-file atomic replace, audit journal, health phase and rollback that tests
 * crash-adjacent failures before a production-capable integration is reviewed.
 *
 * A process crash may leave an existing private lock and partial state. This
 * requires independent root recovery, NOT automatic deletion/retry. Automatic
 * in-process exception rollback is verified; no false multi-file atomicity.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const gateway=require('../../prhm-action-registry-gateway-v1.cjs');
const KEYS=Object.freeze(['base','executor','policy','mcp']);
const SHA=/^[0-9a-f]{64}$/;
const MAX_BYTES=20*1024*1024;
const flags=fs.constants;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function deny(reason){throw Error('agent3_four_owner_txn_denied:'+reason);}
function exact(v,keys){return !!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join('|')===keys.slice().sort().join('|');}
function fsyncDir(dir){
 const fd=fs.openSync(dir,flags.O_RDONLY|flags.O_DIRECTORY|flags.O_NOFOLLOW);
 try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function rootDir(dir){
 const canon=fs.realpathSync(dir),sandbox=fs.realpathSync(os.tmpdir());
 if(!path.isAbsolute(dir)||dir!==path.resolve(dir)||dir!==canon||
    !dir.startsWith(sandbox+path.sep))
  deny('fixture_root_only');
 const st=fs.lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid?.()||
    (st.mode&0o077)!==0)deny('private_fixture_directory_required');
 return st;
}
function ownerRead(file,parent){
 if(!path.isAbsolute(file)||path.dirname(file)!==parent||
    fs.realpathSync(parent)!==parent)deny('owner_outside_fixture');
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid?.()||
    st.size<1||st.size>MAX_BYTES||(st.mode&0o022)!==0)
  deny('unsafe_owner');
 const fd=fs.openSync(file,flags.O_RDONLY|flags.O_NOFOLLOW|flags.O_NONBLOCK);
 try{
  const a=fs.fstatSync(fd);
  if(!a.isFile()||a.ino!==st.ino||a.dev!==st.dev||
     a.uid!==st.uid||a.size!==st.size)deny('owner_open_race');
  const bytes=fs.readFileSync(fd),b=fs.fstatSync(fd);
  if(bytes.length!==a.size||b.ino!==a.ino||b.dev!==a.dev||
     b.size!==a.size||b.mtimeMs!==a.mtimeMs||b.ctimeMs!==a.ctimeMs)
    deny('owner_read_race');
  return Object.freeze({bytes,sha:sha(bytes),mode:a.mode&0o777});
 }finally{fs.closeSync(fd);}
}
function exclusiveFile(file,bytes,mode=0o600){
 const fd=fs.openSync(file,flags.O_WRONLY|flags.O_CREAT|flags.O_EXCL|flags.O_NOFOLLOW,mode);
 try{
  let off=0;
  while(off<bytes.length){
   const count=fs.writeSync(fd,bytes,off,bytes.length-off,null);
   if(count<=0)deny('write_short');
   off+=count;
  }
  fs.fchmodSync(fd,mode&0o777);
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd);}
}
function replaceChecked(file,parent,bytes,expectedCurrent,mode,txn){
 const current=ownerRead(file,parent);
 if(current.sha!==expectedCurrent)deny('concurrent_owner_drift');
 const temp=path.join(parent,'.'+path.basename(file)+'.'+txn+'.tmp');
 exclusiveFile(temp,bytes,mode);
 try{
  fs.renameSync(temp,file);
  fsyncDir(parent);
 }finally{
  try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 const reloaded=ownerRead(file,parent);
 if(reloaded.sha!==sha(bytes))deny('owner_postimage_drift');
}
/**
 * Isolated prototype deliberately rejects Production owners regardless of
 * caller approval claims. Parameters are trusted only for ephemeral fixture
 * tests and independent rollback rehearsal.
 */
async function runIsolatedFourOwnerTransaction({
 ownerPaths,beforeSha,afterSha,afterBuffers,
 journalRoot,healthProbe,observer=()=>{}
}={}){
 if(!exact(ownerPaths,KEYS)||!exact(beforeSha,KEYS)||
    !exact(afterSha,KEYS)||!exact(afterBuffers,KEYS)||
    typeof healthProbe!=='function'||typeof observer!=='function')
  deny('exact_four_owner_contract_required');
 if(typeof journalRoot!=='string')deny('journal_root_required');
 rootDir(journalRoot);
 // Reject known Production paths BEFORE *any* stat, realpath or file access.
 // This guard deliberately fails even on CI hosts without those paths.
 const base=typeof ownerPaths.base==='string'?path.dirname(ownerPaths.base):'';
 if(!base||Object.values(ownerPaths).some(f=>typeof f!=='string'||
    Object.values(gateway.OWNER_PATHS).includes(f)||path.dirname(f)!==base))
  deny('production_or_cross_directory_owner_disallowed');
 rootDir(base);
 // Disallow even a privately mounted alias of the production owner files.
 const unique=new Set(Object.values(ownerPaths));
 if(unique.size!==4)deny('duplicate_owner_target');
 const snapshot={};
 for(const k of KEYS){
  if(!SHA.test(beforeSha[k])||!SHA.test(afterSha[k])||
     !Buffer.isBuffer(afterBuffers[k])||afterBuffers[k].length<1||
     afterBuffers[k].length>MAX_BYTES||sha(afterBuffers[k])!==afterSha[k]||
     beforeSha[k]===afterSha[k])deny('unverified_candidate:'+k);
  const current=ownerRead(ownerPaths[k],base);
  if(current.sha!==beforeSha[k])deny('preimage_drift:'+k);
  snapshot[k]=current;
 }
 const lockPath=path.join(journalRoot,'.four-owner-install.lock');
 const tx=crypto.randomUUID(),backupDir=path.join(journalRoot,'txn-'+tx);
 let lock;
 try{lock=fs.openSync(lockPath,flags.O_WRONLY|flags.O_CREAT|
   flags.O_EXCL|flags.O_NOFOLLOW,0o600);}
 catch(e){if(e.code==='EEXIST')deny('existing_or_stale_transaction_lock');throw e;}
 const updated=[];
 let committed=false,rollbackVerified=false;
 try{
  // A durable lock-to-escrow binding is required for recovery after SIGKILL.
  // The file is never replaced, recycled or silently removed on ambiguity.
  const lockRecord=Buffer.from(JSON.stringify({
   schema:'prhm.agent3.four-owner-fixture-lock.v1',
   mode:'FIXTURE_ONLY_NOT_PRODUCTION',txn:tx
  })+'\n');
  fs.writeSync(lock,lockRecord);
  fs.fsyncSync(lock);
  fsyncDir(journalRoot);
  fs.mkdirSync(backupDir,{mode:0o700});
  for(const k of KEYS)exclusiveFile(path.join(backupDir,k+'.preimage'),
    snapshot[k].bytes);
  const manifest={schema:'prhm.agent3.four-owner-rollback-evidence.v1',
   txn:tx,mode:'FIXTURE_ONLY_NOT_PRODUCTION',owners:Object.fromEntries(
    KEYS.map(k=>[k,{path:ownerPaths[k],mode:snapshot[k].mode,
     before_sha256:beforeSha[k],after_sha256:afterSha[k]}])),
   before_mutation_backups_fsynced:true};
  exclusiveFile(path.join(backupDir,'manifest.json'),
   Buffer.from(JSON.stringify(manifest)+'\n'));
  fsyncDir(backupDir);fsyncDir(journalRoot);
  observer({phase:'durable_preimages',completed:0});
  for(const k of KEYS){
   updated.push(k); // Track even a failure AFTER rename but BEFORE verification.
   replaceChecked(ownerPaths[k],base,afterBuffers[k],beforeSha[k],snapshot[k].mode,tx);
   observer({phase:'owner_replaced',key:k,completed:updated.length});
  }
  const health=await healthProbe({phase:'postinstall',ownerCount:4});
  if(!health||health.ok!==true||health.owners_verified!==true||
     health.services_active!==4)deny('postinstall_health_unverified');
  committed=true;
  return Object.freeze({ok:true,mode:'FIXTURE_ONLY_NOT_PRODUCTION',
   updated_owner_count:4,rollback:'not_needed',
   durable_preimage_dir:backupDir,services_active:4,
   signed_approval_consumed:false,production_mutated:false});
 }catch(e){
  // Never replace a concurrently modified target. A separate signed recovery
  // transaction must handle collisions; never falsely report rollback done.
  const errors=[];
  for(const k of updated.slice().reverse()){
   try{
    const backup=ownerRead(path.join(backupDir,k+'.preimage'),backupDir);
    if(backup.sha!==beforeSha[k])deny('escrow_drift:'+k);
    const live=ownerRead(ownerPaths[k],base);
    if(live.sha===beforeSha[k])continue; // No rename occurred.
    if(live.sha!==afterSha[k])deny('concurrent_owner_drift_during_rollback:'+k);
    replaceChecked(ownerPaths[k],base,backup.bytes,afterSha[k],snapshot[k].mode,tx+'-rb');
   }catch(err){errors.push(k+':'+String(err.message||err).slice(0,95));}
  }
  for(const k of KEYS){
   try{if(ownerRead(ownerPaths[k],base).sha!==beforeSha[k])errors.push('not_restored:'+k);}
   catch(err){errors.push('unreadable:'+k);}
  }
  if(!errors.length){
   try{
    const verified=await healthProbe({phase:'rollback',ownerCount:4});
    if(!verified||verified.ok!==true||verified.owners_verified!==true||
       verified.services_active!==4)errors.push('rollback_services_unhealthy');
   }catch(err){errors.push('rollback_probe_failed');}
  }
  rollbackVerified=errors.length===0;
  if(errors.length)throw Error('agent3_four_owner_txn_rollback_unverified:'+
    errors.join('|').slice(0,600));
  throw Error('agent3_four_owner_txn_failed_rollback_verified:'+
    String(e.message||e).slice(0,180));
 }finally{
  if(lock!==undefined){
   const st=fs.fstatSync(lock);
   fs.closeSync(lock);
   const exists=fs.lstatSync(lockPath);
   if(exists.ino!==st.ino||exists.dev!==st.dev||!exists.isFile())
    deny('lock_inode_replaced');
   // Keep evidence and failed crash markers if recovery was not verified.
   // A JS exception can be safely unlocked ONLY after commit or verified
   // rollback, never after an ambiguous recovery.
   if(committed||rollbackVerified){
    fs.unlinkSync(lockPath);fsyncDir(journalRoot);
   }
  }
 }
}

/**
 * Recovery from a REAL abruptly terminated fixture process.
 * There is no current authority to use this on the four Production paths.
 *
 * The immutable lock identifies precisely one durable escrow. All four
 * preimages, manifest bindings and live states are checked BEFORE a write.
 * Any foreign third-party SHA or damaged escrow fails closed. A second
 * O_EXCL recovery lock prevents two simultaneous recovery attempts.
 *
 * A failed recovery keeps both locks and the escrow intact. A successful
 * recovery verifies byte SHAs, mode bits and the external health check before
 * unlocking; it never deletes the forensic preimages.
 */
async function recoverIsolatedFourOwnerTransaction({ownerPaths,journalRoot,healthProbe}={}){
 if(!exact(ownerPaths,KEYS)||typeof journalRoot!=='string'||
    typeof healthProbe!=='function')deny('recovery_contract_required');
 // Reject real Production targets before ANY attempt to stat their parent.
 if(Object.values(ownerPaths).some(p=>typeof p!=='string'||
    Object.values(gateway.OWNER_PATHS).includes(p)))
  deny('recovery_production_owner_disallowed');
 rootDir(journalRoot);
 const parent=path.dirname(ownerPaths.base);
 if(Object.values(ownerPaths).some(p=>path.dirname(p)!==parent)||
    new Set(Object.values(ownerPaths)).size!==4)
  deny('recovery_cross_directory_or_duplicate_owner');
 rootDir(parent);
 const lockPath=path.join(journalRoot,'.four-owner-install.lock');
 const st=fs.lstatSync(lockPath);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid?.()||
    (st.mode&0o077)!==0||st.size<50||st.size>1024)
  deny('recovery_untrusted_transaction_lock');
 const fd=fs.openSync(lockPath,flags.O_RDONLY|flags.O_NOFOLLOW);
 let raw,verifiedInode;
 try{
  verifiedInode=fs.fstatSync(fd);
  if(verifiedInode.ino!==st.ino||verifiedInode.dev!==st.dev)
   deny('recovery_lock_swapped');
  raw=fs.readFileSync(fd);
  if(raw.length!==verifiedInode.size)deny('recovery_lock_changed');
 }finally{fs.closeSync(fd);}
 let lockRecord;
 try{lockRecord=JSON.parse(raw.toString('utf8'));}
 catch{deny('recovery_invalid_lock_record');}
 if(!exact(lockRecord,['schema','mode','txn'])||
    lockRecord.schema!=='prhm.agent3.four-owner-fixture-lock.v1'||
    lockRecord.mode!=='FIXTURE_ONLY_NOT_PRODUCTION'||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(lockRecord.txn))
  deny('recovery_unrecognized_lock_record');
 const escrow=path.join(journalRoot,'txn-'+lockRecord.txn);
 rootDir(escrow);
 const manifestPath=path.join(escrow,'manifest.json');
 const manifestRec=ownerRead(manifestPath,escrow);
 let manifest;
 try{manifest=JSON.parse(manifestRec.bytes.toString('utf8'));}
 catch{deny('recovery_manifest_parse');}
 if(!exact(manifest,['schema','txn','mode','owners','before_mutation_backups_fsynced'])||
    manifest.schema!=='prhm.agent3.four-owner-rollback-evidence.v1'||
    manifest.mode!=='FIXTURE_ONLY_NOT_PRODUCTION'||
    manifest.txn!==lockRecord.txn||
    manifest.before_mutation_backups_fsynced!==true||
    !exact(manifest.owners,KEYS))
  deny('recovery_manifest_binding_invalid');
 const originals={},restorable={};
 for(const k of KEYS){
  const claim=manifest.owners[k];
  if(!exact(claim,['path','mode','before_sha256','after_sha256'])||
     claim.path!==ownerPaths[k]||claim.path!==path.resolve(claim.path)||
     !Number.isInteger(claim.mode)||claim.mode<0||claim.mode>0o777||
     !SHA.test(claim.before_sha256)||!SHA.test(claim.after_sha256)||
     claim.before_sha256===claim.after_sha256)
    deny('recovery_manifest_owner_drift:'+k);
  const escrowFile=ownerRead(path.join(escrow,k+'.preimage'),escrow);
  if(escrowFile.sha!==claim.before_sha256)deny('recovery_escrow_tampered:'+k);
  const live=ownerRead(ownerPaths[k],parent);
  if(![claim.before_sha256,claim.after_sha256].includes(live.sha))
   deny('recovery_foreign_owner_change:'+k);
  if(live.sha===claim.before_sha256&&live.mode!==claim.mode)
   deny('recovery_original_mode_drift:'+k);
  originals[k]=escrowFile;
  restorable[k]=live.sha===claim.after_sha256;
 }
 const recoveryLock=path.join(journalRoot,'.four-owner-recovery.lock');
 let recoveryFd;
 try{recoveryFd=fs.openSync(recoveryLock,
    flags.O_WRONLY|flags.O_CREAT|flags.O_EXCL|flags.O_NOFOLLOW,0o600);}
 catch(e){if(e.code==='EEXIST')deny('recovery_already_running_or_stale');throw e;}
 let verified=false;
 try{
  fs.fsyncSync(recoveryFd);fsyncDir(journalRoot);
  for(const k of KEYS.slice().reverse()){
   if(!restorable[k])continue;
   const spec=manifest.owners[k];
   replaceChecked(ownerPaths[k],parent,originals[k].bytes,
    spec.after_sha256,spec.mode,lockRecord.txn+'-recover');
  }
  for(const k of KEYS){
   const live=ownerRead(ownerPaths[k],parent);
   if(live.sha!==manifest.owners[k].before_sha256||
      live.mode!==manifest.owners[k].mode)
    deny('recovery_postimage_invalid:'+k);
  }
  const healthy=await healthProbe({phase:'recovery',ownerCount:4});
  if(!healthy||healthy.ok!==true||healthy.owners_verified!==true||
     healthy.services_active!==4)
   deny('recovery_services_unverified');
  verified=true;
  return Object.freeze({
   ok:true,mode:'FIXTURE_ONLY_NOT_PRODUCTION',
   rollback:'verified_after_process_crash',
   restored_count:Object.values(restorable).filter(Boolean).length,
   lock_unlinked:true,escrow_retained:true,production_mutated:false
  });
 }finally{
  fs.closeSync(recoveryFd);
  if(verified){
   const again=fs.lstatSync(lockPath);
   if(again.ino!==verifiedInode.ino||again.dev!==verifiedInode.dev)
    deny('recovery_transaction_lock_replaced');
   fs.unlinkSync(lockPath);fsyncDir(journalRoot);
   fs.unlinkSync(recoveryLock);fsyncDir(journalRoot);
  }
  // Failure retains both markers for manual audited recovery, never retries.
 }
}

if(require.main===module){
 process.stderr.write('fixture-only rollback rehearsal: no Production apply/approve/install\n');
 process.exitCode=78;
}
module.exports=Object.freeze({
 KEYS,MAX_BYTES,runIsolatedFourOwnerTransaction,recoverIsolatedFourOwnerTransaction
});
