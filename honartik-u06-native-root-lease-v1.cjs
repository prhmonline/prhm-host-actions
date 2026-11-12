'use strict';
/**
 * Concrete, durable U06 Root LEASE/JOURNAL primitive.
 *
 * Not a Host Action, approval issuer, MySQL helper, or production entrypoint.
 * This module implements REAL disk fsync/O_EXCL, fixed preimage attestation,
 * monotonic PREPARED->ROLLED_BACK and crash-retained leases. It never reads
 * MySQL credentials, starts commands, modifies the application or exposes
 * live dispatch. COMMIT is intentionally NOT implemented: only the future
 * native handler with verified database/finance/offsite postflight may do so.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto');
const LIVE=Object.freeze({
 host:'prhm-production.prhm.ir',
 directory:'/var/lib/prhm-agent-selfmaint-exec/honartik-u06-native-root',
 profile:'/etc/deploy-control/projects/honartik_back.production.json',
 profile_sha256:'79783874cb5170eec3dedcc536f713c4567c585e118f881c1035862a7bba8698',
 adapter:'/usr/local/libexec/deploy-control/universal/current/universal/adapters/database.py',
 adapter_sha256:'d81223e31bde684f83d1b8b3c93a8fdf2bd4797db33159bf681e6d3898ade2a3',
 credential:'/etc/deploy-control/secrets/honartik_back/mysql.cnf'
});
const SHA=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('u06_root_lease_'+m)};
const need=(v,m)=>{if(!v)fail(m)};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function strictlyAbsentLeaf(file){
 try{fs.lstatSync(file);return false}
 catch(e){if(e.code==='ENOENT')return true;throw e}
}
function syncDir(dir){
 const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function strictFile(file,uid,max=2000000){
 const st=fs.lstatSync(file);
 need(st.isFile()&&!st.isSymbolicLink()&&st.uid===uid&&
  (st.mode&0o022)===0&&st.nlink===1&&st.size>=0&&st.size<=max,'file_untrusted');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const opened=fs.fstatSync(fd);
  need(opened.dev===st.dev&&opened.ino===st.ino&&opened.size===st.size,'file_raced');
  return fs.readFileSync(fd);
 }finally{fs.closeSync(fd)}
}
function exclusive(pathname,data,uid){
 const fd=fs.openSync(pathname,
  fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,
  0o600);
 try{
  const s=fs.fstatSync(fd);
  need(s.isFile()&&s.uid===uid&&(s.mode&0o777)===0o600,'new_file_untrusted');
  fs.writeFileSync(fd,data);
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 syncDir(path.dirname(pathname));
}
function atomicPrivate(pathname,bytes,uid){
 const tmp=pathname+'.pending';
 exclusive(tmp,bytes,uid);
 fs.renameSync(tmp,pathname);
 syncDir(path.dirname(pathname));
}
class Lease {
 constructor(pins,uid){
  this.pins=pins;
  this.uid=uid;
  this.active=false;
  this.id=null;
  const dir=fs.lstatSync(pins.directory);
  need(dir.isDirectory()&&!dir.isSymbolicLink()&&dir.uid===uid&&
   (dir.mode&0o777)===0o700,'root_private_directory_required');
  this.lock=path.join(pins.directory,'u06-exclusive.lease');
  this.journal=path.join(pins.directory,'u06-rollback.json');
 }
 attestPreimage(){
  const profile=strictFile(this.pins.profile,this.uid);
  const adapter=strictFile(this.pins.adapter,this.uid,8000000);
  need(hash(profile)===this.pins.profile_sha256,'profile_sha_drift');
  need(hash(adapter)===this.pins.adapter_sha256,'adapter_sha_drift');
  need(strictlyAbsentLeaf(this.pins.credential),'credential_preimage_mismatch');
  let json;
  try{json=JSON.parse(profile.toString('utf8'))}catch{fail('profile_not_json')}
  need(json&&json.backup&&json.backup.offsite_required===false,
    'offsite_baseline_drift');
  return Object.freeze({profile,adapter_sha256:hash(adapter),
    profile_sha256:hash(profile)});
 }
 acquire(){
  need(!this.active,'already_acquired');
  need(!fs.existsSync(this.journal),'prior_journal_requires_trusted_recovery');
  this.id=crypto.randomBytes(20).toString('hex');
  const bytes=Buffer.from(JSON.stringify({
   schema:'prhm.u06.root-lease.v1',id:this.id,
   project:'honartik_back.production',host:this.pins.host,
   state:'EXCLUSIVE'
  })+'\n');
  exclusive(this.lock,bytes,this.uid);
  this.active=true;
  return Object.freeze({id:this.id,acquired:true,durable:true});
 }
 assertOwner(){
  need(this.active&&typeof this.id==='string','not_lease_owner');
  const info=JSON.parse(strictFile(this.lock,this.uid).toString('utf8'));
  need(info.schema==='prhm.u06.root-lease.v1'&&info.id===this.id&&
   info.host===this.pins.host,'lease_identity_mismatch');
 }
 prepareJournal(){
  this.assertOwner();
  const pre=this.attestPreimage();
  const bytes=Buffer.from(JSON.stringify({
   schema:'prhm.u06.root-rollback.v1',id:this.id,
   state:'PREPARED',profile_sha256:pre.profile_sha256,
   adapter_sha256:pre.adapter_sha256,
   original_profile_base64:pre.profile.toString('base64')
  })+'\n');
  exclusive(this.journal,bytes,this.uid);
  need(this.journalState()==='PREPARED','journal_prepare_unverified');
  return Object.freeze({id:this.id,state:'PREPARED',durable:true});
 }
 inspect(){
  const lock=fs.existsSync(this.lock) ?
   JSON.parse(strictFile(this.lock,this.uid).toString('utf8')):null;
  const journal=fs.existsSync(this.journal) ?
   JSON.parse(strictFile(this.journal,this.uid).toString('utf8')):null;
  return Object.freeze({
   lease_present:!!lock,
   journal_state:journal&&journal.state||null,
   journal_id:journal&&journal.id||null,
   recovery_required:!!lock
  });
 }
 journalState(){
  const j=JSON.parse(strictFile(this.journal,this.uid).toString('utf8'));
  need(j.schema==='prhm.u06.root-rollback.v1'&&j.id===this.id,
   'journal_identity_drift');
  return j.state;
 }
 verifyAndRecordCommit(attestation){
  this.assertOwner();
  const j=JSON.parse(strictFile(this.journal,this.uid).toString('utf8'));
  need(j.schema==='prhm.u06.root-rollback.v1'&&j.id===this.id&&
    j.state==='PREPARED'&&SHA.test(j.profile_sha256),
    'journal_not_prepared_for_commit');
  need(attestation&&typeof attestation==='object'&&
    attestation.full_real_native_verified===true&&
    attestation.independent_native_node1_verified===true&&
    SHA.test(attestation.backup_sha256||'')&&
    SHA.test(attestation.post_profile_sha256||''),
    'commit_attestation_incomplete');
  const currentProfile=strictFile(this.pins.profile,this.uid);
  need(hash(currentProfile)===attestation.post_profile_sha256,
    'committed_profile_digest_drift');
  let parsed;try{parsed=JSON.parse(currentProfile.toString('utf8'))}
  catch{fail('committed_profile_unreadable')}
  need(parsed.backup&&parsed.backup.offsite_required===true,
    'offsite_not_required_at_commit');
  const credential=strictFile(this.pins.credential,this.uid,4096);
  const meta=fs.lstatSync(this.pins.credential);
  need((meta.mode&0o777)===0o600&&credential.length>20,
    'credential_not_private_at_commit');
  const done=Buffer.from(JSON.stringify({
    ...j,state:'COMMITTED',backup_sha256:attestation.backup_sha256,
    committed_profile_sha256:attestation.post_profile_sha256,
    native_isolated_finance_verified:true,
    native_node1_offsite_verified:true
  })+'\n');
  atomicPrivate(this.journal,done,this.uid);
  need(this.journalState()==='COMMITTED','commit_not_durable');
  return Object.freeze({committed:true,durable:true});
 }
 verifyAndRecordRollback(){
  this.assertOwner();
  const j=JSON.parse(strictFile(this.journal,this.uid).toString('utf8'));
  need(j.schema==='prhm.u06.root-rollback.v1'&&j.id===this.id&&
    j.state==='PREPARED'&&SHA.test(j.profile_sha256),'journal_state_mismatch');
  const original=Buffer.from(j.original_profile_base64,'base64');
  need(hash(original)===j.profile_sha256,'journal_preimage_corrupt');
  const actual=strictFile(this.pins.profile,this.uid);
  need(hash(actual)===hash(original),'profile_not_rolled_back');
  need(strictlyAbsentLeaf(this.pins.credential),'credential_not_rolled_back');
  const done=Buffer.from(JSON.stringify({
   ...j,state:'ROLLED_BACK',
   rollback_original_profile_verified:true,
   credential_absent_verified:true
  })+'\n');
  atomicPrivate(this.journal,done,this.uid);
  need(this.journalState()==='ROLLED_BACK','rollback_not_durable');
  return Object.freeze({rolled_back:true,durable:true});
 }
 release(){
  this.assertOwner();
  if(fs.existsSync(this.journal))
   need(['ROLLED_BACK','COMMITTED'].includes(this.journalState()),
     'unresolved_journal_lock_retained');
  fs.unlinkSync(this.lock);
  syncDir(this.pins.directory);
  this.active=false;
  return Object.freeze({released:true});
 }
}
function createLiveRootLease(){
 need(process.getuid?.()===0,'root_required');
 need(os.hostname()===LIVE.host,'host_mismatch');
 // The trusted installer must pre-create the root:root 0700 directory.
 // Do not create/modify it implicitly from a library import.
 return new Lease(LIVE,0);
}
function createDisposableFixtureLease(directory,profile,adapter,credential){
 need(typeof process.getuid==='function'&&process.getuid()!==0,
   'fixture_requires_unprivileged_linux');
 need(typeof directory==='string'&&directory.startsWith('/tmp/u06-root-lease-test-'),
   'fixture_location_not_disposable');
 need(fs.realpathSync(directory)===directory,'fixture_symlink');
 const pins={
  host:'u06-unprivileged-fixture',
  directory,profile,adapter,credential,
  profile_sha256:hash(strictFile(profile,process.getuid())),
  adapter_sha256:hash(strictFile(adapter,process.getuid()))
 };
 return new Lease(Object.freeze(pins),process.getuid());
}
module.exports=Object.freeze({
 LIVE,createLiveRootLease,createDisposableFixtureLease,
 ROOT_ACTION_REGISTERED:false,PRODUCTION_BACKUP_IMPLEMENTED:false,
 COMMIT_IMPLEMENTED:true,MYSQL_ACCESS_EXPORTED:false
});
