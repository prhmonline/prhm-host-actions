'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const d=require('../ops/agent3-universal-backup/trusted-shared-registrar-dispatch.cjs');
const registration=require('../ops/agent3-universal-backup/registration-contract.cjs');
const gateway=require('../prhm-action-registry-gateway-v1.cjs');
const pins=require('../ops/agent3-universal-backup/production-registration-contract.json');
const lock=require('../ops/agent3-universal-backup/release-lock.json');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function manifest(){
 return {
  schema_version:'prhm.action-registry.release.v1',
  project:'agent3',
  action:'agent3_universal_backup_engine_install_v1',
  source_commit:registration.SOURCE_COMMIT,
  risk:'critical',approval_level:4,rollback_required:true,
  git_path:registration.EXPECTED_MANIFEST_PATH,
  registry_owners:Object.fromEntries(d.OWNERS.map(k=>[k,{
   path:gateway.OWNER_PATHS[k],
   before_sha256:pins.preimage_sha256[k],
   after_sha256:sha('AFTER:'+k)
  }])),
  assets:[{path:d.DEST,source_path:d.SOURCE,sha256:lock.expected_sha256[d.SOURCE]}],
  health:{
   services:['prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service',
             'prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service'],
   tool:'agent3_universal_backup_engine_install_v1'
  }
 };
}
const bytes=m=>Buffer.from(JSON.stringify(m,null,2)+'\n');
function args(m=manifest()){
 const b=bytes(m);
 return {action:'prhm_action_registry_install_v1',project:'agent3',
  source_commit:registration.SOURCE_COMMIT,manifest_commit:'b'.repeat(40),
  manifest_sha256:sha(b)};
}
test('only pinned Agent 3 manifest, four live owner preimages and immutable Git source are allowed',()=>{
 const b=bytes(manifest());
 const r=d.assertFixedManifest(b,registration.EXPECTED_MANIFEST_PATH);
 assert.equal(r.staged_installer_sha256,lock.expected_sha256[d.SOURCE]);
 assert.equal(r.owner_count,4);
 assert.equal(r.installed,false);
 assert.equal(r.authorization_consumed,false);
});
test('alternate binary, extra asset, wrong digest and another project are rejected',()=>{
 for(const change of [
  m=>{m.assets[0].source_path='evil.js';},
  m=>{m.assets[0].path='/opt/prhm-agent-selfmaint-exec/actions/swap.cjs';},
  m=>{m.assets[0].sha256='a'.repeat(64);},
  m=>{m.assets.push({...m.assets[0],path:'/opt/prhm-agent-selfmaint-exec/actions/evil.cjs'});},
  m=>{m.project='honartik';},
  m=>{m.action='honartik_config_center_readonly_enroll_v1';},
  m=>{m.registry_owners.base.before_sha256='a'.repeat(64);},
  m=>{m.registry_owners.executor.path='/etc/shadow';}
 ]){
  const m=manifest();change(m);
  assert.throws(()=>d.assertFixedManifest(bytes(m),registration.EXPECTED_MANIFEST_PATH));
 }
 assert.throws(()=>d.assertFixedManifest(bytes(manifest()),'other.json'),/unbound_manifest_path_or_bytes/);
});
test('action-only requests, incorrect SHA and caller-injected fields fail before any root access',async()=>{
 let called=0;
 const root=new Proxy({}, {get(){called++;throw Error('untrusted root invoked')}});
 for(const input of [
  {action:'prhm_action_registry_install_v1'},
  {...args(),command:'curl https://evil.invalid'},
  {...args(),project:'honartik'},
  {...args(),source_commit:'0'.repeat(40)},
  {...args(),manifest_sha256:'bad'}
 ]){
  await assert.rejects(d.dispatch({input,approvalToken:'x'.repeat(500),rootCapabilities:root}));
 }
 assert.equal(called,0);
});
test('boolean approval, missing root adapters and malformed signed receipts cannot execute',async()=>{
 const input=args();
 await assert.rejects(d.dispatch({input,approvalToken:'approved',rootCapabilities:{}}),
   /signed_approval_required/);
 await assert.rejects(d.dispatch({input,approvalToken:'x'.repeat(140),rootCapabilities:{}}),
   /trusted_capability_missing/);
});
test('trusted dispatcher independently rechecks owner SHA and refuses to install on drift',async()=>{
 const m=manifest(),b=bytes(m),input=args(m);
 let installs=0,queryCount=0;
 const root={
  readPinnedGitManifest(query){queryCount++;return {path:m.git_path,bytes:b};},
  readPinnedGitSource(){throw Error('should not read source until owner SHA verified')},
  readLiveOwner(){return Buffer.from('owner sha drift');},
  readStagedAsset(){return fs.readFileSync(path.join(__dirname,'../ops/agent3-universal-backup/install-candidate.js'))},
  getInstaller(){installs++;return async()=>{throw Error('NOT ALLOWED')}},
  getRollback(){return async()=>({verified:true})},
  verifyOriginalState:async()=>true,
  getToolDiscovery:async()=>true,
  writeMetadataAudit:async()=>{},
  claimExecutionOnce:async()=>{throw Error('must never claim when owner SHA drifts');}
 };
 await assert.rejects(d.dispatch({input,approvalToken:'x'.repeat(140),rootCapabilities:root}),
   /owner_sha_drift/);
 assert.equal(queryCount,1);
 assert.equal(installs,0);
});
test('no CLI apply, separate signing route, or generic root command',()=>{
 const file=path.join(__dirname,'../ops/agent3-universal-backup/trusted-shared-registrar-dispatch.cjs');
 const a=cp.spawnSync(process.execPath,[file,'--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(a.status,78);
 assert.match(a.stderr,/No CLI/);
 assert.equal(Object.hasOwn(d,'exec'),false);
 assert.equal(Object.hasOwn(d,'issueApproval'),false);
 assert.equal(Object.hasOwn(d,'installDirect'),false);
});

test('canonical adapter exposes exactly nine allowlisted root capabilities, no arbitrary executor',()=>{
 const input=args();
 let called=0;
 const root={
  readPinnedGitManifest(){called++;return {path:'bad',bytes:Buffer.from('bad')};},
  readPinnedGitSource(){called++;return Buffer.from('fixture');},
  readLiveOwner(){called++;return Buffer.from('fixture');},
  readStagedAsset(){called++;return Buffer.from('fixture');},
  getInstaller(){called++;return ()=>{};},
  getRollback(){called++;return ()=>{};},
  verifyOriginalState(){called++;return true;},
  getToolDiscovery(){called++;return true;},
  writeMetadataAudit(){called++;return true;},
  claimExecutionOnce(){called++;return {claimed:true};},
  arbitraryShell(){called++;return true;}
 };
 const c=d.boundRootCapabilities(input,root);
 assert.deepEqual(Object.keys(c).sort(),[
  'readPinnedGitManifest','readPinnedGitSource','readLiveOwner','readStagedAsset',
  'getInstaller','getRollback','verifyOriginalState','getToolDiscovery',
  'writeMetadataAudit'].sort());
 assert.equal(Object.hasOwn(c,'arbitraryShell'),false);
 const wrongManifest={repo:registration.EXPECTED_GIT_REPO,source_commit:registration.SOURCE_COMMIT,
   manifest_commit:'c'.repeat(40),project:'agent3'};
 assert.throws(()=>c.readPinnedGitManifest(wrongManifest),/untrusted_manifest_query/);
 assert.throws(()=>c.readPinnedGitSource({repo:registration.EXPECTED_GIT_REPO,
   source_commit:registration.SOURCE_COMMIT,source_path:'evil.cjs'}),/untrusted_git_source/);
 assert.throws(()=>c.readLiveOwner('/etc/shadow'),/untrusted_owner_path/);
 assert.throws(()=>c.readStagedAsset('/tmp/evil.cjs'),/untrusted_asset_destination/);
 assert.throws(()=>c.getInstaller('host_action_v2_installer_v1'),/untrusted_installer_dispatch/);
 assert.throws(()=>c.getRollback('other'),/untrusted_rollback_dispatch/);
 assert.throws(()=>c.getToolDiscovery('other'),/untrusted_discovery/);
 assert.throws(()=>c.verifyOriginalState({normalized:{action:registration.INSTALL_ACTION,
   project:'honartik'},source_commit:registration.SOURCE_COMMIT}),/untrusted_rollback_evidence/);
 assert.throws(()=>c.writeMetadataAudit({project:'agent3',action:registration.INSTALL_ACTION,
   source_commit:'0'.repeat(40)}),/untrusted_audit_record/);
 assert.equal(called,0);
});
