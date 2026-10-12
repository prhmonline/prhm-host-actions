'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const zlib=require('node:zlib');
const path=require('node:path');
const C=require('./leadops-policy-sync-candidate-v1.cjs');
const CANON=fs.readFileSync(C.CANON_FILE);
const fixture=fs.readFileSync(path.join(__dirname,'tests/fixtures/leadops-live-policy-20261012.json.gz.b64'),'utf8').trim();
const LIVE=zlib.gunzipSync(Buffer.from(fixture,'base64'));
function build(){return C.getPlan({livePolicy:LIVE,mediatorSha256:C.MEDIATOR_SHA,canonical:CANON});}
function replaceJson(buffer,fn){const j=JSON.parse(buffer.toString());fn(j);return Buffer.from(JSON.stringify(j,null,2)+'\n');}
function mock(overrides={}){
 const files=new Map([[C.TARGET,Buffer.from(LIVE)]]);
 let mediatorHash=C.MEDIATOR_SHA,authorization=true,commit=true,symlink=false;
 let changed=false,backup=null,unlock=0,writes=0,rollback=0,reloads=0,failPoint=null;
 const audits=[];
 const adapter={
  async assertConsumedSignedLevel4({operation,level}) {
    assert.equal(operation,C.OPERATION);assert.equal(level,4);
    return authorization?{signed:true,consumed:true,one_time:true,level:4,
      operation:C.OPERATION,approver:'mohammad',request_id:'128dea0a-351d-4d77-9ab8-2608d9311e0c'}:
      {signed:false};
  },
  async assertReviewedCommit(sha){assert.equal(sha,C.SOURCE_COMMIT);return commit;},
  async lock(){return ()=>{unlock++};},
  async fileState(p){
    if(p===C.MEDIATOR)return {regular:true,symlink:false,sha256:mediatorHash,uid:0,mode:0o640};
    return {regular:true,symlink,sha256:C.hash(files.get(p)),uid:0,gid:0,mode:0o644};
  },
  async readFile(p){assert.equal(p,C.TARGET);return Buffer.from(files.get(p));},
  async saveDurableBackup(p,b,{source_sha256}){
    assert.equal(p,C.TARGET);assert.equal(source_sha256,C.LIVE_SHA);
    backup=Buffer.from(b);return {durable:true,sha256:C.hash(backup)};
  },
  async atomicReplace(p,b,{expected_before_sha256,expected_after_sha256}){
    assert.equal(p,C.TARGET);assert.equal(expected_before_sha256,C.LIVE_SHA);
    assert.equal(expected_after_sha256,C.hash(b));
    writes++;files.set(p,Buffer.from(b));changed=true;
    if(failPoint==='write')throw Error('simulated_partial_write');
  },
  async reloadAndHealth(){
    reloads++;
    if(failPoint==='reload'&&changed)throw Error('simulated_reload_failure');
  },
  async restoreBackup(p,b){
    rollback++;assert.equal(p,C.TARGET);assert.equal(b.durable,true);
    assert.equal(b.sha256,C.hash(backup));files.set(p,Buffer.from(backup));
    changed=false;
  },
  async recordAudit(v){audits.push(v);if(failPoint==='audit'&&v.ok)throw Error('simulated_audit_failure');}
 };
 return {adapter,files,audits,setFail:x=>{failPoint=x;},
  setAuth:x=>{authorization=x;},setCommit:x=>{commit=x;},
  setMediator:x=>{mediatorHash=x;},setSymlink:x=>{symlink=x;},
  metrics:()=>({unlock,writes,rollback,reloads,hasBackup:!!backup})};
}
test('canonical source and live policy are pinned byte-for-byte',()=>{
 assert.equal(C.blob(CANON),C.CANON_BLOB);
 assert.equal(C.hash(LIVE),C.LIVE_SHA);
 const p=build();
 assert.equal(p.action,C.ACTION);assert.equal(p.operations,75);assert.equal(p.scopes,52);
 assert.equal(p.production_mutation_authorized,false);
 assert.deepEqual(p.only_change,['version','deployment_integrity']);
});
test('only policy version and deployment integrity may change',()=>{
 assert.deepEqual(C.verifyPolicySemantics(LIVE,CANON),
   {operations:75,scopes:52,only_change:['version','deployment_integrity']});
 for(const edit of [
   p=>{p.operations['host_action.control_plane_installer_refresh_root_stage_v1'].level=3;},
   p=>{p.typed_scopes[0].risk='critical';},
   p=>{p.scope_freeze=false;},
   p=>{p.levels['4'].human_approval=false;}
 ]){
   const changed=replaceJson(CANON,edit);
   assert.throws(()=>C.verifyPolicySemantics(LIVE,changed),
     /policy_semantic_grant_difference|approval_guards_invalid/);
 }
 const weakened=replaceJson(CANON,p=>{p.deployment_integrity.git_first_required=false});
 assert.throws(()=>C.verifyPolicySemantics(LIVE,weakened),/git_first_integrity_invalid/);
 const unsafe=replaceJson(CANON,p=>{
   p.operations['host_action.leadops_backup_role_provision_v1']={level:4};
 });
 assert.throws(()=>C.verifyPolicySemantics(LIVE,unsafe),/canonical_scope_count_mismatch/);
});
test('bad preimages or unsigned approvals fail before writes',async()=>{
 assert.throws(()=>C.getPlan({livePolicy:Buffer.from('fake'),
    mediatorSha256:C.MEDIATOR_SHA,canonical:CANON}),/live_policy_sha_drift/);
 assert.throws(()=>C.getPlan({livePolicy:LIVE,
    mediatorSha256:'f'.repeat(64),canonical:CANON}),/mediator_sha_drift/);
 assert.throws(()=>C.getPlan({livePolicy:LIVE,
    mediatorSha256:C.MEDIATOR_SHA,canonical:Buffer.from('altered')}),/canonical_git_blob_mismatch/);
 const plan=build();
 for(const scenario of ['authorization','source','symlink','mediator']){
   const m=mock();
   if(scenario==='authorization')m.setAuth(false);
   if(scenario==='source')m.setCommit(false);
   if(scenario==='symlink')m.setSymlink(true);
   if(scenario==='mediator')m.setMediator('f'.repeat(64));
   await assert.rejects(C.applyPrepared(plan,m.adapter),/level4_approval_not_verified|source_commit_not_verified|live_policy_preimage_drift|live_mediator_preimage_drift/);
   assert.deepEqual(m.files.get(C.TARGET),LIVE);
   assert.equal(m.metrics().writes,0);
 }
});
test('signed and verified one-file deployment changes no Mediator or database role',async()=>{
 const m=mock();
 const result=await C.applyPrepared(build(),m.adapter);
 assert.equal(result.ok,true);
 assert.deepEqual(result.changed_paths,[C.TARGET]);
 assert.equal(result.role_created,false);
 assert.equal(result.outbox_changed,false);
 assert.equal(result.rollback_performed,false);
 assert.equal(C.hash(m.files.get(C.TARGET)),C.hash(CANON));
 assert.equal(m.metrics().writes,1);
 assert.equal(m.metrics().rollback,0);
 assert.equal(m.metrics().unlock,1);
 assert.equal(m.audits.at(-1).ok,true);
});
test('partial write, service reload failure and audit failure all restore exact preimage',async()=>{
 for(const failPoint of ['write','reload','audit']){
   const m=mock();m.setFail(failPoint);
   await assert.rejects(C.applyPrepared(build(),m.adapter),/policy_sync_failed/);
   assert.deepEqual(m.files.get(C.TARGET),LIVE);
   assert.equal(m.metrics().rollback,1);
   assert.equal(m.metrics().unlock,1);
   assert.equal(m.audits.at(-1).rollback_performed,true);
 }
});
test('a changed Mediator SHA after writing policy forces rollback',async()=>{
 const m=mock();
 const orig=m.adapter.atomicReplace;
 m.adapter.atomicReplace=async(...args)=>{await orig(...args);m.setMediator('f'.repeat(64));};
 await assert.rejects(C.applyPrepared(build(),m.adapter),/policy_sync_failed:mediator_modified_during_sync/);
 assert.deepEqual(m.files.get(C.TARGET),LIVE);
 assert.equal(m.metrics().rollback,1);
});
test('no CLI, service or Production mutation surface is exposed by candidate',()=>{
 assert.equal(typeof C.applyPrepared,'function');
 assert.equal(C.TARGET,'/opt/prhm-company-control-plane/config/approval-policy.json');
 assert.equal(C.MEDIATOR.includes('root-scripts-stage-mediator'),true);
 assert.equal(Object.prototype.hasOwnProperty.call(C,'install'),false);
});
