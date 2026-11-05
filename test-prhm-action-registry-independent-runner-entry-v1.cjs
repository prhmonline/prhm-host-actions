'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const e=require('./prhm-action-registry-independent-runner-entry-v1.cjs');
const bridge=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const runner=require('./prhm-action-registry-independent-runner-contract-v1.cjs');
const unit='prhm-shared-registry-bootstrap-v1-ab4c.service';
const folder='/run/credentials/'+unit;
const token='a'.repeat(80)+'.'+'b'.repeat(80)+'.'+'c'.repeat(80);
const pinned=runner.immutableRelease();
function fixture(override={},opt={}){
 const content=Buffer.from(JSON.stringify({...pinned,approval_token:token,...override}));
 let opens=0;
 const fd=42;
 const stFile={isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false,
  size:content.length,uid:0,gid:0,mode:0o100400,dev:1,ino:7};
 const stDir={isFile:()=>false,isDirectory:()=>true,isSymbolicLink:()=>false,
  uid:0,gid:0,mode:0o40700,dev:1,ino:5};
 const io={
  lstatSync:filename=>filename===folder?{...stDir,...opt.dir}:
    filename===folder+'/'+e.CREDENTIAL?{...stFile,...opt.file}:null,
  realpathSync:x=>x,
  openSync:()=>{opens++;return fd},
  fstatSync:()=>({...stFile,...opt.open}),
  readFileSync:()=>content,
  closeSync:()=>{}
 };
 const env={CREDENTIALS_DIRECTORY:opt.badDir||folder};
 const cgroup=()=>opt.cgroup||'0::/system.slice/'+unit+'\n';
 return {io,env,cgroup,getuid:()=>opt.uid??0,opens:()=>opens};
}
test('loads fixed six-field sealed credential with exact immutable signed request binding',()=>{
 const f=fixture();
 const v=e.secureCredential(f);
 assert.deepEqual(v.input,pinned);
 assert.equal(v.approvalToken,token);
 assert.equal(v.unit,unit);
 assert.equal(v.secret_source,'systemd-sealed-credential');
 assert.equal(f.opens(),1);
});
test('invalid unit, env source and root identity fail before opening secret',()=>{
 for(const opt of [
  {uid:1000},{badDir:'/tmp/credentials/'+unit},
  {badDir:'/run/credentials/other.service'},
  {cgroup:'0::/system.slice/prhm-agent-selfmaint-exec.service\n'}
 ]){
  const f=fixture({},opt);
  assert.throws(()=>e.secureCredential(f),/root_required|credential_path_or_unit_untrusted|independent_transient_runner_required/);
  assert.equal(f.opens(),0);
 }
});
test('untrusted approvals, source revisions, extra request fields and arbitrary paths fail closed',()=>{
 for(const change of [
  {source_commit:'f'.repeat(40)},
  {manifest_commit:'f'.repeat(40)},
  {manifest_sha256:'f'.repeat(64)},
  {project:'moeinshow'},
  {action:'other_action'},
  {approval_token:'not.a.jws'},
  {approval_token:'a'.repeat(40000)},
  {arbitrary_command:'systemctl restart ssh'}
 ]){
  const f=fixture(change);
  assert.throws(()=>e.secureCredential(f),/credential_file_unsafe|credential_release_not_pinned|action_not_allowlisted|credential_schema_invalid|signed_approval_token_format/);
 }
});
test('symlink, insecure permissions, changed inode, non-root credential are rejected',()=>{
 const mutations=[
  {dir:{isSymbolicLink:()=>true}},
  {dir:{mode:0o40777}},
  {file:{uid:1000}},
  {file:{mode:0o100644}},
  {file:{isSymbolicLink:()=>true}},
  {open:{ino:100}},
  {open:{mode:0o100600}}
 ];
 for(const opts of mutations){
  const f=fixture({},opts);
  assert.throws(()=>e.secureCredential(f),
   /credential_directory_unsafe|credential_file_unsafe|credential_file_replaced/);
 }
});
test('the caller cannot fabricate a credential provenance marker',async()=>{
 const fields=['readPinnedGitManifest','readPinnedGitSource','readLiveOwner',
  'readStagedAsset','getInstaller','getRollback','claimOnce',
  'verifyOriginalState','restartService','checkServiceHealth',
  'getToolDiscovery','writeMetadataAudit'];
 const caps=Object.fromEntries(fields.map(x=>[x,()=>true]));
 const forged={input:pinned,approvalToken:token,unit,
   secret_source:'systemd-sealed-credential'};
 await assert.rejects(e.runWithCapabilities({
   credential:forged,capabilities:caps
 }),/trusted_invocation_required/);
});
test('an injected approval executor is rejected before any callback is invoked',async()=>{
 const credential=e.secureCredential(fixture());
 let called=0;
 for(const fakeApproval of [async()=>({ok:true,registry_visible:true,
  source_commit:pinned.source_commit,manifest_commit:pinned.manifest_commit,
  rollback:'not_needed'}),()=>{called++}]) {
  await assert.rejects(e.runWithCapabilities({
    credential,capabilities:{},apply:fakeApproval
  }),/trusted_invocation_contract_invalid/);
 }
 assert.equal(called,0);
});
test('all 12 trusted Host Actions capabilities are checked before reading a signed approval',async()=>{
 const credential=e.secureCredential(fixture());
 await assert.rejects(e.runWithCapabilities({
   credential,capabilities:{}
 }),/trusted_capability_missing/);
 const funcs=['readPinnedGitManifest','readPinnedGitSource','readLiveOwner',
  'readStagedAsset','getInstaller','getRollback','claimOnce',
  'verifyOriginalState','restartService','checkServiceHealth',
  'getToolDiscovery','writeMetadataAudit'];
 let calls=0;
 const caps=Object.fromEntries(funcs.map(fn=>[fn,()=>{
   calls++;
   return true;
 }]));
 await assert.rejects(e.runWithCapabilities({
   credential,capabilities:caps
 }),/git_manifest_missing/);
 assert.equal(calls,1,'Only the bounded manifest read is attempted');
});
test('no caller-supplied success record or control field can reach the bridge',async()=>{
 const credential=e.secureCredential(fixture());
 for(const injection of [
  {result:{ok:true,registry_visible:true}},
  {verified_by_trusted_mediator:true},
  {signed:true},
  {approvalToken:token}
 ])await assert.rejects(e.runWithCapabilities({
  credential,capabilities:{},...injection
 }),/trusted_invocation_contract_invalid/);
});
test('standalone CLI is disabled before root I/O or credential reads',()=>{
 const r=cp.spawnSync(process.execPath,['prhm-action-registry-independent-runner-entry-v1.cjs'],
  {cwd:__dirname,encoding:'utf8',timeout:10000});
 assert.equal(r.status,78);
 assert.match(r.stderr,/trusted_host_capabilities_not_staged/);
 assert.equal(r.stdout,'');
 const injected=cp.spawnSync(process.execPath,
  ['prhm-action-registry-independent-runner-entry-v1.cjs','--apply'],
  {cwd:__dirname,encoding:'utf8',timeout:10000});
 assert.equal(injected.status,78);
 assert.match(injected.stderr,/no_arguments_allowed/);
});
