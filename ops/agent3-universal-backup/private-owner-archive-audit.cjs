'use strict';
/**
 * Fixed four-owner PRIVATE archive audit, never a source exporter or installer.
 *
 * The original archive already exists at the fixed root-only location.
 * This module validates its compressed SHA and all four uncompressed owner
 * SHA pins IN MEMORY without printing, persisting or uploading owner bytes.
 * No CLI paths, commands, approval tokens, tar extraction, service controls
 * or production writes. This is evidence only, NOT executable patch review.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const ARCHIVE='/root/agent3-owner-sources-review.tar.gz';
const ARCHIVE_SHA='ba591af9c53eb3f01ee78e347faba54dad9bf20edd2d49833b77449f25c108a6';
const MEMBERS=Object.freeze([
 Object.freeze({key:'base',name:'opt/prhm-agent-selfmaint/server.js',
  sha:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406'}),
 Object.freeze({key:'executor',name:'opt/prhm-agent-selfmaint-exec/server.js',
  sha:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0'}),
 Object.freeze({key:'policy',name:'opt/prhm-company-control-plane/config/approval-policy.json',
  sha:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174'}),
 Object.freeze({key:'mcp',name:'home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  sha:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'})
]);
const MAX_COMPRESSED=1024*1024;
const MAX_UNCOMPRESSED=20*1024*1024;
const sum=b=>crypto.createHash('sha256').update(b).digest('hex');
function deny(code){throw Error('agent3_private_archive_audit_denied:'+code);}
function checkOwnerBlobs(names,blobs){
 if(!Array.isArray(names)||names.length!==4||
    !blobs||typeof blobs!=='object'||Array.isArray(blobs)||
    Object.keys(blobs).sort().join('|')!==MEMBERS.map(x=>x.key).sort().join('|'))
  deny('exact_four_members_required');
 // Fail closed on archive links, unexpected entries and duplicates. No tar
 // extraction to the filesystem is permitted, even in a temporary folder.
 const expected=MEMBERS.map(x=>x.name).sort();
 if(names.slice().sort().some((name,i)=>name!==expected[i]))
  deny('archive_member_set_drift');
 for(const item of MEMBERS){
  const bytes=blobs[item.key];
  if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>MAX_UNCOMPRESSED)
   deny('invalid_member_bytes:'+item.key);
  if(sum(bytes)!==item.sha)deny('member_hash_mismatch:'+item.key);
 }
 return Object.freeze({
  ok:true,schema:'prhm.agent3.private-owner-archive-audit.v1',
  mode:'READ_ONLY_ROOT_PRIVATE_ARCHIVE',
  owner_count:4,owner_sha_pins_match:true,
  source_bytes_exposed:false,source_exported:false,
  patch_built:false,manifest_issued:false,approval_consumed:false,
  registry_mutation:false,production_mutation:false,
  ready_to_install:false,
  next_gate:'REVIEW_EXECUTOR_AND_MCP_NATIVE_FIVE_FIELD_WIRING_WITH_PRIVATE_FULL_OWNER_BYTES'
 });
}
function verifyFixedArchiveDescriptor(){
 if(process.getuid?.()!==0)deny('root_required');
 const parent=path.dirname(ARCHIVE);
 if(parent!=='/root')deny('untrusted_parent');
 const pst=fs.lstatSync(parent);
 if(!pst.isDirectory()||pst.isSymbolicLink()||pst.uid!==0||
    (pst.mode&0o022)!==0||fs.realpathSync(parent)!==parent)
  deny('unsafe_root_archive_directory');
 const st=fs.lstatSync(ARCHIVE);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||
    (st.mode&0o077)!==0||st.size<100||st.size>MAX_COMPRESSED)
  deny('unsafe_private_archive');
 const fd=fs.openSync(ARCHIVE,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const before=fs.fstatSync(fd);
  if(!before.isFile()||before.ino!==st.ino||before.dev!==st.dev||
     before.uid!==st.uid||before.size!==st.size)
   deny('archive_descriptor_race');
  const bytes=fs.readFileSync(fd);
  const after=fs.fstatSync(fd);
  if(bytes.length!==before.size||before.ino!==after.ino||
     before.dev!==after.dev||before.size!==after.size||
     before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)
   deny('archive_modified_during_read');
  if(sum(bytes)!==ARCHIVE_SHA)deny('archive_sha_drift');
  return Object.freeze({dev:st.dev,ino:st.ino,size:st.size,
   mtimeMs:st.mtimeMs,ctimeMs:st.ctimeMs});
 }finally{fs.closeSync(fd);}
}
function tarRead(args,maxBuffer){
 const result=cp.spawnSync('/usr/bin/tar',args,{
  shell:false,windowsHide:true,timeout:12000,maxBuffer,
  encoding:null,env:{PATH:'/usr/bin:/bin',LANG:'C'}
 });
 if(result.error||result.signal||result.status!==0||
    !Buffer.isBuffer(result.stdout))deny('tar_read_failed');
 return result.stdout;
}
function auditPrivateArchive(){
 const before=verifyFixedArchiveDescriptor();
 const rawNames=tarRead(['-tzf',ARCHIVE],8192);
 const namesText=rawNames.toString('utf8');
 if(!namesText.endsWith('\n')||namesText.includes('\0'))
  deny('invalid_tar_listing');
 const names=namesText.slice(0,-1).split('\n');
 const expected=MEMBERS.map(x=>x.name).sort();
 if(names.length!==4||names.slice().sort().some((x,i)=>x!==expected[i]))
  deny('tar_members_not_fixed');
 const blobs={};
 for(const item of MEMBERS)
  blobs[item.key]=tarRead(['-xOzf',ARCHIVE,'--',item.name],MAX_UNCOMPRESSED);
 const result=checkOwnerBlobs(names,blobs);
 // Archive path was never a trusted data destination. Verify again after
 // tar's independent reads to deny concurrent replacement/drift.
 const after=verifyFixedArchiveDescriptor();
 if(before.dev!==after.dev||before.ino!==after.ino||
    before.size!==after.size||before.mtimeMs!==after.mtimeMs||
    before.ctimeMs!==after.ctimeMs)deny('archive_changed_during_audit');
 return Object.freeze({...result,archive_sha256:ARCHIVE_SHA,
  compressed_sha_verified:true,root_only_verified:true});
}
if(require.main===module){
 if(process.argv.length!==3||process.argv[2]!=='--check'){
  process.stderr.write('fixed root-private archive: read-only --check only\n');
  process.exitCode=64;
 }else{
  try{process.stdout.write(JSON.stringify(auditPrivateArchive())+'\n');}
  catch(e){process.stderr.write(String(e.message||e)+'\n');process.exitCode=78;}
 }
}
module.exports=Object.freeze({ARCHIVE,ARCHIVE_SHA,MEMBERS,MAX_COMPRESSED,
 checkOwnerBlobs,auditPrivateArchive});
