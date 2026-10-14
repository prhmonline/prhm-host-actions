'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const C=require('./prhm-action-registry-v2-durable-recovery-v1.cjs');
const ASSET='/opt/prhm-agent-selfmaint-exec/actions/honartik-synthetic.cjs';
function fixture(){
 const original={},current={},pins={},backup={},owners={},assets={};
 for(const key of C.OWNER_KEYS){
   const pre=Buffer.from('reviewed '+key+' original bytes');
   const next=Buffer.from('reviewed '+key+' installed bytes');
   original[key]=pre;backup[key]=pre;
   const uid=key==='mcp'?1000:0,gid=uid,mode=0o640;
   pins[key]={path:G.OWNER_PATHS[key],
    before_sha256:G.sha(pre),after_sha256:G.sha(next)};
   owners[key]={sha256:G.sha(pre),uid,gid,mode};
   current[key]={exists:true,regular:true,symlink:false,
    sha256:G.sha(next),uid,gid,mode};
 }
 const source_commit='a'.repeat(40),manifest_commit='b'.repeat(40);
 const manifest_sha256='c'.repeat(64);
 const normalized={project:'honartik',action:'honartik_config_center_readonly_enroll_v1',
  owners:pins,assets:[{path:ASSET,source_path:'honartik-synthetic.cjs',sha256:G.sha(Buffer.from('asset'))}]};
 const release={normalized,source_commit,manifest_commit,manifest_sha256};
 const snapshot={schema:'prhm.registry.recovery.v1',
  request_id:'148c965e-30ac-4131-988b-79e5390d880f',
  project:normalized.project,action:normalized.action,
  source_commit,manifest_commit,manifest_sha256,owners};
 assets[ASSET]={exists:true,regular:true,symlink:false,sha256:normalized.assets[0].sha256,
  uid:0,gid:0,mode:0o644};
 const live={owners:current,assets};
 let checks=0,writes=0,locks=0,audits=[];
 const callbacks={
  release,snapshot,readBackup:key=>backup[key],
  readLive:async()=>live,
  authorizeRecovery:async req=>req.request_id===snapshot.request_id&&req.action===G.ACTION,
  exclusiveLock:async()=>{locks++;return()=>locks--},
  restoreOwner:async step=>{writes++;assert.equal(G.sha(step.bytes),pins[step.key].before_sha256);
   current[step.key].sha256=step.sha256},
  removeAsset:async step=>{writes++;assets[step.path]={exists:false,regular:false,symlink:false,
    sha256:null,uid:null,gid:null,mode:null}},
  verifyOriginalState:async()=>{checks++;return C.OWNER_KEYS.every(k=>
    current[k].sha256===pins[k].before_sha256)&&assets[ASSET].exists===false},
  verifyServices:async()=>true,
  verifyTargetAbsent:async action=>action===normalized.action,
  audit:async rec=>audits.push(rec)
 };
 return {release,snapshot,backup,live,callbacks,stats:()=>({writes,locks,checks,audits})};
}
test('fresh process can reconstruct nine-path recovery from durable JSON and backup bytes',async()=>{
 const f=fixture();
 // Serialize the journal to emulate a process restart, retaining only persisted data.
 const restarted=JSON.parse(JSON.stringify(f.snapshot));
 const r=await C.reconcileFromDurableJournal({...f.callbacks,snapshot:restarted});
 assert.equal(r.ok,true);assert.equal(r.steps,5);
 assert.equal(f.stats().writes,5);assert.equal(f.stats().locks,0);
 assert.equal(f.stats().checks,1);assert.equal(f.stats().audits[0].verified,true);
 // Restart again: no writes; idempotent (but still rechecks service health).
 const second=await C.reconcileFromDurableJournal({...f.callbacks,snapshot:restarted});
 assert.equal(second.steps,0);assert.equal(f.stats().writes,5);
});
test('all release owners and exact asset paths must be preflight-verified',()=>{
 const f=fixture();
 const plan=C.recoveryPlan({release:f.release,snapshot:f.snapshot,live:f.live,
  readBackup:f.callbacks.readBackup});
 assert.equal(plan.steps.length,5);assert.equal(plan.request_id,f.snapshot.request_id);
 assert.equal(plan.steps.filter(x=>x.kind==='restore_owner').length,4);
});
test('tampered durable backup fails BEFORE any mutation',async()=>{
 const f=fixture();f.backup.base=Buffer.from('malicious');
 await assert.rejects(C.reconcileFromDurableJournal(f.callbacks),
  /durable_backup_sha_base/);
 assert.equal(f.stats().writes,0);
});
test('unexpected owner, symlink or asset state fails closed before mutation',async()=>{
 for(const field of ['owner_hash','owner_symlink','asset_mode','asset_hash']){
  const f=fixture();
  if(field==='owner_hash')f.live.owners.base.sha256='f'.repeat(64);
  if(field==='owner_symlink')f.live.owners.mcp.symlink=true;
  if(field==='asset_mode')f.live.assets[ASSET].mode=0o777;
  if(field==='asset_hash')f.live.assets[ASSET].sha256='e'.repeat(64);
  await assert.rejects(C.reconcileFromDurableJournal(f.callbacks),
   /owner_drift|asset_drift/);
  assert.equal(f.stats().writes,0,field);
 }
});
test('a different project, manifest SHA or request ID cannot use persisted state',async()=>{
 for(const kind of ['project','manifest','request']){
  const f=fixture();
  const snapshot=JSON.parse(JSON.stringify(f.snapshot));
  if(kind==='project')snapshot.project='moeinshow';
  if(kind==='manifest')snapshot.manifest_sha256='9'.repeat(64);
  if(kind==='request')snapshot.request_id='bad';
  await assert.rejects(C.reconcileFromDurableJournal({...f.callbacks,snapshot}),
   /journal_release_binding|consumed_approval_binding_missing/);
  assert.equal(f.stats().writes,0);
 }
});
test('missing consumed proof prohibits rollback and lock acquisition',async()=>{
 const f=fixture();let locked=false;
 await assert.rejects(C.reconcileFromDurableJournal({...f.callbacks,
  authorizeRecovery:async()=>false,exclusiveLock:async()=>{locked=true;return()=>{}}}),
  /consumed_approval_binding_missing/);
 assert.equal(locked,false);assert.equal(f.stats().writes,0);
});
test('unhealthy service cannot produce restored success, even after file restore',async()=>{
 const f=fixture();
 await assert.rejects(C.reconcileFromDurableJournal({...f.callbacks,
  verifyServices:async()=>false}),/services_unhealthy/);
 assert.equal(f.stats().audits.length,0);
 assert.equal(f.stats().locks,0);
});
test('unexpected callback capabilities reject preflight before side effects',async()=>{
 const f=fixture();
 await assert.rejects(C.reconcileFromDurableJournal({...f.callbacks,
  verifyOriginalState:null}),/trusted_callback_missing_verifyOriginalState/);
 assert.equal(f.stats().writes,0);
});

