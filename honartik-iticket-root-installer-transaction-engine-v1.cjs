'use strict';

/**
 * HONARTIK ROOT INSTALLER: FAILURE-INJECTION TRANSACTION PROTOTYPE.
 * FIXTURE ONLY. Does not read/write files, spawn commands, restart services,
 * request approval or install anything. A signed production adapter DOES NOT
 * EXIST. Future integration requires a separate security review & signoff.
 *
 * Durable adapter contract (enforced in synthetic tests):
 *   lock / unlock / ensureNoUnresolved
 *   readOwner => {bytes:Buffer, uid, gid, mode}
 *   writeBackupDurable => {durable:true}; readBackup => original snapshot
 *   writeJournalDurable => {durable:true}; loadJournal => persisted JSON state
 *   stageCandidate => opaque stageHandle; commitCandidate (atomic rename)
 *   restoreBackup => atomic restore with original uid/gid/mode
 *   verifyRuntime => {ok:true}; cleanupStages optional
 *
 * Writes must actually fsync files AND parent directories in a future
 * privileged adapter; returning "durable" does not itself prove durability.
 * Write intent is persisted before every rename; recovery scans all owner
 * hashes rather than trusting an incomplete per-step done flag.
 */
const crypto=require('node:crypto');
const SCHEMA='prhm.iticket.root-installer-fixture-transaction.v1';
const ORDER=Object.freeze(['base','exec','policy','mcp']);
const EXPECTED=Object.freeze({
  base:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
  exec:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
  policy:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',
  mcp:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166',
});
const ADAPTER_METHODS=Object.freeze([
  'lock','unlock','ensureNoUnresolved','readOwner','writeBackupDurable',
  'readBackup','writeJournalDurable','loadJournal','stageCandidate',
  'commitCandidate','restoreBackup','verifyRuntime'
]);
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const clone=j=>JSON.parse(JSON.stringify(j));
function fail(msg){throw new Error('installer_tx_'+msg);}
function assertFixture(mode){if(mode!=='isolated-fixture')fail('production_execution_unavailable');}
function assertId(id){if(typeof id!=='string'||!/^[a-z0-9][a-z0-9_-]{3,62}$/.test(id))fail('transaction_id_invalid');}
function assertAdapter(d){
  if(!d||typeof d!=='object')fail('adapter_required');
  for(const name of ADAPTER_METHODS)if(typeof d[name]!=='function')fail('adapter_missing_'+name);
}
function assertMetadata(v){
  if(!v||!Buffer.isBuffer(v.bytes)||!Number.isInteger(v.uid)||
     !Number.isInteger(v.gid)||!Number.isInteger(v.mode)||
     v.uid<0||v.gid<0||v.mode<0||v.mode>0o7777)fail('file_metadata_invalid');
}
function checkSnapshot(key,snap,digest){
  assertMetadata(snap);
  if(sha256(snap.bytes)!==digest)fail('source_preimage_mismatch_'+key);
}
function assertCandidates(candidates){
  if(!candidates||typeof candidates!=='object'||Array.isArray(candidates)||
     Object.keys(candidates).length!==ORDER.length)fail('candidate_keys_invalid');
  for(const key of ORDER){
    if(!Buffer.isBuffer(candidates[key])||candidates[key].length===0||
       candidates[key].length>300000)fail('candidate_invalid_'+key);
  }
}
function requireDurable(receipt,phase){
  if(!receipt||receipt.durable!==true)fail('durability_not_attested_'+phase);
}
function assertJournal(j,id){
  if(!j||j.schema!==SCHEMA||j.id!==id||
     !['PREPARED','APPLYING','COMMITTED','ROLLED_BACK','RECOVERY_BLOCKED'].includes(j.state)||
     !j.owners||Object.keys(j.owners).length!==ORDER.length)fail('journal_invalid');
  for(const key of ORDER){
    const o=j.owners[key];
    if(!o||o.before!==EXPECTED[key]||!/^[a-f0-9]{64}$/.test(o.after)||
       !Number.isInteger(o.uid)||!Number.isInteger(o.gid)||
       !Number.isInteger(o.mode))fail('journal_owner_invalid_'+key);
  }
}
async function writeJournal(d,j){
  const ack=await d.writeJournalDurable(clone(j));
  requireDurable(ack,'journal');
}
async function assertBackup(d,j,key){
  const snap=await d.readBackup(j.id,key);
  checkSnapshot(key,snap,j.owners[key].before);
  for(const prop of ['uid','gid','mode'])
    if(snap[prop]!==j.owners[key][prop])fail('backup_metadata_mismatch_'+key);
  return snap;
}
async function ownerState(d,j,key){
  const actual=await d.readOwner(key);
  assertMetadata(actual);
  const hash=sha256(actual.bytes);
  if(hash===j.owners[key].before)return 'BEFORE';
  if(hash===j.owners[key].after)return 'AFTER';
  return 'UNEXPECTED';
}
/**
 * Recovery is idempotent after interruption at ANY point, including after
 * rename but before completion is recorded. It scans ALL four current owners.
 * An unexpected third-party SHA blocks writes; backup failure blocks writes.
 */
