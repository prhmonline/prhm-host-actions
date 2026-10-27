'use strict';

/*
 * Issue #221: native filesystem transaction CORE for the EXISTING Host Actions
 * registrar. Not an approval issuer, public endpoint, CLI or Root-of-Trust
 * bootstrap. An independently reviewed native root dispatcher MUST verify
 * Approval Center Ed25519 signature + consumed-once ledger and immutable Git
 * candidate bytes before calling executeCore. In particular this module does
 * not make an unregistered action permissible.
 *
 * Tests exercise this core using actual Linux temporary files, never /opt.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const KEYS=Object.freeze(['base','executor','mcp','policy']);
const HASH=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=s=>{throw Error('registrar_native_'+s)};
const statFile=p=>{
 const st=fs.lstatSync(p);
 if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(p)!==p)fail('unsafe_file');
 return st;
};
function fsyncDir(p){
 const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
 try{fs.fsyncSync(fd);}finally{fs.closeSync(fd)}
}
function durableWrite(p,bytes,mode=0o600){
 const fd=fs.openSync(p,'wx',mode);
 try{
  let pos=0;
  while(pos<bytes.length){
   const n=fs.writeSync(fd,bytes,pos,bytes.length-pos,pos);
   if(n<=0)fail('short_write');
   pos+=n;
  }
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 fsyncDir(path.dirname(p));
}
function atomicReplace(dest,bytes,meta){
 const parent=path.dirname(dest);
 const p=path.join(parent,'.prhm-reg-'+crypto.randomUUID()+'.tmp');
 let exists=false;
 try{
  durableWrite(p,bytes,meta.mode);
  exists=true;
  fs.chownSync(p,meta.uid,meta.gid);
  fs.chmodSync(p,meta.mode);
  fs.renameSync(p,dest);
  exists=false;
  fsyncDir(parent);
 }finally{if(exists)try{fs.unlinkSync(p)}catch{}}
}
function writeJournal(dir,data){
 const output=Buffer.from(JSON.stringify(data)+'\n');
 const filename=path.join(dir,'journal.json');
 const tmp=path.join(dir,'.journal-'+crypto.randomUUID());
 let created=false;
 try{
  durableWrite(tmp,output);
  created=true;
  fs.renameSync(tmp,filename);
  created=false;
  fsyncDir(dir);
 }finally{if(created)try{fs.unlinkSync(tmp)}catch{}}
}
function checkPlan(plan){
 if(!plan||plan.schema!=='prhm.registrar.native-transaction.v1'||
  !Array.isArray(plan.steps)||plan.steps.length!==KEYS.length||
  plan.steps.some((s,i)=>s.key!==KEYS[i]||
   typeof s.path!=='string'||!path.isAbsolute(s.path)||
   !Buffer.isBuffer(s.nextBytes)||
   !/^[a-f0-9]{64}$/.test(s.beforeSha)||!/^[a-f0-9]{64}$/.test(s.afterSha)||
   HASH(s.nextBytes)!==s.afterSha))
  fail('plan_invalid');
 const targets=plan.steps.map(s=>s.path);
 if(new Set(targets).size!==targets.length)fail('duplicate_target');
 if(!/^[0-9a-f]{40}$/.test(plan.sourceCommit||'')||
  !/^[0-9a-f]{64}$/.test(plan.manifestSha256||''))
  fail('git_identity_missing');
}
function verifyPreimage(steps){
 return steps.map(s=>{
  const st=statFile(s.path);
  const before=fs.readFileSync(s.path);
  if(HASH(before)!==s.beforeSha)fail('preimage_sha_drift:'+s.key);
  if((st.mode&0o022)!==0)fail('unsafe_source_mode:'+s.key);
  return {key:s.key,path:s.path,mode:st.mode&0o777,uid:st.uid,gid:st.gid,
    bytes:before,sha:s.beforeSha};
 });
}
function safeWorkRoot(workRoot){
 if(typeof workRoot!=='string'||!path.isAbsolute(workRoot))fail('work_root_invalid');
 const st=fs.lstatSync(workRoot);
 if(!st.isDirectory()||st.isSymbolicLink()||
    fs.realpathSync(workRoot)!==workRoot||(st.mode&0o077)!==0)
    fail('work_root_unsafe');
}
function lock(workRoot){
 const p=path.join(workRoot,'active.lock');
 const fd=fs.openSync(p,'wx',0o600);
 const bytes=Buffer.from(JSON.stringify({pid:process.pid})+'\n');
 fs.writeSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);
 fsyncDir(workRoot);
 return p;
}
function unlock(p){
 fs.unlinkSync(p);
 fsyncDir(path.dirname(p));
}
function validateJournal(dir){
 const st=fs.lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0)
  fail('journal_dir_unsafe');
 const b=fs.readFileSync(path.join(dir,'journal.json'));
 const j=JSON.parse(b.toString('utf8'));
 if(j.schema!=='prhm.registrar.native-journal.v1'||
    !KEYS.every((k,i)=>j.files?.[i]?.key===k)||
    j.files.length!==KEYS.length)fail('journal_invalid');
 for(const r of j.files){
  if(!path.isAbsolute(r.path)||!Number.isInteger(r.uid)||
   !Number.isInteger(r.gid)||!Number.isInteger(r.mode)||
   !/^[a-f0-9]{64}$/.test(r.beforeSha)||
   !/^[a-f0-9]{64}$/.test(r.afterSha))fail('journal_record_invalid');
 }
 return j;
}
function restoreFromJournal(txnDir,expectedTargets){
 const j=validateJournal(txnDir);
 // Trusted caller supplies the FIXED allowlisted target paths; a journal on
 // its own can NEVER grant authority to overwrite an arbitrary host path.
 if(!Array.isArray(expectedTargets)||expectedTargets.length!==KEYS.length||
    j.files.some((r,i)=>r.path!==expectedTargets[i]))
   fail('recovery_target_mismatch');
 if(j.status==='COMMITTED'||j.status==='ROLLED_BACK')return {status:j.status,changed:false};
 if(j.status!=='INSTALLING'&&j.status!=='ROLLBACK_FAILED')
  fail('recovery_journal_state_invalid');
 const errors=[];
 for(const r of [...j.files].reverse()){
  try{
   const old=fs.readFileSync(path.join(txnDir,r.key+'.before'));
   if(HASH(old)!==r.beforeSha)fail('backup_sha_drift:'+r.key);
   const st=statFile(r.path);
   // If another writer replaced the file after the interrupted transaction,
   // STOP; never overwrite unrelated bytes.
   const current=HASH(fs.readFileSync(r.path));
   if(current!==r.beforeSha && current!==r.afterSha)
    fail('concurrent_drift:'+r.key);
   atomicReplace(r.path,old,r);
   const verify=statFile(r.path);
   if(HASH(fs.readFileSync(r.path))!==r.beforeSha||
      (verify.mode&0o777)!==r.mode||verify.uid!==r.uid||verify.gid!==r.gid)
     fail('restore_mismatch:'+r.key);
  }catch(err){errors.push(r.key+':'+String(err.message));}
 }
 j.status=errors.length?'ROLLBACK_FAILED':'ROLLED_BACK';
 j.rollbackErrors=errors;
 writeJournal(txnDir,j);
 if(errors.length)fail('rollback_incomplete:'+errors.join('|'));
 return {status:'ROLLED_BACK',changed:true};
}
async function executeCore(plan,{workRoot,postInstall,postRollback,onRenamed}={}){
 checkPlan(plan);
 if(typeof postInstall!=='function')fail('health_callback_required');
 safeWorkRoot(workRoot);
 const active=lock(workRoot);
 let dir=null,pre=null;
 try{
  pre=verifyPreimage(plan.steps);
  dir=fs.mkdtempSync(path.join(workRoot,'txn-'));
  fs.chmodSync(dir,0o700);fsyncDir(workRoot);
  const rec=pre.map((p,i)=>({
   key:p.key,path:p.path,mode:p.mode,uid:p.uid,gid:p.gid,
   beforeSha:p.sha,afterSha:plan.steps[i].afterSha
  }));
  const journal={schema:'prhm.registrar.native-journal.v1',
   status:'PREPARING',sourceCommit:plan.sourceCommit,
   manifestSha256:plan.manifestSha256,files:rec,rollbackErrors:[]};
  writeJournal(dir,journal);
  // ALL before-images become durable before the journal is INSTALLING.
  for(const p of pre)durableWrite(path.join(dir,p.key+'.before'),p.bytes);
  journal.status='INSTALLING';writeJournal(dir,journal);
  for(let i=0;i<plan.steps.length;i++){
   const step=plan.steps[i],prior=pre[i];
   const current=statFile(step.path);
   if(HASH(fs.readFileSync(step.path))!==step.beforeSha ||
     current.uid!==prior.uid||current.gid!==prior.gid||
     (current.mode&0o777)!==prior.mode)fail('midflight_drift:'+step.key);
   atomicReplace(step.path,step.nextBytes,prior);
   if(HASH(fs.readFileSync(step.path))!==step.afterSha)fail('postimage_sha:'+step.key);
   if(typeof onRenamed==='function')onRenamed(step.key,i);
  }
  const health=await postInstall();
  if(health!==true)fail('postinstall_health');
  journal.status='COMMITTED';writeJournal(dir,journal);
  return {status:'COMMITTED',transaction:dir,sourceCommit:plan.sourceCommit};
 }catch(error){
  if(!dir)throw error;
  const journalPath=path.join(dir,'journal.json');
  if(!fs.existsSync(journalPath))throw error;
  const j=validateJournal(dir);
  if(j.status==='INSTALLING'){
   try{
    restoreFromJournal(dir,plan.steps.map(x=>x.path));
    if(typeof postRollback==='function' && await postRollback()!==true)
      fail('rollback_health_unverified');
   }catch(rbErr){throw Error(String(error.message)+':'+String(rbErr.message))}
  }
  throw error;
 }finally{
  // SIGKILL/crash deliberately bypasses finally. Recovery below is
  // separately callable and must verify that lock owner is dead.
  if(fs.existsSync(active))unlock(active);
 }
}
function recoverAfterCrash({workRoot,transaction,expectedTargets}={}){
 safeWorkRoot(workRoot);
 if(typeof transaction!=='string'||path.dirname(transaction)!==workRoot||
   !path.basename(transaction).startsWith('txn-'))fail('recovery_path_invalid');
 const active=path.join(workRoot,'active.lock');
 if(fs.existsSync(active)){
  const j=JSON.parse(fs.readFileSync(active,'utf8'));
  if(!Number.isInteger(j.pid)||j.pid<=0)fail('lock_corrupt');
  try{process.kill(j.pid,0);fail('lock_owner_active');}
  catch(e){if(e.code!=='ESRCH')throw e}
  fs.unlinkSync(active);fsyncDir(workRoot);
 }
 const newLock=lock(workRoot);
 try{return restoreFromJournal(transaction,expectedTargets)}
 finally{unlock(newLock)}
}
module.exports=Object.freeze({KEYS,HASH,checkPlan,verifyPreimage,
  executeCore,recoverAfterCrash,restoreFromJournal});
// Deliberately no CLI entrypoint: the live Host Action must supply the
// separately authenticated, one-time Ed25519 consumed authorization.
if(require.main===module){process.stderr.write('No standalone apply. Trusted Root-of-Trust dispatcher required.\n');process.exitCode=64}
