'use strict';
/**
 * Fixed Root-only persisted approval-token vault for Honartik Registry V2.
 * Save-once O_EXCL, 0600, fsync file+directory, O_NOFOLLOW, exact JWS
 * Ed25519 verification against the existing Approval Center public key.
 *
 * NO deletion or reset/reuse after error. The Approval Center ledger and
 * the independent execution one-time fence remain mandatory enforcement.
 * This module does NOT issue or consume an L4, run an installer, or deploy.
 */
const fs=require('node:fs'),path=require('node:path');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const F=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const DIR='/var/lib/prhm-agent-selfmaint-exec/registry-approval-v2';
const PUBLIC='/var/lib/prhm-company-approval/ed25519-public.pem';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function stop(x){throw Error('registry_v2_approval_vault_'+x)}
function check(v,x){if(!v)stop(x)}
function checkRoot(getuid){check(getuid()===0,'root_only')}
function safeDir(io){
 const d=io.lstatSync(DIR);
 check(d.isDirectory()&&!d.isSymbolicLink()&&
  io.realpathSync(DIR)===DIR&&d.uid===0&&d.gid===0&&
  (d.mode&0o777)===0o700,'private_dir_not_ready');
 return d;
}
function readFd(io,file,{min=1,max=16384,owner=null,privateMode=false}={}){
 const st=io.lstatSync(file);
 check(st.isFile()&&!st.isSymbolicLink()&&io.realpathSync(file)===file&&
  (st.mode&0o022)===0&&st.size>=min&&st.size<=max&&
  (owner===null||st.uid===owner)&&
  (!privateMode||(st.mode&0o777)===0o600),
  'file_unsafe');
 const fd=io.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let bytes;
 try{
  const next=io.fstatSync(fd);
  check(next.isFile()&&!next.isSymbolicLink()&&next.dev===st.dev&&
   next.ino===st.ino&&next.mode===st.mode&&next.uid===st.uid&&
   next.gid===st.gid&&next.size===st.size,'file_read_race');
  bytes=io.readFileSync(fd);
 }finally{io.closeSync(fd)}
 check(Buffer.isBuffer(bytes)&&bytes.length===st.size,'file_read_incomplete');
 return bytes;
}
function validateSigned(token,requestId,publicKey,nowSec=Math.floor(Date.now()/1000)){
 check(UUID.test(requestId),'request_id_invalid');
 check(typeof token==='string'&&token.length>=120&&token.length<=16384,
  'jws_not_supplied');
 const c=G.decodeJws(token,publicKey);
 check(c.request_id===requestId&&c.action===G.ACTION&&
  c.operation===G.OPERATION&&c.arguments_sha256===F.ARGUMENTS_SHA&&
  c.request_hash===F.ARGUMENTS_SHA&&c.project==='control_plane'&&
  c.environment==='production'&&c.tool==='host_action_v2_apply'&&
  c.principal_id==='mohammad'&&c.role==='mcp-operator'&&
  c.level===4&&c.risk==='critical'&&c.one_time_use===true&&
  c.policy_version===G.POLICY_VERSION&&c.decision==='accept'&&
  Number.isSafeInteger(nowSec)&&Number.isSafeInteger(c.nbf)&&
  Number.isSafeInteger(c.exp)&&c.nbf<=nowSec&&c.exp>nowSec,
  'signed_request_identity_or_expiry');
 return true;
}
function createVault({io=fs,getuid=()=>process.getuid?.(),
 now=()=>Math.floor(Date.now()/1000)}={}){
 checkRoot(getuid);
 function checkToken(token,id){
  // The key is an existing Approval Center SPKI. No private key or
  // agent-supplied alternate key source is ever accepted.
  const key=readFd(io,PUBLIC,{min:80,max:8192});
  validateSigned(token,id,key,now());
 }
 function sealApprovedToken(id,token){
  checkRoot(getuid);check(UUID.test(id),'request_id_invalid');
  const parent=safeDir(io);
  checkToken(token,id);
  const filename=DIR+'/'+id+'.json';
  const bytes=Buffer.from(JSON.stringify({
   schema:'prhm.registry-v2.sealed-approval.v1',
   request_id:id,approval_token:token})+'\n');
  check(bytes.length>=150&&bytes.length<=19000,'sealed_payload_invalid');
  let fd;
  try{
   fd=io.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
   check(io.writeSync(fd,bytes,0,bytes.length)===bytes.length,'partial_write');
   io.fsyncSync(fd);
   const stat=io.fstatSync(fd);
   check(stat.isFile()&&stat.uid===0&&stat.gid===0&&
    (stat.mode&0o777)===0o600&&stat.size===bytes.length,
    'stored_file_metadata_drift');
  }catch(e){
   // Never delete uncertain or partially written sealed approval bytes.
   // In particular, EEXIST is a permanent refusal to replace an L4 token.
   if(e?.code==='EEXIST')stop('already_sealed_no_reissue');
   throw e;
  }finally{if(fd!==undefined)io.closeSync(fd)}
  const current=safeDir(io);
  check(parent.dev===current.dev&&parent.ino===current.ino,
   'vault_dir_changed');
  const df=io.openSync(DIR,fs.constants.O_RDONLY|
   fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{
   const ds=io.fstatSync(df);
   check(ds.isDirectory()&&ds.dev===parent.dev&&ds.ino===parent.ino,
    'vault_dir_fd_drift');
   io.fsyncSync(df);
  }finally{io.closeSync(df)}
  return true;
 }
 function loadSealedApprovedToken(id){
  checkRoot(getuid);check(UUID.test(id),'request_id_invalid');safeDir(io);
  const raw=readFd(io,DIR+'/'+id+'.json',{min:150,max:19000,
   owner:0,privateMode:true});
  let x;
  try{x=JSON.parse(raw.toString('utf8'))}catch{stop('sealed_json_invalid')}
  check(x&&typeof x==='object'&&!Array.isArray(x)&&
   Object.keys(x).sort().join('|')==='approval_token|request_id|schema'&&
   x.schema==='prhm.registry-v2.sealed-approval.v1'&&x.request_id===id,
   'sealed_schema_invalid');
  checkToken(x.approval_token,id);
  return x.approval_token;
 }
 return Object.freeze({sealApprovedToken,loadSealedApprovedToken});
}
module.exports=Object.freeze({DIR,PUBLIC,validateSigned,createVault});