test('MCP still advertising target after recovery forbids verified audit',async()=>{
 const f=fixture();
 let discovery=0;
 const callbacks={...f.callbacks,verifyTargetAbsent:async action=>{
  discovery++;assert.equal(action,f.release.normalized.action);return false;
 }};
 await assert.rejects(C.reconcileFromDurableJournal(callbacks),
   /target_mcp_tool_still_visible_or_unverified/);
 assert.equal(discovery,1);
 assert.equal(f.stats().writes,5);
 assert.equal(f.stats().audits.length,0);
 assert.equal(f.stats().locks,0);
});
test('unreachable MCP discovery or unknown status cannot mark recovery completed',async()=>{
 for(const check of [async()=>{throw Error('mcp_worker_timeout')},async()=>null]){
  const f=fixture();
  await assert.rejects(C.reconcileFromDurableJournal({
    ...f.callbacks,verifyTargetAbsent:check
  }));
  assert.equal(f.stats().audits.length,0);
  assert.equal(f.stats().locks,0);
 }
});
test('missing negative discovery capability blocks before lock or any file writes',async()=>{
 const f=fixture();
 await assert.rejects(C.reconcileFromDurableJournal({
  ...f.callbacks,verifyTargetAbsent:undefined
 }),/trusted_callback_missing_verifyTargetAbsent/);
 assert.equal(f.stats().writes,0);
 assert.equal(f.stats().audits.length,0);
});
test('both healthy services and negative MCP discovery are required, in order',async()=>{
 const f=fixture(),sequence=[];
 const result=await C.reconcileFromDurableJournal({
  ...f.callbacks,
  verifyServices:async()=>{sequence.push('services');return true;},
  verifyTargetAbsent:async action=>{
   assert.equal(action,f.release.normalized.action);
   sequence.push('not_visible');return true;
  },
  audit:async()=>sequence.push('audit')
 });
 assert.equal(result.verified,true);
 assert.deepEqual(sequence,['services','not_visible','audit']);
});
