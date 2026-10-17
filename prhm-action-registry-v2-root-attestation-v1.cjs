'use strict';
/**
 * Real read-only root attestation for the SHA-locked Honartik registry V2.
 * MUST be run by a separately authorized root process before any approval
 * request, policy change, stage, registration or service restart.
 *
 * This module performs no file mutation, shell, networking, approval, or
 * service control. It cannot mint a success/authorization or substitute for
 * live MCP blue/green discovery, root bootstrap or durable rollback tests.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const M=require('./manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json');
const release=require('./manifests/honartik-config-center-registry-release-v2.json');
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const blobSha=b=>crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const HEX40=/^[a-f0-9]{40}$/,HEX64=/^[a-f0-9]{64}$/;
const ROOT='/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2';
const OWNER_KEYS=Object.freeze(['base','executor','policy','mcp']);
function fail(s){throw Error('registry_v2_root_preflight_'+s)}
function check(ok,s){if(!ok)fail(s)}
function validatePinnedClosure(){
 check(M.schema==='prhm.shared-registry.v2.reviewed-runtime-stage.v1'&&
 M.project==='honartik'&&M.status==='NOT_STAGED'&&
 M.installation_authorized===false&&M.level4_consumed===false&&
 M.production_mutation===false&&M.destination_root===ROOT&&
 Array.isArray(M.files)&&M.files.length===20&&
 M.project_source_commit===release.source_commit&&
 M.release_manifest_sha256===sha256(Buffer.from(JSON.stringify(release,null,2)+'\n'))&&
 HEX40.test(M.release_manifest_commit)&&HEX64.test(M.approval_arguments_sha256),
 'immutable_closure_untrusted');
 check(M.independent_entrypoint===ROOT+'/prhm-action-registry-v2-independent-runner-entry-v1.cjs',
  'runner_entry_untrusted');
 const destinations=new Set(),sources=new Set();
 for(const f of M.files){
  check(f&&Object.keys(f).sort().join('|')==='destination|git_blob_sha1|source_commit|source_path'&&
   HEX40.test(f.git_blob_sha1)&&HEX40.test(f.source_commit)&&
   typeof f.source_path==='string'&&!f.source_path.startsWith('/')&&
   !f.source_path.includes('..')&&
   /^[a-zA-Z0-9._/-]+$/.test(f.source_path)&&
   f.destination===ROOT+'/'+f.source_path&&
   path.posix.normalize(f.destination)===f.destination&&
   !destinations.has(f.destination)&&!sources.has(f.source_path),
   'staged_file_pin_invalid');
  destinations.add(f.destination);sources.add(f.source_path);
 }
 check(destinations.has(M.independent_entrypoint)&&
  destinations.has(ROOT+'/prhm-action-registry-v2-approval-http-adapter-v1.cjs'),
  'critical_runtime_dependency_missing');
 check(Object.keys(release.registry_owners).sort().join('|')===
  OWNER_KEYS.slice().sort().join('|'),'four_owner_set_changed');
 return true;
}
function checkParent(io,absolute,rootOnly){
 check(typeof absolute==='string'&&absolute.startsWith('/')&&
  !absolute.includes('..')&&path.posix.normalize(absolute)===absolute,
  'noncanonical_path');
 const parent=path.posix.dirname(absolute);
 const st=io.lstatSync(parent);
 check(st.isDirectory()&&!st.isSymbolicLink()&&
  io.realpathSync(parent)===parent&&
  (st.mode&0o022)===0&&(!rootOnly||st.uid===0),
  'parent_not_trusted');
 return true;
}
function secureRead(io,filename,{expectedSha256=null,expectedGitBlob=null,max=4000000,rootParent=false}={}){
 checkParent(io,filename,rootParent);
 const st=io.lstatSync(filename);
 check(st.isFile()&&!st.isSymbolicLink()&&
  io.realpathSync(filename)===filename&&st.uid===0&&
  (st.mode&0o022)===0&&Number.isSafeInteger(st.size)&&
  st.size>0&&st.size<=max,'file_ownership_or_mode_or_size_untrusted');
 const fd=io.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let b;
 try{
  const latest=io.fstatSync(fd);
  check(latest.isFile()&&!latest.isSymbolicLink()&&
   latest.dev===st.dev&&latest.ino===st.ino&&
   latest.uid===st.uid&&latest.gid===st.gid&&
   latest.mode===st.mode&&latest.size===st.size,
   'fd_race_or_metadata_drift');
  b=io.readFileSync(fd);
 }finally{io.closeSync(fd)}
 check(Buffer.isBuffer(b)&&b.length===st.size,'read_length_mismatch');
 if(expectedSha256!==null)check(sha256(b)===expectedSha256,'expected_sha256_mismatch');
 if(expectedGitBlob!==null)check(blobSha(b)===expectedGitBlob,'expected_git_blob_mismatch');
 return b;
}
function inspect({io=fs,getuid=()=>process.getuid?.()}={}){
 check(getuid()===0,'root_only');
 validatePinnedClosure();
 // The order is intentional: read every protected original owner first,
 // then evaluate the stage. A modified owner must never be camouflaged
 // by a perfectly staged candidate.
 const owners={};
 for(const key of OWNER_KEYS){
  const pin=release.registry_owners[key];
  check(typeof pin?.path==='string'&&HEX64.test(pin.before_sha256),
   'owner_pin_missing_'+key);
  secureRead(io,pin.path,{expectedSha256:pin.before_sha256,max:3000000});
  owners[key]=pin.before_sha256;
 }
 checkParent(io,ROOT+'/immutable-runtime-placeholder',true);
 const d=io.lstatSync(ROOT);
 check(d.isDirectory()&&!d.isSymbolicLink()&&io.realpathSync(ROOT)===ROOT&&
  d.uid===0&&d.gid===0&&(d.mode&0o777)===0o700,
  'runtime_root_unsafe');
 for(const f of M.files){
  secureRead(io,f.destination,{expectedGitBlob:f.git_blob_sha1,max:4000000,rootParent:true});
 }
 // Does not infer real Approval Center readiness or independent execution
 // from source bytes. The router must separately probe both MCP workers,
 // sealed root transport and tested durable recovery.
 return Object.freeze({
  schema:'prhm.registry-v2.root-attestation.v1',
  project:'honartik',owner_shas:Object.freeze(owners),
  staged_file_count:M.files.length,runtime_git_pins_verified:true,
  root_runner_source_attested:true,source_only:true,
  approval_route_installed:false,authorization:false,
  at_ms:Date.now()
 });
}
module.exports=Object.freeze({ROOT,OWNER_KEYS,validatePinnedClosure,
 checkParent,secureRead,inspect});
