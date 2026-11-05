'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const C=require('./prhm-action-registry-v2-durable-recovery-locksafe-v1.cjs');
const ASSET='/opt/prhm-agent-selfmaint-exec/actions/honartik-fixed-locksafe-test.cjs';
const REQUEST='148c965e-30ac-4131-988b-79e5390d880f';
function setup(options={}){
 const owners={},backs={},liveOwners={},assets={};
 for(const key of C.OWNER_KEYS){
  const first=Buffer.from('signed original '+key);
  const next=Buffer.from('new installed '+key);
  const sha0=G.sha(first),sha1=G.sha(next);
  backs[key]=first;
  owners[key]={path:G.OWNER_PATHS[key],before_sha256:sha0,after_sha256:sha1};
  liveOwners[key]={exists:true,regular:true,symlink:false,
   sha256:sha1,uid:0,gid:0,mode:0o640};
 }
 const release={source_commit:'a'.repeat(40),manifest_commit:'b'.repeat(40),
  manifest_sha256:'c'.repeat(64),normalized:{
   project:'honartik',action:'honartik_config_center_readonly_enroll_v1',
   owners,assets:[{path:ASSET,source_path:'one.cjs',
    sha256:G.sha(Buffer.from('asset bytes'))}]}};
 const snapshot={schema:'prhm.registry.recovery.v1',request_id:REQUEST,
  project:'honartik',action:release.normalized.action,
  source_commit:release.source_commit,
  manifest_commit:release.manifest_commit,
  manifest_sha256:release.manifest_sha256,
  owners:Object.fromEntries(C.OWNER_KEYS.map(k=>[k,{
   sha256:owners[k].before_sha256,uid:0,gid:0,mode:0o640}]))};
 assets[ASSET]={exists:true,regular:true,symlink:false,
  sha256:release.normalized.assets[0].sha256,
  uid:0,gid:0,mode:0o644};
 let lockCreated=false,unlockCalls=0,writes=0,audits=0,discovery=0;
 const callbacks={
  release,snapshot,readBackup:k=>backs[k],
  readLive:async()=>({owners:liveOwners,assets}),
  authorizeRecovery:async()=>true,
  exclusiveLock:async()=>{
   assert.equal(lockCreated,false,'unexpected reentrant lock');
   lockCreated=true;
   return async()=>{unlockCalls++;lockCreated=false}
  },
  restoreOwner:async step=>{writes++;liveOwners[step.key].sha256=step.sha256},
  removeAsset:async step=>{
   writes++;assets[step.path]={exists:false,regular:false,symlink:false,
    sha256:null,uid:null,gid:null,mode:null}
  },
  verifyOriginalState:async()=>true,
  verifyServices:async()=>options.health!==false,
  verifyTargetAbsent:async()=>{
   discovery++;return options.absent!==false
  },
  audit:async()=>{
   audits++;
   if(options.auditThrows)throw Error('durable_audit_unavailable')
  }
 };
 return {callbacks,backs,liveOwners,
  state:()=>({lockCreated,unlockCalls,writes,audits,discovery})};
}
test('complete verified recovery fsync callback unlocks only after audit and two-worker absence',async()=>{
 const f=setup();
 const result=await C.reconcileFromDurableJournal(f.callbacks);
 assert.equal(result.verified,true);
 assert.equal(result.steps,5);
 assert.deepEqual(f.state(),{
  lockCreated:false,unlockCalls:1,writes:5,audits:1,discovery:1
 });
});
test('MCP still advertising target after filesystem restore retains durable exclusive lock',async()=>{
 const f=setup({absent:false});
 await assert.rejects(C.reconcileFromDurableJournal(f.callbacks),
  /target_mcp_tool_still_visible_or_unverified/);
 assert.deepEqual(f.state(),{
  lockCreated:true,unlockCalls:0,writes:5,audits:0,discovery:1
 });
});
test('unhealthy service after recovery never unlocks to allow unsafe replay',async()=>{
 const f=setup({health:false});
 await assert.rejects(C.reconcileFromDurableJournal(f.callbacks),
  /services_unhealthy/);
 assert.equal(f.state().lockCreated,true);
 assert.equal(f.state().unlockCalls,0);
 assert.equal(f.state().audits,0);
});
test('missing durable audit retains lock even after original bytes and negative discovery',async()=>{
 const f=setup({auditThrows:true});
 await assert.rejects(C.reconcileFromDurableJournal(f.callbacks),
  /durable_audit_unavailable/);
 assert.equal(f.state().writes,5);
 assert.equal(f.state().discovery,1);
 assert.equal(f.state().lockCreated,true);
 assert.equal(f.state().unlockCalls,0);
});
test('invalid backup before restore also retains lock for independent operator decision',async()=>{
 const f=setup();
 f.backs.base=Buffer.from('wrong');
 await assert.rejects(C.reconcileFromDurableJournal(f.callbacks),
  /durable_backup_sha_base/);
 assert.equal(f.state().lockCreated,true);
 assert.equal(f.state().unlockCalls,0);
 assert.equal(f.state().writes,0);
});
