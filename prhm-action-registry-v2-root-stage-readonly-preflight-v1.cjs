'use strict';
/**
 * Read-only root host preflight for the 28-object Honartik V2 source stage.
 *
 * This is NOT a root deployment executor or an authorization authority.
 * It does not open credential, Ed25519, bearer, consumed ledger or journal
 * files. It never mkdir/chmod/write/rename/restart/consume/install.
 * All paths, SHA values and service names are fixed by Git-reviewed code.
 * A separately authorized bootstrap must attest this preflight source itself
 * before trusting any results or performing subsequent stage operations.
 */
const fs=require('node:fs');
const cp=require('node:child_process');
const path=require('node:path');
const crypto=require('node:crypto');
const S=require('./manifests/honartik-shared-registry-v2-independent-root-launcher-stage-v2.json');
const ROOT='/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2';
const UNIT='prhm-shared-registry-approval-v2.service';
const NODE='/usr/local/bin/prhm-node20';
function hash(b){
 return crypto.createHash('sha1')
  .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
}
function validate(){
 if(S.schema!=='prhm.honartik.registry-v2.independent-root-launcher-stage.v2'||
  S.status!=='REVIEWED_SOURCE_ONLY_NOT_STAGED'||
  S.repo!=='prhmonline/prhm-host-actions'||S.project!=='honartik'||
  S.root!==ROOT||S.declared_runtime_source_count!==28||
  !Array.isArray(S.reviewed_code)||S.reviewed_code.length!==28||
  S.locked_root_capability_count!==12||
  S.reviewed_code.some(x=>x?.destination!==ROOT+'/'+x.source_path||
   !/^[0-9a-f]{40}$/.test(x.source_commit)||
   !/^[0-9a-f]{40}$/.test(x.git_blob_sha1)||
   !/^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(x.source_path)||
   x.source_path.includes('..'))||
  new Set(S.reviewed_code.map(x=>x.destination)).size!==28||
  S.reviewed_code.at(-1).source_path!==
   'manifests/honartik-shared-registry-v2-unified-root-closure-v1.json'||
  S.reviewed_code.at(-1).git_blob_sha1!==S.manifest_blob_sha1){
  throw Error('registry_v2_stage_preflight_unreviewed_28_file_closure');
 }
 return true;
}
function fixedUnitState(execFileSync=cp.execFileSync){
 const out=execFileSync('/usr/bin/systemctl',
  ['show','--property=LoadState,ActiveState,FragmentPath','--',UNIT],{
   encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:5000,maxBuffer:8192
  });
 if(typeof out!=='string'||out.length>8192)
  throw Error('registry_v2_stage_preflight_systemd_untrusted');
 const entries=out.split('\n').filter(Boolean).map(line=>{
  const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];
 });
 const kv=Object.fromEntries(entries);
 return Object.freeze({
  loaded:kv.LoadState==='loaded',active:kv.ActiveState==='active',
  fragment_present:typeof kv.FragmentPath==='string'&&
   kv.FragmentPath.startsWith('/etc/systemd/system/')
 });
}
function safeDir(io,folder){
 const s=io.lstatSync(folder);
 if(!s.isDirectory()||s.isSymbolicLink()||io.realpathSync(folder)!==folder||
    s.uid!==0||s.gid!==0||(s.mode&0o022)!==0||
    (s.mode&0o777)!==0o700)
  throw Error('untrusted_root_directory');
}
function readReviewed(io,file,expected){
 if(!file.startsWith(ROOT+'/')||path.posix.normalize(file)!==file)
  throw Error('untrusted_runtime_path');
 const dir=path.posix.dirname(file);
 safeDir(io,ROOT);
 if(dir!==ROOT)safeDir(io,dir);
 const before=io.lstatSync(file);
 if(!before.isFile()||before.isSymbolicLink()||
  io.realpathSync(file)!==file||before.uid!==0||before.gid!==0||
  (before.mode&0o022)!==0||before.size<1||before.size>4000000)
  throw Error('untrusted_runtime_file');
 const fd=io.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let bytes;
 try{
  const after=io.fstatSync(fd);
  if(!after.isFile()||after.isSymbolicLink()||
    after.dev!==before.dev||after.ino!==before.ino||
    after.uid!==before.uid||after.gid!==before.gid||
    after.mode!==before.mode||after.size!==before.size)
   throw Error('runtime_file_raced');
  bytes=io.readFileSync(fd);
 }finally{io.closeSync(fd)}
 if(!Buffer.isBuffer(bytes)||bytes.length!==before.size||
  hash(bytes)!==expected)
  throw Error('runtime_git_blob_mismatch');
 return true;
}
function inspect({io=fs,getuid=()=>process.getuid?.(),readUnit=fixedUnitState}={}){
 validate();
 const blockers=[];
 const count={matching:0,missing:0,unsafe:0,unverified:0};
 if(getuid()!==0){
  return Object.freeze({schema:'prhm.registry-v2.host-readonly-preflight.v1',
   assessed:0,matching:0,blockers:Object.freeze(['ROOT_REQUIRED']),
   signed_stage_authorized:false,production_authorized:false,
   ready_for_activation:false,read_only:true});
 }
 for(const file of S.reviewed_code){
  try{
   readReviewed(io,file.destination,file.git_blob_sha1);
   count.matching++;
  }catch(e){
   if(e?.code==='ENOENT'){
    count.missing++;
    blockers.push('STAGE_MISSING:'+file.source_path);
   }else{
    count.unsafe++;
    blockers.push('STAGE_UNSAFE_OR_DRIFT:'+file.source_path);
   }
  }
 }
 let unit;
 try{unit=readUnit()}catch{unit=null}
 if(!unit?.loaded)blockers.push('APPROVAL_V2_UNIT_NOT_LOADED_OR_UNVERIFIED');
 if(unit?.active)blockers.push('UNEXPECTED_ACTIVE_APPROVAL_V2_UNIT');
 try{
  const st=io.lstatSync(NODE);
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||
   (st.mode&0o022)!==0||(st.mode&0o111)===0)
   blockers.push('NODE20_BINARY_UNTRUSTED');
 }catch{blockers.push('NODE20_BINARY_UNVERIFIED')}
 // Never read, log or test a private bearer, token, key or ledger here.
 // Even a perfect on-disk stage is not authorization to install or activate.
 blockers.push('SIGNED_L4_AND_SEALED_CREDENTIAL_PRECHECK_REQUIRED');
 blockers.push('DUAL_MCP_AUTHENTICATED_DISCOVERY_NOT_VERIFIED');
 blockers.push('COLD_HOST_ROLLBACK_DRILL_NOT_VERIFIED');
 return Object.freeze({
  schema:'prhm.registry-v2.host-readonly-preflight.v1',assessed:28,
  matching:count.matching,missing:count.missing,unsafe:count.unsafe,
  blockers:Object.freeze(blockers),read_only:true,
  signed_stage_authorized:false,production_authorized:false,
  ready_for_activation:false
 });
}
module.exports=Object.freeze({ROOT,UNIT,NODE,hash,validate,
 fixedUnitState,readReviewed,inspect});
