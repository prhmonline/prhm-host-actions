'use strict';
// Node1 Agent3 read-only registration release preflight. This file never installs,
// registers a tool, edits a service, invokes SSH, or requests approval.
// Owners are exact SHA-256 observations from Agent3 Primary (2026-10-08).
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const registration=require('./node1-vm-geometry-registration-plan-v1');
const OWNERS=Object.freeze([
 Object.freeze({key:'agent_api',path:'/home/agent/ssh-agent-api/server.js',sha256:'c8af6a5ce5955629e5d6dd7737337d26164a267c00de36cd4ebec89a9e5a890c'}),
 Object.freeze({key:'agent_mcp',path:'/home/agent/ssh-mcp-server/src/core/registry.js',sha256:'7432741650ee5c5bc3bb72c1403050b27a665e9218153b40e58955da77b471a4'})
]);
const hex64=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const hex40=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
function pinCode(code){return String(code).replace(/[^A-Za-z0-9:_-]/g,'').slice(0,110)}
function blobSha(buffer){if(!Buffer.isBuffer(buffer))throw Error('blob_bytes_required');return crypto.createHash('sha1').update(Buffer.from('blob '+buffer.length+'\0')).update(buffer).digest('hex')}
function validateObserved(observed){
 const errors=[];
 if(!observed||typeof observed!=='object'||Array.isArray(observed))
   return Object.freeze({ok:false,errors:Object.freeze(['owner_evidence_missing'])});
 if(Object.keys(observed).sort().join('|')!==OWNERS.map(x=>x.key).sort().join('|'))
   errors.push('owner_cardinality_or_identity_mismatch');
 for(const owner of OWNERS){
   const r=observed[owner.key];
   if(!r||typeof r!=='object'||r.path!==owner.path||r.isFile!==true||r.isSymlink!==false
     ||r.writableByOther===true||r.writableByGroup===true
     ||!Number.isSafeInteger(r.size)||r.size<1||r.size>1024*1024
     ||!hex64(r.sha256)||r.sha256!==owner.sha256){
     errors.push('owner_baseline_mismatch:'+owner.key);
   }
 }
 return Object.freeze({ok:errors.length===0,errors:Object.freeze(errors)});
}
function verifySourceBlobs(blobs){
 const errors=[];
 if(!blobs||typeof blobs!=='object'||Array.isArray(blobs)||
   Object.keys(blobs).sort().join('|')!==registration.FILES.map(x=>x.path).sort().join('|'))
   errors.push('source_blob_inventory_mismatch');
 for(const f of registration.FILES){
   const bytes=blobs?.[f.path];
   if(!Buffer.isBuffer(bytes)||!hex40(f.sha)||blobSha(bytes)!==f.sha)
     errors.push('source_blob_mismatch:'+f.path);
 }
 return Object.freeze({ok:errors.length===0,errors:Object.freeze(errors)});
}
function inspectOwner(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
   const before=fs.fstatSync(fd);
   if(!before.isFile()||before.size<1||before.size>1024*1024)throw Error('owner_file_type_or_size');
   const buffers=[],buf=Buffer.allocUnsafe(32768);
   let n;
   while((n=fs.readSync(fd,buf,0,buf.length,null))>0){
     buffers.push(Buffer.from(buf.subarray(0,n)));
     if(buffers.reduce((total,b)=>total+b.length,0)>1024*1024)throw Error('owner_bytes_exceeded');
   }
   const after=fs.fstatSync(fd);
   if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size
     ||before.mtimeMs!==after.mtimeMs)throw Error('owner_changed_during_read');
   const bytes=Buffer.concat(buffers);
   if(bytes.length!==before.size)throw Error('owner_short_read');
   return {path:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
     isFile:before.isFile(),isSymlink:false,size:before.size,
     writableByOther:(before.mode&0o002)!==0,writableByGroup:(before.mode&0o020)!==0};
 }finally{fs.closeSync(fd)}
}
function inspectSourceFile(rel){
 if(typeof rel!=='string'||!registration.FILES.some(x=>x.path===rel)||rel.includes('/')||rel.includes('..'))throw Error('source_path_invalid');
 const file=path.join(__dirname,rel);
 const lstat=fs.lstatSync(file);
 if(!lstat.isFile()||lstat.isSymbolicLink()||lstat.size>1024*1024)throw Error('source_file_unsafe');
 return fs.readFileSync(file);
}
function preflight(readOwner=inspectOwner,readSource=inspectSourceFile){
 const observed={},blobs={},errors=[];
 for(const o of OWNERS){try{observed[o.key]=readOwner(o.path)}catch(e){errors.push('owner_unreadable:'+o.key)}}
 for(const f of registration.FILES){try{blobs[f.path]=readSource(f.path)}catch(e){errors.push('source_unreadable:'+f.path)}}
 const a=validateObserved(observed),b=verifySourceBlobs(blobs);
 const reasons=[...errors,...a.errors,...b.errors];
 return Object.freeze({schema_version:'prhm.node1-agent3-registration-preflight.v1',
   source_commit:registration.SOURCE_COMMIT,agent3_owner_sha_binding:true,
   owner_files_verified:a.ok,git_source_blobs_verified:b.ok,
   preflight_pass:reasons.length===0,blockers:Object.freeze([...new Set(reasons.map(pinCode))]),
   read_only:true,requested_approval:false,changes_applied:false,service_restarted:false,
   production_backup_performed:false,approved_for_deployment:false,
   level4_required:true,registered:false});
}
function main(args=process.argv.slice(2)){
 if(!Array.isArray(args)||args.length!==1||args[0]!=='--preflight-only')throw Error('only_readonly_preflight_allowed');
 return preflight();
}
if(require.main===module){
 try{const result=main();process.stdout.write(JSON.stringify(result)+'\n');if(!result.preflight_pass)process.exitCode=2}
 catch(e){process.stderr.write(JSON.stringify({ok:false,error:pinCode(e.message||e)})+'\n');process.exitCode=2}
}
module.exports={OWNERS,blobSha,validateObserved,verifySourceBlobs,inspectOwner,inspectSourceFile,preflight,main};
