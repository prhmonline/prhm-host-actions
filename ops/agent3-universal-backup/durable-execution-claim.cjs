'use strict';
/**
 * Agent3-only, fixed-path root-owned durable execution claim.
 *
 * NOT a signer, approval issuer, registrar or installer. It is called ONLY
 * after trusted root executor verifies Ed25519 JWS, immutable
 * five-field binding and Approval Center consumed ledger.
 *
 * The claim is never erased, even if install fails or rollback succeeds.
 * New retries require NEW signed approval and request ID. The directory must
 * be provisioned by a separately approved bootstrap (0700 root-owned).
 * No CLI write and no implicit mkdir.
 */
const fs=require('node:fs'),path=require('node:path');
const registration=require('./registration-contract.cjs');
const gateway=require('../../prhm-action-registry-gateway-v1.cjs');
const ROOT='/var/lib/prhm-agent-selfmaint-exec/agent3-backup-execution-claims';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const KEYS=Object.freeze(['request_id','arguments_sha256','project','action','target_action',
 'source_commit','manifest_commit','manifest_sha256']);
function deny(reason){throw Error('agent3_execution_claim_denied:'+reason);}
function exact(x,keys){return x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===keys.slice().sort().join('|');}
function verifiedRequest(input){
 if(!exact(input,KEYS))deny('exact_fields_required');
 if(!UUID.test(input.request_id||'')||!SHA.test(input.arguments_sha256||'')||
    input.project!==registration.PROJECT||
    input.action!==registration.REGISTRY_ACTION||
    input.target_action!==registration.INSTALL_ACTION)
  deny('request_identity_mismatch');
 const arg={
  action:input.action,project:input.project,source_commit:input.source_commit,
  manifest_commit:input.manifest_commit,manifest_sha256:input.manifest_sha256
 };
 registration.boundArgs(arg);
 if(gateway.approvalBindingSha(arg)!==input.arguments_sha256)
  deny('five_field_binding_mismatch');
 return Object.freeze({...input});
}
function trustedDirectory(dir,uid){
 if(!path.isAbsolute(dir)||fs.realpathSync(dir)!==dir)deny('untrusted_directory_path');
 const st=fs.lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==uid||
    (st.mode&0o077)!==0)deny('untrusted_claim_directory');
 const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|
  fs.constants.O_NOFOLLOW);
 try{
  const opened=fs.fstatSync(fd);
  if(opened.ino!==st.ino||opened.dev!==st.dev||opened.uid!==st.uid||
     !opened.isDirectory())deny('directory_race');
 }finally{fs.closeSync(fd);}
 return st;
}
function claimInVerifiedDirectory(input,dir,expectedUid){
 const request=verifiedRequest(input);
 const before=trustedDirectory(dir,expectedUid);
 const filename=path.join(dir,request.request_id+'.claim');
 const reply=Object.freeze({claimed:false,durable:true,exclusive:true,
   request_id:request.request_id,arguments_sha256:request.arguments_sha256});
 let fd;
 try {
  fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 }catch(e){
  if(e.code==='EEXIST')return reply;
  throw e;
 }
 // Do not delete opened marker on failed fsync. An ambiguous result is denied.
 try{
  const record=Buffer.from(JSON.stringify({
   schema:'prhm.agent3.execution-claim.v1',
   ...request,created_at:new Date().toISOString()
  })+'\n');
  if(record.length>4096)deny('record_too_large');
  let offset=0;
  while(offset<record.length){
   const written=fs.writeSync(fd,record,offset,record.length-offset,null);
   if(written<=0)deny('record_short_write');
   offset+=written;
  }
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd);}
 const directoryFd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|
  fs.constants.O_NOFOLLOW);
 try{
  const check=fs.fstatSync(directoryFd);
  if(check.ino!==before.ino||check.dev!==before.dev||check.uid!==expectedUid)
   deny('directory_changed');
  fs.fsyncSync(directoryFd);
 }finally{fs.closeSync(directoryFd);}
 return Object.freeze({...reply,claimed:true});
}
function claimExecutionOnce(input){
 if(process.getuid?.()!==0)deny('root_required');
 return claimInVerifiedDirectory(input,ROOT,0);
}
if(require.main===module){
 process.stderr.write('No CLI execution-claim write; trusted root integration only.\n');
 process.exitCode=78;
}
module.exports=Object.freeze({
 ROOT,KEYS,verifiedRequest,claimExecutionOnce,
 // Isolated test primitive: no network route, privilege change or mkdir.
 claimInVerifiedDirectory
});
