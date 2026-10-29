'use strict';
/*
 * Honartik V2 separately deployable independent ROOT launcher.
 * This SOURCE ONLY file is not a grant to deploy or invoke Production.
 *
 * Authorized host bootstrap MUST pin the launcher itself and all loaded
 * dependencies to immutable Git blobs before launch. Independently, this
 * launcher checks a fixed pinned 26-object manifest, the root-owned stage,
 * a root-only independent transient systemd unit and sealed credentials.
 * All code with side effects is required only AFTER on-disk attestation.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ROOT='/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2';
const MANIFEST='manifests/honartik-shared-registry-v2-unified-root-closure-v1.json';
const MANIFEST_BLOB='679fbeab0500620b40b648197974e7abc002f9b9';
const UNIT=/^prhm-shared-registry-bootstrap-v2-[a-z0-9-]+\.service$/;
const SHA=/^[0-9a-f]{40}$/;
const FILE=/^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/;
function refuse(reason){throw Error('registry_v2_independent_launcher_'+reason)}
function must(cond,reason){if(!cond)refuse(reason)}
function blob(bytes){
 return crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0'))
  .update(bytes).digest('hex');
}
function safeDirectory(io,directory,privateDir=false){
 const st=io.lstatSync(directory);
 must(st.isDirectory()&&!st.isSymbolicLink()&&
   io.realpathSync(directory)===directory&&
   st.uid===0&&st.gid===0&&(st.mode&0o022)===0&&
   (!privateDir||(st.mode&0o777)===0o700),
   'untrusted_directory');
 return st;
}
function readReviewed(io,filename,expectedBlob,max=4000000){
 must(filename.startsWith(ROOT+'/')&&
  path.posix.normalize(filename)===filename&&
  SHA.test(expectedBlob),'read_path_or_pin_untrusted');
 safeDirectory(io,path.posix.dirname(filename));
 const st=io.lstatSync(filename);
 must(st.isFile()&&!st.isSymbolicLink()&&
  io.realpathSync(filename)===filename&&
  st.uid===0&&st.gid===0&&(st.mode&0o022)===0&&
  st.size>0&&st.size<=max,'untrusted_runtime_file');
 const fd=io.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let bytes;
 try{
  const n=io.fstatSync(fd);
  must(n.isFile()&&n.dev===st.dev&&n.ino===st.ino&&
   n.uid===st.uid&&n.gid===st.gid&&n.mode===st.mode&&
   n.size===st.size,'runtime_race');
  bytes=io.readFileSync(fd);
 }finally{io.closeSync(fd)}
 must(Buffer.isBuffer(bytes)&&bytes.length===st.size&&
  blob(bytes)===expectedBlob,'runtime_git_blob_drift');
 return bytes;
}
function assertIndependent({io=fs,getuid=()=>process.getuid?.()}={}){
 must(getuid()===0,'root_required');
 const data=io.readFileSync('/proc/self/cgroup','utf8');
 must(typeof data==='string'&&data.length>0&&data.length<8192&&
  !data.includes('/prhm-agent-selfmaint-exec.service')&&
  !data.includes('/prhm-agent-selfmaint.service'),'untrusted_cgroup');
 const units=data.split('\n').filter(Boolean)
  .flatMap(x=>x.split('/')).filter(x=>x.includes('prhm-shared-registry-bootstrap-v2-'));
 must(units.length===1&&UNIT.test(units[0]),
  'independent_transient_unit_required');
 return units[0];
}
function attestation({io=fs,getuid=()=>process.getuid?.()}={}){
 const unit=assertIndependent({io,getuid});
 safeDirectory(io,ROOT,true);
 safeDirectory(io,ROOT+'/manifests',true);
 const buf=readReviewed(io,ROOT+'/'+MANIFEST,MANIFEST_BLOB,128000);
 let m;
 try{m=JSON.parse(buf.toString('utf8'))}catch{refuse('manifest_json_invalid')}
 must(m?.schema==='prhm.honartik.shared-registry-v2.unified-root-closure.v1'&&
   m?.repository==='prhmonline/prhm-host-actions'&&
   m?.project==='honartik'&&m?.runtime_root===ROOT&&
   m?.status==='SOURCE_ONLY_NOT_STAGED'&&
   m?.required_root_capability_count===12&&
   m?.minimum_signed_approval_level===4&&
   m?.legacy_runtime_count===20&&m?.new_root_runtime_count===6&&
   m?.total_runtime_count===26&&
   Array.isArray(m.files)&&m.files.length===26,
   'release_closure_invalid');
 for(const k of ['root_installed','independent_launcher_enabled',
  'authenticated_discovery_verified','approved_for_production',
  'approval_issued','approval_consumed','production_mutated']){
  must(m[k]===false,'source_only_guard_'+k);
 }
 const seen=new Set();
 for(const r of m.files){
  must(r&&FILE.test(r.source_path)&&!r.source_path.includes('..')&&
   r.destination===ROOT+'/'+r.source_path&&SHA.test(r.source_commit)&&
   SHA.test(r.git_blob_sha1)&&!seen.has(r.destination),'invalid_file_pin');
  seen.add(r.destination);
  readReviewed(io,r.destination,r.git_blob_sha1);
 }
 must(seen.has(ROOT+'/prhm-action-registry-v2-independent-runner-entry-v1.cjs')&&
  seen.has(ROOT+'/prhm-action-registry-v2-root-complete-capabilities-v1.cjs')&&
  seen.has(ROOT+'/prhm-action-registry-v2-durable-recovery-locksafe-v1.cjs'),
  'critical_runner_dependency_missing');
 return Object.freeze({ok:true,unit,verified_files:26,
  manifest_git_blob:MANIFEST_BLOB,production_mutated:false});
}
async function execute(){
 must(process.argv.length===2,'no_cli_arguments');
 must(!process.env.NODE_OPTIONS&&process.execArgv.length===0,
  'node_injection_not_allowed');
 const verified=attestation();
 // No mutable import, caller-supplied callback or credential is accepted.
 const entry=require('./prhm-action-registry-v2-independent-runner-entry-v1.cjs');
 const trusted=require('./prhm-action-registry-v2-root-complete-capabilities-v1.cjs');
 const credential=entry.secureCredential();
 must(credential.unit===verified.unit,'signed_credential_wrong_unit');
 const capabilities=trusted.createBoundTwelve({
  input:credential.input,approvalToken:credential.approvalToken
 });
 return entry.runWithCapabilities({credential,capabilities});
}
if(require.main===module){
 execute().then(result=>{
  // Never print bearer or signed token; only bounded installation summary.
  process.stdout.write(JSON.stringify({
   ok:result.ok===true,action:result.action,
   source_commit:result.source_commit,
   manifest_commit:result.manifest_commit,
   registry_visible:result.registry_visible===true
  })+'\n');
 }).catch(e=>{
  process.stderr.write(String(e?.message||'launcher_denied').slice(0,160)+'\n');
  process.exitCode=78;
 });
}
module.exports=Object.freeze({
 ROOT,MANIFEST,MANIFEST_BLOB,blob,readReviewed,assertIndependent,
 attestation,execute
});
