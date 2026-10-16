'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const path=require('node:path');
const adapter=require('../ops/agent3-universal-backup/trusted-registration-adapter.cjs');
const registration=require('../ops/agent3-universal-backup/registration-contract.cjs');
const gateway=require('../prhm-action-registry-gateway-v1.cjs');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(){
 const before=Object.fromEntries(Object.keys(gateway.OWNER_PATHS).map(key=>[
  key,Buffer.from('live-owner-preimage:'+key)]));
 const manifest={
  schema_version:'prhm.action-registry.release.v1',
  project:registration.PROJECT,
  action:registration.INSTALL_ACTION,
  source_commit:registration.SOURCE_COMMIT,
  risk:'critical',approval_level:4,rollback_required:true,
  git_path:registration.EXPECTED_MANIFEST_PATH,
  registry_owners:Object.fromEntries(Object.entries(gateway.OWNER_PATHS).map(([k,p])=>
   [k,{path:p,before_sha256:sha(before[k]),
    after_sha256:sha(Buffer.from('reviewed patched candidate:'+k))}])),
  assets:[{path:'/opt/prhm-agent-selfmaint-exec/actions/agent3-backup-installer.cjs',
   source_path:'ops/agent3-universal-backup/install-candidate.js',
   sha256:sha(Buffer.from('pinned fixture installer'))}],
  health:{services:['prhm-agent-selfmaint.service',
   'prhm-agent-selfmaint-exec.service','prhm-agent-mcp-blue.service',
   'prhm-agent-mcp-green.service'],
   tool:registration.INSTALL_ACTION}
 };
 const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
 const args={action:gateway.ACTION,project:registration.PROJECT,
  source_commit:registration.SOURCE_COMMIT,
  manifest_commit:'b'.repeat(40),manifest_sha256:sha(manifestBytes)};
 const calls={install:0,rollback:0,audit:0};
 const capabilities={
  readPinnedGitManifest:({repo})=>{
   assert.equal(repo,registration.EXPECTED_GIT_REPO);
   return {path:registration.EXPECTED_MANIFEST_PATH,bytes:manifestBytes};
  },
  readPinnedGitSource:()=>Buffer.from('pinned fixture installer'),
  readLiveOwner:p=>before[Object.keys(gateway.OWNER_PATHS).find(k=>gateway.OWNER_PATHS[k]===p)],
  readStagedAsset:()=>Buffer.from('pinned fixture installer'),
  getInstaller:()=>async()=>{calls.install++;return{ok:true}},
  getRollback:()=>async()=>{calls.rollback++;return{verified:true}},
  verifyOriginalState:async()=>true,
  getToolDiscovery:async()=>true,
  writeMetadataAudit:async()=>{calls.audit++}
 };
 return {args,manifest,manifestBytes,capabilities,calls};
}
test('typed Agent 3 adapter validates immutable action, project and source commit',()=>{
 const f=fixture();
 const v=adapter.validate(f.args);
 assert.equal(v.project,'agent3');
 assert.equal(v.source_commit,registration.SOURCE_COMMIT);
 for(const changes of [
  {project:'honartik'},{source_commit:'0'.repeat(40)},
  {action:'host_action_v2_installer_v1'},
  {command:'whoami'},{approved:true},{confirmation:'CONFIRM_LEVEL_4_CRITICAL'}
 ]){
  assert.throws(()=>adapter.validate({...f.args,...changes}));
 }
});
test('offline preview verifies reviewed manifest, all owners and source bytes without approval',()=>{
 const f=fixture();
 const v=adapter.preview({input:f.args,capabilities:f.capabilities});
 assert.equal(v.ok,true);
 assert.equal(v.owner_count,4);
 assert.equal(v.asset_count,1);
 assert.equal(v.production_mutation,false);
 assert.equal(v.approval_consumed,false);
 assert.equal(v.registry_installed,false);
 assert.equal(f.calls.install,0);
});
test('reject fake manifest path, different action and altered source files',()=>{
 const f=fixture();
 assert.throws(()=>adapter.preview({input:f.args,capabilities:{
  ...f.capabilities,readPinnedGitManifest:()=>({
   bytes:f.manifestBytes,path:'ops/agent3-universal-backup/other.json'
  })
 }}),/unreviewed_manifest/);
 const other=fixture();other.manifest.action='other_project_install_v1';
 const otherBytes=Buffer.from(JSON.stringify(other.manifest));
 assert.throws(()=>adapter.preview({input:{
  ...other.args,manifest_sha256:sha(otherBytes)
 },capabilities:{...other.capabilities,readPinnedGitManifest:()=>({
  path:registration.EXPECTED_MANIFEST_PATH,bytes:otherBytes
 })}}),/manifest_target_mismatch/);
 const altered=fixture();
 assert.throws(()=>adapter.preview({input:altered.args,capabilities:{
  ...altered.capabilities,readPinnedGitSource:()=>Buffer.from('tampered installer')
 }}),/asset_sha_or_source_git_drift/);
});
test('trusted callback wrapping denies cross-action installer, rollback and discovery',()=>{
 const f=fixture();
 const c=adapter.boundCapabilities(f.capabilities);
 assert.throws(()=>c.getInstaller('honartik_git_worktree_fixed_v1'),/unexpected_install_action/);
 assert.throws(()=>c.getRollback('host_action_v2_installer_v1'),/unexpected_rollback_action/);
 assert.throws(()=>c.getToolDiscovery('drtarjomeh_security_containment_v1'),/unexpected_discovery_action/);
 assert.throws(()=>c.writeMetadataAudit({project:'honartik',action:adapter.ACTION}),/unexpected_audit_project/);
});
test('caller-controlled approved flag or fake token never invokes installer',async()=>{
 const f=fixture();
 await assert.rejects(adapter.executeWithTrustedRegistrar({
  input:f.args,approvalToken:'approved',capabilities:f.capabilities
 }),/signed_consumed_l4_required/);
 await assert.rejects(adapter.executeWithTrustedRegistrar({
  input:f.args,approvalToken:'X'.repeat(150),capabilities:f.capabilities
 }));
 assert.equal(f.calls.install,0);
 assert.equal(f.calls.audit,0);
 assert.equal(f.calls.rollback,0);
});
test('no CLI installation endpoint exists',()=>{
 const filename=path.join(__dirname,'../ops/agent3-universal-backup/trusted-registration-adapter.cjs');
 const out=cp.spawnSync(process.execPath,[filename,'--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(out.status,78);
 assert.match(out.stderr,/no standalone apply/);
});
