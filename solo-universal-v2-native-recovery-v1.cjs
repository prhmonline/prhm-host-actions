'use strict';
/**
 * Native Linux durable rollback core for the separately authorized Solo
 * Universal v2 release. SOURCE-ONLY: no CLI, no signer, no root dispatcher.
 *
 * The review-pinned root adapter MUST supply the fixed prefix, registry,
 * journalRoot and expected digests. No caller-controlled paths/tokens may
 * reach that adapter. This module never runs systemctl or touches Solo state.
 *
 * Only these four artifacts are snapshotted/restored:
 *  1) Universal "current" symlink
 *  2) Universal "deploy-project" wrapper
 *  3) Universal "installation.json" manifest
 *  4) the initially absent solo_company.production.json profile.
 *
 * A candidate version directory may remain as an inert orphan after rollback.
 * The mutating v1 deployment engine and Solo Runtime are never invoked.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {PINS}=require('./solo-universal-v2-signed-release-contract-v1.cjs');
const FAIL=s=>{throw Error('solo_universal_v2_native_'+s)};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const SHA=/^[a-f0-9]{64}$/;
const IDS=/^tx-[a-f0-9-]{36}$/;
const PROFILE='solo_company.production.json';
const manifestName='installation.json';
const wrapperName='deploy-project';
const WRAPPER_SHA='4c67a86046d0f2eb511a5fabe81b14e35ab9c17aaadf33c2064fa9d68e8989ce';
function canonical(v){
  if(Array.isArray(v))return v.map(canonical);
  if(v!==null&&typeof v==='object'){
    const out={};for(const k of Object.keys(v).sort())out[k]=canonical(v[k]);
    return out;
  }
  return v;
}
function profileHash(bytes){
  let v;try{v=JSON.parse(bytes.toString('utf8'))}catch(_){FAIL('profile_json_invalid')}
  return hash(Buffer.from(JSON.stringify(canonical(v))));
}

function directory(p,uid=process.getuid()){
  const st=fs.lstatSync(p);
  if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(p)!==p||
     st.uid!==uid||(st.mode&0o022)!==0)FAIL('directory_unsafe');
  return st;
}
function regular(p,uid=process.getuid()){
  const st=fs.lstatSync(p);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(p)!==p||
     st.uid!==uid||(st.mode&0o022)!==0)FAIL('regular_unsafe');
  return st;
}
function syncDir(dir){
  const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
  try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function durableFile(p,bytes,mode=0o600){
  const fd=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,mode);
  try{
    fs.writeFileSync(fd,bytes);
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd)}
  syncDir(path.dirname(p));
}
function replaceFile(dest,bytes,mode){
  const dir=path.dirname(dest),tmp=path.join(dir,'.solo-v2-'+crypto.randomUUID());
  try{
    durableFile(tmp,bytes,mode);
    fs.chmodSync(tmp,mode);
    const fd=fs.openSync(tmp,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
    fs.renameSync(tmp,dest);
    syncDir(dir);
  }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}
}
function replaceLink(dest,target){
  const dir=path.dirname(dest),tmp=path.join(dir,'.solo-v2-'+crypto.randomUUID());
  try{
    fs.symlinkSync(target,tmp);
    syncDir(dir);
    fs.renameSync(tmp,dest);
    syncDir(dir);
  }finally{try{fs.unlinkSync(tmp)}catch(e){if(e.code!=='ENOENT')throw e}}
}
function exists(p){try{fs.lstatSync(p);return true}catch(e){if(e.code==='ENOENT')return false;throw e}}
function exactCurrent(prefix,digest){
  const name=path.join(prefix,'current');
  const st=fs.lstatSync(name);
  if(!st.isSymbolicLink())FAIL('current_not_symlink');
  const target=fs.readlinkSync(name);
  const expected=path.join(prefix,'versions',digest);
  if(target!==expected||fs.realpathSync(name)!==expected)
    FAIL('current_pointer_drift');
  return target;
}
function params(args){
  if(!args||typeof args!=='object')FAIL('input_required');
  const {prefix,registry,journalRoot,wrapperSha,expectedCurrent,
    expectedManifestSha,candidateDigest,profileSha}=args;
  for(const p of [prefix,registry,journalRoot]){
    if(typeof p!=='string'||!path.isAbsolute(p)||p.includes('..')||
       path.resolve(p)!==p)FAIL('path_invalid');
    directory(p);
  }
  for(const s of [wrapperSha,expectedCurrent,expectedManifestSha,
                   candidateDigest,profileSha]){
    if(typeof s!=='string'||!SHA.test(s))FAIL('sha_invalid');
  }
  if(wrapperSha!==WRAPPER_SHA||expectedCurrent!==PINS.installed_digest||
     expectedManifestSha!==PINS.manifest_preimage_sha256||
     candidateDigest!==PINS.candidate_digest||
     profileSha!==PINS.profile_sha256)
    FAIL('immutable_contract_mismatch');
  return Object.freeze({...args,
    current:path.join(prefix,'current'),
    wrapper:path.join(prefix,wrapperName),
    manifest:path.join(prefix,manifestName),
    profile:path.join(registry,PROFILE),
    lock:path.join(journalRoot,'active.lock')});
}
function attestBefore(input){
  const cfg=params(input);
  const target=exactCurrent(cfg.prefix,cfg.expectedCurrent);
  const wrapperSt=regular(cfg.wrapper),manifestSt=regular(cfg.manifest);
  const wrapper=fs.readFileSync(cfg.wrapper),manifest=fs.readFileSync(cfg.manifest);
  if(hash(wrapper)!==cfg.wrapperSha||hash(manifest)!==cfg.expectedManifestSha||
     (wrapperSt.mode&0o777)!==0o755||
     (manifestSt.mode&0o777)!==0o600||
     exists(cfg.profile))FAIL('preimage_mismatch');
  const obj=JSON.parse(manifest.toString('utf8'));
  if(obj.digest!==cfg.expectedCurrent||
     obj.entrypoint!==path.join(PINS.installer_prefix,wrapperName))
    FAIL('preimage_manifest_invalid');
  return {target,wrapper,manifest};
}
function writeJournal(dir,obj){
  replaceFile(path.join(dir,'journal.json'),
    Buffer.from(JSON.stringify(obj)+'\n'),0o600);
}
function readJournal(dir,cfg){
  directory(dir);
  const jpath=path.join(dir,'journal.json');
  regular(jpath);
  const j=JSON.parse(fs.readFileSync(jpath,'utf8'));
  if(j.schema!=='prhm.universal.solo-v2-native-journal.v1'||
    !IDS.test(j.id||'')||path.join(cfg.journalRoot,j.id)!==dir||
    j.operation!==PINS.operation||j.expectedCurrent!==cfg.expectedCurrent||
    j.expectedManifestSha!==cfg.expectedManifestSha||
    j.wrapperSha!==cfg.wrapperSha||
    j.profileSha!==cfg.profileSha||
    j.candidateDigest!==cfg.candidateDigest||
    j.originalTarget!==path.join(cfg.prefix,'versions',cfg.expectedCurrent)||
    !['PREPARED','APPLYING','ROLLING_BACK','ROLLED_BACK','COMMITTED'].includes(j.status)||
    j.profileBefore!=='ABSENT')FAIL('journal_untrusted');
  return j;
}
function readSnapshot(dir,name,sha){
  const p=path.join(dir,name);
  regular(p);
  const bytes=fs.readFileSync(p);
  if(hash(bytes)!==sha)FAIL('snapshot_hash_mismatch');
  return bytes;
}
function writeLock(cfg,id){
  durableFile(cfg.lock,Buffer.from(id+'\n'));
}
function lockedFor(cfg,id){
  regular(cfg.lock);
  if(fs.readFileSync(cfg.lock,'utf8')!==id+'\n')
    FAIL('wrong_lock_owner');
}
function releaseLock(cfg,id){
  lockedFor(cfg,id);
  fs.unlinkSync(cfg.lock);syncDir(cfg.journalRoot);
}
function prepare(config) {
  const cfg=params(config);
  if(exists(cfg.lock))FAIL('previous_lock_requires_recovery');
  const before=attestBefore(cfg);
  const id='tx-'+crypto.randomUUID(),dir=path.join(cfg.journalRoot,id);
  writeLock(cfg,id);
  let journalWritten=false;
  try {
    fs.mkdirSync(dir,0o700);syncDir(cfg.journalRoot);
    durableFile(path.join(dir,'before-wrapper.bin'),before.wrapper);
    durableFile(path.join(dir,'before-manifest.bin'),before.manifest);
    const j={
      schema:'prhm.universal.solo-v2-native-journal.v1',id,
      status:'PREPARED',operation:PINS.operation,
      expectedCurrent:cfg.expectedCurrent,
      expectedManifestSha:cfg.expectedManifestSha,
      wrapperSha:cfg.wrapperSha,profileSha:cfg.profileSha,
      candidateDigest:cfg.candidateDigest,
      originalTarget:before.target,profileBefore:'ABSENT',
    };
    writeJournal(dir,j);journalWritten=true;
    return Object.freeze({id,dir,status:'PREPARED'});
  }catch(e){
    // If journal state is uncertain leave lock behind for root reconciliation.
    if(!journalWritten)FAIL('PREPARE_UNCERTAIN_NEEDS_RECONCILIATION');
    throw e;
  }
}
/**
 * Abort BEFORE signed authorization or any protected asset mutation.
 * Only the private journal and lock change, never installer/profile bytes.
 */
