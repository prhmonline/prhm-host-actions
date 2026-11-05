'use strict';
/**
 * Fixed-path single-use registration fence.
 *
 * A consumed Ed25519 token proves Approval Center consumption, NOT that the
 * trusted executor has never applied it before. The root-owned executor must
 * reserve the request atomically and durably before ANY target file write.
 *
 * The reservation intentionally remains after failure. Recovery is a
 * separate action bound to the original consumed request and journal;
 * it never resets the reservation or reuses the approval.
 *
 * SOURCE ONLY. No CLI, generic path, network, token minting or root installer.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const gateway=require('./prhm-action-registry-gateway-v1.cjs');
const DIR='/var/lib/prhm-agent-selfmaint-exec/registry-one-time-v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
function fail(name){throw Error('registry_once_'+name)}
function check(v,name){if(!v)fail(name)}
function binding({approval,args}){
 const argsHash=gateway.approvalBindingSha(args);
 check(approval?.action===gateway.ACTION&&approval?.operation===gateway.OPERATION&&
   approval?.level===4&&approval?.risk==='critical'&&
   UUID.test(approval?.request_id||'')&&
   approval?.arguments_sha256===argsHash&&
   typeof args?.project==='string'&&
   args?.source_commit&&args?.manifest_commit&&SHA.test(args?.manifest_sha256||''),
   'signed_request_binding_invalid');
 return Object.freeze({
   schema:'prhm.registry.once.v1',request_id:approval.request_id,
   action:gateway.ACTION,operation:gateway.OPERATION,
   project:args.project,source_commit:args.source_commit,
   manifest_commit:args.manifest_commit,
   manifest_sha256:args.manifest_sha256,
   arguments_sha256:argsHash
 });
}
function dirStat(io){
 const st=io.lstatSync(DIR);
 check(st.isDirectory()&&!st.isSymbolicLink()&&
   st.uid===0&&st.gid===0&&(st.mode&0o777)===0o700&&
   io.realpathSync(DIR)===DIR,'private_directory_not_ready');
 return st;
}
function reserve({approval,args,io=fs}){
 const data=binding({approval,args});
 const d=dirStat(io);
 // Atomic O_EXCL provides a cross-process conflict fence. A partially written
 // reservation is NOT removed: uncertain execution must never be replayed.
 const dest=path.join(DIR,data.request_id+'.json');
 let fd,created=false;
 try{
   fd=io.openSync(dest,
     fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,
     0o600);
   created=true;
   const bytes=Buffer.from(gateway.canonicalJson(data)+'\n','utf8');
   const n=io.writeSync(fd,bytes,0,bytes.length);
   check(n===bytes.length,'partial_write');
   io.fsyncSync(fd);
   const file=io.fstatSync(fd);
   check(file.isFile()&&!file.isSymbolicLink()&&file.uid===0&&file.gid===0&&
     (file.mode&0o777)===0o600&&file.size===bytes.length,'claim_file_metadata_drift');
 }catch(e){
   if(e?.code==='EEXIST')fail('already_reserved_or_replayed');
   // Do not delete on any write/fsync/readback failure, ever.
   throw e;
 }finally{if(fd!==undefined)io.closeSync(fd)}
 check(created,'claim_not_created');
 const afterDir=dirStat(io);
 check(d.dev===afterDir.dev&&d.ino===afterDir.ino,'directory_replaced');
 const dirFd=io.openSync(DIR,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try {
   const s=io.fstatSync(dirFd);
   check(s.isDirectory()&&s.dev===d.dev&&s.ino===d.ino,'directory_fd_swapped');
   io.fsyncSync(dirFd);
 }finally{io.closeSync(dirFd)}
 return Object.freeze({request_id:data.request_id,
   arguments_sha256:data.arguments_sha256,exclusive:true,durable:true});
}
function reserveFromVerifiedApproval({approval,args}){
 check(process.getuid?.()===0,'root_executor_required');
 return reserve({approval,args,io:fs});
}
module.exports=Object.freeze({DIR,binding,reserve,reserveFromVerifiedApproval});