async function recoverLocked({id,d}){
  const j=await d.loadJournal(id);
  assertJournal(j,id);
  if(j.state==='ROLLED_BACK')return {ok:true,recovered:true,already:true};
  if(j.state==='COMMITTED')fail('committed_transaction_manual_review');
  const states={};
  for(const key of ORDER)states[key]=await ownerState(d,j,key);
  if(Object.values(states).includes('UNEXPECTED')){
    j.state='RECOVERY_BLOCKED';
    await writeJournal(d,j);
    fail('unrecognized_live_drift');
  }
  const backup={};
  for(const key of ORDER)backup[key]=await assertBackup(d,j,key);
  j.state='APPLYING';
  j.recovery_attempts=(j.recovery_attempts||0)+1;
  await writeJournal(d,j);
  for(const key of [...ORDER].reverse()){
    if(states[key]!=='AFTER')continue;
    await d.restoreBackup(id,key,backup[key]);
    const state=await ownerState(d,j,key);
    if(state!=='BEFORE')fail('rollback_hash_verification_failed_'+key);
    const restored=await d.readOwner(key);
    for(const prop of ['uid','gid','mode'])
      if(restored[prop]!==backup[key][prop])fail('rollback_metadata_verification_failed_'+key);
  }
  for(const key of ORDER)if(await ownerState(d,j,key)!=='BEFORE')
    fail('rollback_final_sha_mismatch_'+key);
  const health=await d.verifyRuntime('rollback');
  if(!health||health.ok!==true)fail('rollback_runtime_unhealthy');
  j.state='ROLLED_BACK';j.inflight=null;j.recovered=true;
  await writeJournal(d,j);
  if(typeof d.cleanupStages==='function')await d.cleanupStages(id);
  return {ok:true,recovered:true,already:false};
}
async function recover({mode,id,adapter}={}){
  assertFixture(mode);assertId(id);assertAdapter(adapter);
  const d=adapter;
  await d.lock(id);
  try{return await recoverLocked({id,d});}
  finally{await d.unlock(id);}
}
async function execute({mode,id,adapter,candidates}={}){
  assertFixture(mode);assertId(id);assertAdapter(adapter);assertCandidates(candidates);
  const d=adapter;
  await d.lock(id);
  let hasJournal=false;
  try{
    await d.ensureNoUnresolved(id);
    const owners={};const snapshots={};
    for(const key of ORDER){
      const snapshot=await d.readOwner(key);
      checkSnapshot(key,snapshot,EXPECTED[key]);
      const after=sha256(candidates[key]);
      if(after===EXPECTED[key])fail('candidate_identical_to_before_'+key);
      owners[key]={before:EXPECTED[key],after,uid:snapshot.uid,gid:snapshot.gid,mode:snapshot.mode};
      snapshots[key]=snapshot;
    }
    for(const key of ORDER){
      requireDurable(await d.writeBackupDurable(id,key,snapshots[key]),'backup_'+key);
      const confirmed=await d.readBackup(id,key);
      checkSnapshot(key,confirmed,EXPECTED[key]);
      for(const prop of ['uid','gid','mode'])
        if(confirmed[prop]!==snapshots[key][prop])fail('backup_metadata_mismatch_'+key);
    }
    const j={schema:SCHEMA,id,state:'PREPARED',owners,
      completed:[],inflight:null,recovery_attempts:0};
    await writeJournal(d,j);hasJournal=true;
    for(const key of ORDER){
      // MUST be durable BEFORE commitCandidate's rename.
      j.state='APPLYING';j.inflight=key;
      await writeJournal(d,j);
      const handle=await d.stageCandidate(id,key,candidates[key],snapshots[key]);
      await d.commitCandidate(id,key,handle);
      const current=await d.readOwner(key);
      checkSnapshot(key,current,owners[key].after);
      for(const prop of ['uid','gid','mode'])
        if(current[prop]!==snapshots[key][prop])fail('postimage_metadata_mismatch_'+key);
      j.completed.push(key);j.inflight=null;
      await writeJournal(d,j);
    }
    const health=await d.verifyRuntime('after-apply');
    if(!health||health.ok!==true)fail('runtime_health_failed');
    j.state='COMMITTED';j.inflight=null;
    await writeJournal(d,j);
    if(typeof d.cleanupStages==='function')await d.cleanupStages(id);
    return {ok:true,id,fixture_only:true,owner_postimages:Object.fromEntries(
      ORDER.map(key=>[key,owners[key].after])),
      signed_install_authorized:false};
  }catch(err){
    if(!hasJournal)throw err;
    try{
      await recoverLocked({id,d});
      throw new Error('installer_tx_failed_and_rolled_back:'+String(err.message||err));
    }catch(recoveryError){
      if(String(recoveryError.message||'').startsWith('installer_tx_failed_and_rolled_back:'))throw recoveryError;
      throw new Error('installer_tx_recovery_required:'+String(err.message||err)+
        ':recovery_error:'+String(recoveryError.message||recoveryError));
    }
  }finally{await d.unlock(id);}
}
module.exports=Object.freeze({SCHEMA,ORDER,EXPECTED,sha256,execute,recover});