function cancelPrepared(config,dir){
  const cfg=params(config),j=readJournal(dir,cfg);
  lockedFor(cfg,j.id);
  if(j.status!=='PREPARED')FAIL('cancel_only_prepared_allowed');
  attestBefore(cfg);
  writeJournal(dir,{...j,status:'ROLLED_BACK'});
  releaseLock(cfg,j.id);
  return {status:'ROLLED_BACK',production_assets_changed:false};
}
function markApplying(config,dir){
  const cfg=params(config),j=readJournal(dir,cfg);
  lockedFor(cfg,j.id);
  if(j.status!=='PREPARED')FAIL('apply_transition_invalid');
  attestBefore(cfg);
  writeJournal(dir,{...j,status:'APPLYING'});
}
function verifyCandidateOnDisk(cfg){
  // Version directory pre-existing from the signed installer, not caller source.
  const cand=path.join(cfg.prefix,'versions',cfg.candidateDigest);
  directory(cand);
  return cand;
}
function installProfile(config,profileBytes){
  const cfg=params(config);
  if(!Buffer.isBuffer(profileBytes)||profileHash(profileBytes)!==cfg.profileSha)
    FAIL('candidate_profile_digest_mismatch');
  if(exists(cfg.profile))FAIL('profile_already_exists');
  const current=fs.readlinkSync(cfg.current);
  if(current!==path.join(cfg.prefix,'versions',cfg.candidateDigest))
    FAIL('candidate_not_activated');
  replaceFile(cfg.profile,profileBytes,0o600);
}
function verifyPost(config){
  const cfg=params(config);
  verifyCandidateOnDisk(cfg);
  exactCurrent(cfg.prefix,cfg.candidateDigest);
  if(hash(fs.readFileSync(cfg.wrapper))!==cfg.wrapperSha||
     profileHash(fs.readFileSync(cfg.profile))!==cfg.profileSha)FAIL('postimage_digest_invalid');
  const m=JSON.parse(fs.readFileSync(cfg.manifest,'utf8'));
  if(m.digest!==cfg.candidateDigest||m.previous!==cfg.expectedCurrent)
    FAIL('postimage_manifest_invalid');
  regular(cfg.wrapper);regular(cfg.manifest);regular(cfg.profile);
  return true;
}
function finish(config,dir){
  const cfg=params(config),j=readJournal(dir,cfg);
  lockedFor(cfg,j.id);
  if(j.status!=='APPLYING')FAIL('commit_transition_invalid');
  verifyPost(cfg);
  writeJournal(dir,{...j,status:'COMMITTED'});
  releaseLock(cfg,j.id);
  return {status:'COMMITTED',journal_id:j.id};
}
function recover(config,dir){
  const cfg=params(config),j=readJournal(dir,cfg);
  if(j.status==='COMMITTED'||j.status==='ROLLED_BACK'){
    if(exists(cfg.lock)){
      lockedFor(cfg,j.id);
      if(j.status==='COMMITTED')verifyPost(cfg);
      else attestBefore(cfg);
      releaseLock(cfg,j.id);
    }
    return {status:j.status,changed:false};
  }
  lockedFor(cfg,j.id);
  const wrapper=readSnapshot(dir,'before-wrapper.bin',cfg.wrapperSha);
  const manifest=readSnapshot(dir,'before-manifest.bin',cfg.expectedManifestSha);
  // Before restoring the absent profile, reject a foreign replacement.
  if(exists(cfg.profile)){
    const st=regular(cfg.profile);
    if((st.mode&0o777)!==0o600||
       profileHash(fs.readFileSync(cfg.profile))!==cfg.profileSha)
      FAIL('foreign_profile_recovery_refused');
  }
  // Protect from unrelated current-pointer manipulation.
  const st=fs.lstatSync(cfg.current);
  const link=st.isSymbolicLink()?fs.readlinkSync(cfg.current):null;
  if(link!==path.join(cfg.prefix,'versions',cfg.expectedCurrent)&&
     link!==path.join(cfg.prefix,'versions',cfg.candidateDigest))
    FAIL('foreign_current_pointer_recovery_refused');
  writeJournal(dir,{...j,status:'ROLLING_BACK'});
  replaceLink(cfg.current,j.originalTarget);
  replaceFile(cfg.wrapper,wrapper,0o755);
  replaceFile(cfg.manifest,manifest,0o600);
  if(exists(cfg.profile)){
    fs.unlinkSync(cfg.profile);
    syncDir(cfg.registry);
  }
  attestBefore(cfg);
  writeJournal(dir,{...j,status:'ROLLED_BACK'});
  releaseLock(cfg,j.id);
  return {status:'ROLLED_BACK',changed:true};
}
module.exports=Object.freeze({prepare,cancelPrepared,markApplying,installProfile,verifyPost,
  finish,recover,attestBefore});
if(require.main===module){
  process.stderr.write('NO_CLI: requires independently signed trusted root driver\n');
  process.exitCode=64;
}