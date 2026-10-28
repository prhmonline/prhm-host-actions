'use strict';

/**
 * Issue #221: durable single-use pending request store CORE, source-only.
 * NOT a standalone service/CLI, bootstrap, issuer, installer or MCP action.
 * The existing trusted root executor MUST bind this only to STATE_DIR;
 * no caller may supply a directory, root capabilities or request fields.
 *
 * The sandbox factory supports disposable Linux CI; production factory
 * refuses non-root and is pinned to the single fixed state directory.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const bridge=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const DIR='/var/lib/prhm-agent-selfmaint-exec/registrar-pending-v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=x=>{throw Error('registrar_store_'+x)};
const SHA=b=>crypto.createHash('sha256').update(b).digest('hex');
function fsyncDir(dir){
 const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function assertDir(dir,uid){
 if(!path.isAbsolute(dir)||fs.realpathSync(dir)!==dir)fail('directory_path_unsafe');
 const st=fs.lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==uid||
    (st.mode&0o077)!==0)fail('directory_untrusted');
}
function assertFile(st,uid){
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.uid!==uid||
    (st.mode&0o777)!==0o600)fail('file_untrusted');
}
function exact(o,keys){
 if(!o||typeof o!=='object'||Array.isArray(o)||
    Object.keys(o).sort().join('|')!==keys.slice().sort().join('|'))
    fail('record_schema');
}
const FIELDS=Object.freeze(['schema','request_id','status','action','project',
 'source_commit','manifest_commit','manifest_sha256','arguments_sha256',
 'policy_version','policy_hash','expires_at']);
function validate(record){
 exact(record,FIELDS);
 if(!UUID.test(record.request_id||''))fail('request_id_invalid');
 // Preserve the complete five-field contract, not only its object shape.
 bridge.bindPendingExecute(record,{request_id:record.request_id,
  second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'},Date.now());
}
function readSecureFile(filename,uid,maxBytes){
 const pre=fs.lstatSync(filename);assertFile(pre,uid);
 if(pre.size<=0||pre.size>maxBytes)fail('file_size_invalid');
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const st=fs.fstatSync(fd);assertFile(st,uid);
  if(st.dev!==pre.dev||st.ino!==pre.ino||st.size!==pre.size)
   fail('file_race');
  const data=fs.readFileSync(fd);
  if(data.length!==pre.size)fail('file_read_short');
  return data;
 }finally{fs.closeSync(fd)}
}
function writeExclusive(filename,payload,uid){
 if(!Buffer.isBuffer(payload)||payload.length<=0||payload.length>8192)
  fail('write_size_invalid');
 const fd=fs.openSync(filename,
  fs.constants.O_CREAT|fs.constants.O_EXCL|
  fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
 try{
  const st=fs.fstatSync(fd);assertFile(st,uid);
  let pos=0;
  while(pos<payload.length){
   const n=fs.writeSync(fd,payload,pos,payload.length-pos,pos);
   if(n<=0)fail('write_short');
   pos+=n;
  }
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 fsyncDir(path.dirname(filename));
}
function createCore(directory,uid){
 assertDir(directory,uid);
 const pend=path.join(directory,'pending');
 const claims=path.join(directory,'claimed');
 function verifyStateDirs(){
  assertDir(directory,uid);
  assertDir(pend,uid);
  assertDir(claims,uid);
 }
 verifyStateDirs();
 const file=id=>{
  if(!UUID.test(id||''))fail('request_id_invalid');
  return path.join(pend,id+'.json');
 };
 const claimFile=id=>{
  if(!UUID.test(id||''))fail('request_id_invalid');
  return path.join(claims,id+'.json');
 };
 function readPending(id){
  verifyStateDirs();
  const stored=readSecureFile(file(id),uid,8192);
  if(fs.existsSync(claimFile(id)))fail('already_claimed');
  let record;
  try{record=JSON.parse(stored.toString('utf8'))}
  catch{fail('record_json_invalid')}
  validate(record);
  if(record.request_id!==id)fail('record_id_mismatch');
  return record;
 }
 function writePendingExclusive(record){
  verifyStateDirs();
  validate(record);
  if(fs.existsSync(claimFile(record.request_id)))fail('already_claimed');
  const payload=Buffer.from(JSON.stringify(record)+'\n');
  writeExclusive(file(record.request_id),payload,uid);
  return true;
 }
 function claimPendingAtomically(record){
  verifyStateDirs();
  validate(record);
  const id=record.request_id;
  // Exclusive claim is persistent. No cleanup/retry through public apply,
  // even if process crashes after marker creation or approval fails.
  if(fs.existsSync(claimFile(id)))fail('already_claimed');
  const original=readSecureFile(file(id),uid,8192);
  if(original.toString('utf8')!==JSON.stringify(record)+'\n')
   fail('record_changed_since_read');
  const payload=Buffer.from(JSON.stringify({
   schema:'prhm.registrar.claim.v1',request_id:id,
   arguments_sha256:record.arguments_sha256,
   pending_sha256:SHA(original),state:'CLAIMED_FAIL_CLOSED'
  })+'\n');
  writeExclusive(claimFile(id),payload,uid);
  // A concurrent attacker rewriting the pending request after the claim
  // must not allow a different tuple to be consumed.
  const second=readSecureFile(file(id),uid,8192);
  if(!second.equals(original))fail('record_changed_during_claim');
  return true;
 }
 return Object.freeze({readPending,writePendingExclusive,claimPendingAtomically});
}
function openProductionStore(){
 if(typeof process.getuid!=='function'||process.getuid()!==0)
  fail('root_required');
 return createCore(DIR,0);
}
// Disposable Linux-only fixtures; NOT wired to any HTTP/MCP/production route.
function openDisposableTestStore(dir){
 if(typeof dir!=='string'||!dir.startsWith('/tmp/registrar-ci-'))
  fail('sandbox_path_restricted');
 return createCore(dir,process.getuid());
}
module.exports=Object.freeze({DIR,openProductionStore,openDisposableTestStore});
if(require.main===module){
 process.stderr.write('No standalone registry store or bootstrap.\n');
 process.exitCode=64;
}
