'use strict';
/**
 * Root-owned, fixed-target recovery IO for an ALREADY CONSUMED Level-4
 * shared-registry request. Never accepts a new approval or runs an installer.
 * No CLI. Must run in the independent reviewed systemd transient unit.
 *
 * All nine paths are from the immutable Honartik release. Backup/journal,
 * original once-only reservation and Approval Center consumed ledger must be
 * on disk and mutually bound before the first mutation. A stale lock fails
 * closed and requires an independent operator-reviewed reconciliation.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const C=require('./prhm-action-registry-v2-durable-recovery-locksafe-v1.cjs');
const once=require('./prhm-action-registry-one-time-fence-v1.cjs');
const O=require('./prhm-action-registry-v2-root-accountability-v1.cjs');
const live=require('./prhm-action-registry-v2-root-live-mcp-v1.cjs');
const systemd=require('./prhm-action-registry-v2-fixed-systemd-bridge-v1.cjs');
const BACKUPS='/var/backups/prhm-honartik-config-center-registration-v1';


const LOCKS='/var/lib/prhm-agent-selfmaint-exec/registry-recovery-lock-v1';
const AUDIT=O.AUDIT;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function check(ok,code){if(!ok)throw Error('registry_root_recover_'+code)}
function keys(x,fields,code){
 check(x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).sort().join('|')===fields.slice().sort().join('|'),code);
}
function safeDir(io,d,priv=false,owner=0) {
 const st=io.lstatSync(d);
 check(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===owner&&st.gid===owner&&
  (st.mode&0o022)===0&&(!priv||(st.mode&0o077)===0)&&
  io.realpathSync(d)===d,'root_directory_unsafe');
 return st;
}
function readFixed(io,filename,{privateFile=true,max=65536,owner=0}={}) {
 const parent=path.posix.dirname(filename);
 safeDir(io,parent,privateFile,owner);
 const st=io.lstatSync(filename);
 check(st.isFile()&&!st.isSymbolicLink()&&io.realpathSync(filename)===filename&&
  st.uid===owner&&st.gid===owner&&(st.mode&0o022)===0&&
  (!privateFile||(st.mode&0o077)===0)&&
  st.size>0&&st.size<=max,'root_file_unsafe');
 const fd=io.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const post=io.fstatSync(fd);
  check(post.isFile()&&post.dev===st.dev&&post.ino===st.ino&&
   post.uid===st.uid&&post.gid===st.gid&&post.mode===st.mode&&
   post.size===st.size,'root_file_race');
  const bytes=io.readFileSync(fd);
  check(Buffer.isBuffer(bytes)&&bytes.length===st.size,'root_file_short_read');
  return bytes;
 }finally{io.closeSync(fd)}
}
function parse(data,code) {
 try{return JSON.parse(data.toString('utf8'))}
 catch{throw Error('registry_root_recover_'+code)}
}
function syncDir(io,dir){
 const d=io.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{io.fsyncSync(d)}finally{io.closeSync(d)}
}
function fileState(io,filename,{absentAllowed=false}={}) {
 let st;
 try{st=io.lstatSync(filename)}
 catch(e){
  if(absentAllowed&&e?.code==='ENOENT')
   return {exists:false,regular:false,symlink:false,sha256:null,uid:null,gid:null,mode:null};
  throw e;
 }
 check(st.isFile()&&!st.isSymbolicLink()&&io.realpathSync(filename)===filename&&
  (st.mode&0o022)===0,'live_file_unsafe');
 const b=readFixed(io,filename,{privateFile:false,max:4000000});
 return {exists:true,regular:true,symlink:false,sha256:sha(b),
   uid:st.uid,gid:st.gid,mode:st.mode&0o777};
}
function assertConsumed({io,id,release,snapshot,approvalToken}){
 const args={action:G.ACTION,project:release.normalized.project,
  source_commit:release.source_commit,manifest_commit:release.manifest_commit,
  manifest_sha256:release.manifest_sha256};
 check(typeof approvalToken==='string'&&approvalToken.length>=120,
  'signed_consumed_token_missing');
 const claims=G.verifyLiveConsumedRegistrationApproval({token:approvalToken,args});
 check(claims.request_id===id&&claims.arguments_sha256===G.approvalBindingSha(args),
  'independent_live_ed25519_consumption_mismatch');
 const claim=parse(readFixed(io,once.DIR+'/'+id+'.json'),'claim_json');
 keys(claim,['schema','request_id','action','operation','project',
  'source_commit','manifest_commit','manifest_sha256','arguments_sha256'],
  'claim_fields');
 check(claim.schema==='prhm.registry.once.v1'&&claim.request_id===id&&
  claim.action===G.ACTION&&claim.operation===G.OPERATION&&
  claim.project===args.project&&claim.source_commit===args.source_commit&&
  claim.manifest_commit===args.manifest_commit&&
  claim.manifest_sha256===args.manifest_sha256&&
  claim.arguments_sha256===G.approvalBindingSha(args),
  'durable_one_time_claim_drift');
 check(snapshot.request_id===id,'durable_snapshot_binding_drift');
 return true;
}
function createRecovery({release,requestId,approvalToken,io=fs,services=null,
 getuid=()=>process.getuid?.(),cgroup=()=>fs.readFileSync('/proc/self/cgroup','utf8')}={}){
 check(UUID.test(requestId||''),'request_uuid_invalid');
 const checkIndependent=()=>{
  check(getuid()===0,'root_required');
  systemd.cgroupAttestation(cgroup(),getuid);
 };
 checkIndependent();
 const pinned=O.checkRelease(release);
 const backup=BACKUPS+'/'+requestId,lock=LOCKS+'/'+requestId;
 const snapshot=parse(readFixed(io,backup+'/recovery.json'),'journal_json');
 assertConsumed({io,id:requestId,release,snapshot,approvalToken});
 C.validateSnapshot(release,snapshot,
  key=>readFixed(io,backup+'/'+key+'.bak',{max:4000000}));
 check(snapshot.request_id===requestId,'snapshot_id_mismatch');
 const svc=services||systemd.createFixedSystemdBridge();
 const affected=new Map(Object.entries(pinned.owners).map(([k,v])=>[v.path,{key:k,...v}]));
 const staged=new Map(pinned.assets.map(v=>[v.path,v]));
 let changed=0;
 async function authorizeRecovery(binding){
  checkIndependent();
  keys(binding,['action','operation','request_id','source_commit',
   'manifest_commit','manifest_sha256'],'recovery_binding_shape');
  check(binding.action===G.ACTION&&binding.operation===G.OPERATION&&
   binding.request_id===requestId&&
   binding.source_commit===release.source_commit&&
   binding.manifest_commit===release.manifest_commit&&
   binding.manifest_sha256===release.manifest_sha256,'recovery_binding_drift');
  return assertConsumed({io,id:requestId,release,snapshot,approvalToken});
 }
 async function exclusiveLock(id){
  checkIndependent();check(id===requestId,'lock_request_mismatch');
  safeDir(io,LOCKS,true);
  io.mkdirSync(lock,{mode:0o700}); // EEXIST => FAIL CLOSED, never auto-clear stale lock
  syncDir(io,LOCKS);
  return async()=>{io.rmdirSync(lock);syncDir(io,LOCKS)};
 }
 function readBackup(key){
  check(C.OWNER_KEYS.includes(key),'backup_key_invalid');
  return readFixed(io,backup+'/'+key+'.bak',{max:4000000});
 }
 async function readLive(){
  checkIndependent();
  const owners={},assets={};
  for(const [key,pin] of Object.entries(pinned.owners))
   owners[key]=fileState(io,pin.path);
  for(const a of pinned.assets)assets[a.path]=fileState(io,a.path,{absentAllowed:true});
  return {owners,assets};
 }
 async function restoreOwner(step){
  checkIndependent();
  const rec=affected.get(step?.path);
  check(rec&&step.kind==='restore_owner'&&step.key===rec.key&&
   step.sha256===rec.before_sha256&&
   step.uid===snapshot.owners[rec.key].uid&&
   step.gid===snapshot.owners[rec.key].gid&&
   step.mode===snapshot.owners[rec.key].mode&&
   Buffer.isBuffer(step.bytes)&&sha(step.bytes)===rec.before_sha256,
   'restore_step_untrusted');
  const existing=fileState(io,step.path);
  check(existing.sha256===rec.after_sha256&&
   existing.uid===step.uid&&existing.gid===step.gid&&existing.mode===step.mode,
   'owner_changed_after_preflight');
  const dir=path.posix.dirname(step.path);
  safeDir(io,dir);
  const tmp=dir+'/.prhm-recovery-'+requestId+'-'+rec.key+'.tmp';
  let created=false;
  try {
   io.writeFileSync(tmp,step.bytes,{flag:'wx',mode:step.mode});created=true;
   io.chownSync(tmp,step.uid,step.gid);io.chmodSync(tmp,step.mode);
   const fd=io.openSync(tmp,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
   try{io.fsyncSync(fd)}finally{io.closeSync(fd)}
   check(fileState(io,tmp).sha256===rec.before_sha256,'restore_tmp_mismatch');
   io.renameSync(tmp,step.path);created=false;
   syncDir(io,dir);
   check(fileState(io,step.path).sha256===rec.before_sha256,
    'restore_file_postcondition_failed');
   changed++;
  }finally{if(created){try{io.unlinkSync(tmp)}catch{}}}
 }
 async function removeAsset(step){
  checkIndependent();
  const pin=staged.get(step?.path);
  check(pin&&step.kind==='remove_asset'&&step.sha256===pin.sha256,
   'asset_step_untrusted');
  const state=fileState(io,step.path);
  check(state.sha256===pin.sha256&&state.uid===0&&
   state.gid===0&&state.mode===0o644,'asset_changed_after_preflight');
  safeDir(io,path.posix.dirname(step.path));
  io.unlinkSync(step.path);syncDir(io,path.posix.dirname(step.path));
  check(fileState(io,step.path,{absentAllowed:true}).exists===false,
   'asset_remove_postcondition_failed');
  changed++;
 }
 async function verifyOriginalState(){
  checkIndependent();
  // read-only proof on the SAME io as the restore, independently bound to
  // all four before SHA values + all five absent files.
  return O.strictOriginalState(release,{
   io,uid:getuid,
   readLiveOwner:filename=>readFixed(io,filename,{privateFile:false,max:4000000})
  });
 }
 async function verifyServices(){
  checkIndependent();
  for(const name of systemd.SERVICES){
   if(changed>0)check(svc.restartService(name)===true,'service_restart_failed');
   check(svc.checkServiceHealth(name)===true,'service_health_failed');
  }
  return true;
 }
 async function audit(rec){
  checkIndependent();
  keys(rec,['request_id','action','project','source_commit',
   'manifest_commit','manifest_sha256','result','verified','steps'],
   'audit_fields');
  check(rec.request_id===requestId&&rec.action===pinned.action&&
   rec.project==='honartik'&&
   rec.source_commit===release.source_commit&&
   rec.manifest_commit===release.manifest_commit&&
   rec.manifest_sha256===release.manifest_sha256&&
   rec.result==='restored'&&rec.verified===true&&
   Number.isSafeInteger(rec.steps)&&rec.steps>=0&&rec.steps<=9,
   'audit_binding_invalid');
  safeDir(io,AUDIT,true);
  const body=Buffer.from(G.canonicalJson({schema:'prhm.registry.recovery-audit.v1',...rec})+'\n');
  const output=AUDIT+'/'+requestId+'.recovery.json';
  const fd=io.openSync(output,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{
   check(io.writeSync(fd,body,0,body.length)===body.length,'audit_partial_write');
   io.fsyncSync(fd);
  }finally{io.closeSync(fd)}
  syncDir(io,AUDIT);
 }
 return Object.freeze({
  async recover(){
   checkIndependent();
   return C.reconcileFromDurableJournal({release,snapshot,
    readBackup,readLive,authorizeRecovery,exclusiveLock,restoreOwner,
    removeAsset,verifyOriginalState,verifyServices,
    verifyTargetAbsent:live.createDiscovery().verifyTargetAbsent,audit});
  },
  async readonlyPreflight(){
   checkIndependent();
   const authorized=assertConsumed({io,id:requestId,release,snapshot,approvalToken});
   const plan=C.recoveryPlan({release,snapshot,
    live:await readLive(),readBackup});
   return Object.freeze({source_only:true,consumed_original:authorized,
    request_id:requestId,restore_steps:plan.steps.length,
    production_mutation:false});
  }
 });
}
module.exports=Object.freeze({BACKUPS,LOCKS,
 safeDir,readFixed,assertConsumed,createRecovery});
