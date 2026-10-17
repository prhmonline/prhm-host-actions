'use strict';
/**
 * Crash-durable native Agent3 five-field pending REQUEST store.
 *
 * Production entry points bind to one fixed root-owned directory, UID 0,
 * exact UUID filenames, O_EXCL and fsync(file)+fsync(directory). A pending
 * record is evidence of an unapproved request, NOT approval itself.
 *
 * The trusted root executor must independently receive a REAL request ID
 * from its authenticated Approval Center request flow, then persist it here.
 * Reading a pending record never invokes, signs, approves, consumes or
 * executes an action; a signed Level-4 JWS and its consumed ledger remain
 * separately mandatory for the native dispatcher.
 *
 * No CLI mode, implicit mkdir, overwrite, delete, update, arbitrary file
 * path, approved flag, request token, secret or caller-selected UID.
 */
const fs=require('node:fs');
const path=require('node:path');
const route=require('./five-field-native-route-contract.cjs');
const gateway=require('../../prhm-action-registry-gateway-v1.cjs');
const ROOT='/var/lib/prhm-agent-selfmaint-exec/agent3-registry-pending-v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REC_KEYS=Object.freeze(['request_id','status','expires_at','arguments','arguments_sha256','request_hash']);
const MAX_BYTES=2048;
const MAX_TTL_MS=180000;
const DIR_FLAGS=fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW;
const FILE_FLAGS=fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK;
function deny(reason){throw Error('agent3_native_pending_store_denied:'+reason);}
function exact(v,ks){return !!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join('|')===ks.slice().sort().join('|');}
function directory(dir,uid){
 if(!path.isAbsolute(dir)||path.resolve(dir)!==dir||fs.realpathSync(dir)!==dir)
  deny('noncanonical_directory');
 const st=fs.lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==uid||
    (st.mode&0o077)!==0)deny('unsafe_directory');
 const fd=fs.openSync(dir,DIR_FLAGS);
 try{
  const opened=fs.fstatSync(fd);
  if(!opened.isDirectory()||opened.ino!==st.ino||
     opened.dev!==st.dev||opened.uid!==st.uid)
   deny('directory_open_race');
 }finally{fs.closeSync(fd);}
 return st;
}
function record({requestId,arguments:args,expiresAt,nowMs=Date.now()}={}){
 if(!UUID.test(requestId||''))deny('request_id');
 if(!Number.isSafeInteger(nowMs)||nowMs<=0||
    typeof expiresAt!=='string')deny('clock_or_expiry');
 const deadline=Date.parse(expiresAt);
 if(!Number.isFinite(deadline)||deadline<=nowMs||
    deadline>nowMs+MAX_TTL_MS)deny('expiry_outside_short_window');
 const prepared=route.prepareRequest(args);
 return Object.freeze({
  request_id:requestId,status:'pending',expires_at:expiresAt,
  arguments:prepared.storage_shape.arguments,
  arguments_sha256:prepared.arguments_sha256,
  request_hash:prepared.arguments_sha256
 });
}
function filenameFor(dir,id){
 if(!UUID.test(id||''))deny('invalid_lookup_request_id');
 return path.join(dir,id+'.json');
}
function writeInVerifiedDirectory(input,dir,uid,nowMs=Date.now()){
 const entry=record({...input,nowMs});
 const st=directory(dir,uid);
 const file=filenameFor(dir,entry.request_id);
 const bytes=Buffer.from(JSON.stringify(entry)+'\n');
 if(bytes.length>MAX_BYTES)deny('record_oversized');
 // File is immutable: no replace, unlink or retry after failed fsync.
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|
  fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try {
  let off=0;
  while(off<bytes.length){
   const n=fs.writeSync(fd,bytes,off,bytes.length-off,null);
   if(n<=0)deny('partial_record_write');
   off+=n;
  }
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd);}
 const dfd=fs.openSync(dir,DIR_FLAGS);
 try{
  const dst=fs.fstatSync(dfd);
  if(!dst.isDirectory()||dst.ino!==st.ino||dst.dev!==st.dev||
     dst.uid!==uid)deny('directory_swapped_during_write');
  fs.fsyncSync(dfd);
 }finally{fs.closeSync(dfd);}
 return Object.freeze({
  ok:true,request_id:entry.request_id,
  status:'pending',expires_at:entry.expires_at,
  arguments_sha256:entry.arguments_sha256,
  durable:true,exclusive:true,
  approved:false,consumed:false,installed:false
 });
}
function readFromVerifiedDirectory(id,dir,uid,nowMs=Date.now()){
 if(!Number.isSafeInteger(nowMs)||nowMs<=0)deny('clock_invalid');
 const parent=directory(dir,uid);
 const file=filenameFor(dir,id);
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==uid||
    (st.mode&0o077)!==0||(st.mode&0o600)!==0o600||
    st.size<80||st.size>MAX_BYTES)deny('unsafe_request_file');
 const fd=fs.openSync(file,FILE_FLAGS);
 let bytes;
 try{
  const before=fs.fstatSync(fd);
  if(!before.isFile()||before.ino!==st.ino||before.dev!==st.dev||
     before.uid!==st.uid||before.size!==st.size)deny('request_open_race');
  bytes=fs.readFileSync(fd);
  const after=fs.fstatSync(fd);
  if(after.ino!==before.ino||after.dev!==before.dev||
     after.uid!==before.uid||after.size!==before.size||
     after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||
     bytes.length!==before.size)deny('request_modified_during_read');
 }finally{fs.closeSync(fd);}
 const check=directory(dir,uid);
 if(check.ino!==parent.ino||check.dev!==parent.dev)
  deny('directory_swapped_during_read');
 let found;
 try{found=JSON.parse(bytes.toString('utf8'));}
 catch{deny('request_not_json');}
 if(!exact(found,REC_KEYS)||found.request_id!==id||found.status!=='pending')
  deny('request_schema_or_id_drift');
 const expiry=Date.parse(found.expires_at);
 if(!Number.isFinite(expiry)||expiry<=nowMs||expiry>nowMs+MAX_TTL_MS)
  deny('request_expired_or_ttl_invalid');
 const expected=route.prepareRequest(found.arguments);
 if(found.arguments_sha256!==expected.arguments_sha256||
    found.request_hash!==expected.arguments_sha256||
    found.arguments_sha256!==gateway.approvalBindingSha(found.arguments))
  deny('request_hash_drift');
 return Object.freeze({
  ...found,arguments:Object.freeze({...found.arguments})
 });
}
function storeNativePending(input){
 if(process.getuid?.()!==0)deny('trusted_root_required');
 return writeInVerifiedDirectory(input,ROOT,0);
}
function loadNativePending(requestId){
 if(process.getuid?.()!==0)deny('trusted_root_required');
 return readFromVerifiedDirectory(requestId,ROOT,0);
}
if(require.main===module){
 process.stderr.write('no standalone native request persistence or write mode\n');
 process.exitCode=78;
}
module.exports=Object.freeze({
 ROOT,MAX_BYTES,MAX_TTL_MS,REC_KEYS,record,
 storeNativePending,loadNativePending,
 // Isolated audited tests only; native Production uses ROOT and uid=0.
 writeInVerifiedDirectory,readFromVerifiedDirectory
});
