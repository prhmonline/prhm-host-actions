'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const PLAN=require('./prhm-action-registry-v2-bootstrap-transaction-plan-v1.cjs');
const WAL=require('./prhm-action-registry-v2-bootstrap-wal-v1.cjs');
const LOCK=require('./prhm-action-registry-v2-bootstrap-exclusive-lock-v1.cjs');
const LAB=require('./prhm-action-registry-v2-bootstrap-real-fs-lab-v1.cjs');
const REC=require('./prhm-action-registry-v2-bootstrap-lab-recovery-v1.cjs');
const STAGE=require('./manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json');
const REQUEST='12345678-1234-4234-8234-123456789abc';
let immutable;
function fixture(){
 if(!immutable){
  const data={};
  for(const f of STAGE.files){
   const p=cp.spawnSync('git',['show',f.source_commit+':'+f.source_path],
    {cwd:__dirname,timeout:20000,maxBuffer:5000000});
   assert.equal(p.status,0,'Git pinned blob not available: '+f.source_path);
   data[f.destination]=p.stdout;
  }
  const bundles=Object.fromEntries(STAGE.files.map(f=>[f.source_path,data[f.destination]]));
  const plan=PLAN.immutablePlan();
  const observed={owners:{},directories:{},files:{},journal_absent:true,socket_absent:true};
  for(const [k,v] of Object.entries(plan.protected_owners))observed.owners[k]=v.sha256;
  for(const dir of plan.dirs)observed.directories[dir.path]='absent';
  for(const f of plan.files)observed.files[f.path]='absent';
  const proposal=PLAN.proposal({
   request_id:REQUEST,bundle:PLAN.attestBundle(bundles),observed
  });
  assert.equal(proposal.operation_count,30);
  immutable={data,proposal};
 }
 const root=fs.mkdtempSync(path.join(os.tmpdir(),LAB.PREFIX));
 fs.chmodSync(root,0o700);
 const planned=new Set(immutable.proposal.operations
  .filter(x=>x.kind==='mkdir').map(x=>x.path));
 const anc=new Set();
 const targets=[...immutable.proposal.operations.map(x=>x.path),LOCK.LOCK,WAL.JPATH];
 for(const dest of targets){
  let p=path.posix.dirname(dest);
  while(p!=='/'&&!anc.has(p)){
   if(!planned.has(p)&&![...planned].some(x=>p.startsWith(x+'/')))
    anc.add(p);
   p=path.posix.dirname(p);
  }
 }
 for(const p of [...anc].sort((a,b)=>a.split('/').length-b.split('/').length)){
  const dest=LAB.mapped(root,p);
  if(!fs.existsSync(dest))fs.mkdirSync(dest,{mode:0o700});
 }
 return {
  ...immutable,root,
  cleanup:()=>fs.rmSync(root,{force:true,recursive:true}),
  runner:()=>LAB.createLab({root,proposal:immutable.proposal,pinnedBytes:immutable.data}),
  recover:()=>REC.createLabRecovery({root,proposal:immutable.proposal})
 };
}
test('actual 30-operation real filesystem lab installation fully undone, evidence retained',()=>{
 const f=fixture();
 try{
  const run=f.runner();run.begin();
  for(let i=0;i<f.proposal.operation_count;i++)run.step(i);
  const undo=f.recover(),preview=undo.preview();
  assert.equal(preview.count,30);
  assert.equal(preview.authorized,false);
  const proof=undo.rollback();
  assert.equal(proof.result,'ISOLATED_LAB_ROLLBACK_VERIFIED');
  assert.equal(proof.reversed_steps,30);
  for(const op of f.proposal.operations)
   assert.equal(fs.existsSync(LAB.mapped(f.root,op.path)),false);
  assert.equal(fs.existsSync(LAB.mapped(f.root,LOCK.LOCK)),true);
  assert.equal(fs.existsSync(LAB.mapped(f.root,WAL.JPATH)),true);
  const log=fs.readFileSync(LAB.mapped(f.root,REC.RECOVERY_PATH),'utf8')
   .trim().split('\n').map(JSON.parse);
  assert.equal(log.length,1+30*2+1);
  assert.equal(log[0].kind,'start');
  assert.equal(log.at(-1).kind,'complete');
  assert.equal(log.at(-1).original_lock_preserved,true);
  assert.throws(()=>undo.rollback(),/recovery_session_used/);
  assert.throws(()=>f.recover().preview(),/existing_recovery_requires_independent_review/);
  assert.throws(()=>f.runner().begin(),/EEXIST/);
 }finally{f.cleanup()}
});
test('known durable WAL prefix can be undone, without touching missing later steps',()=>{
 const f=fixture();
 try{
  const runner=f.runner();runner.begin();
  for(let i=0;i<14;i++)runner.step(i);
  const p=f.recover().preview();
  assert.equal(p.count,14);
  const r=f.recover().rollback();
  assert.equal(r.reversed_steps,14);
  for(const op of f.proposal.operations)
   assert.equal(fs.existsSync(LAB.mapped(f.root,op.path)),false);
 }finally{f.cleanup()}
});
test('unmatched forward WAL intent prohibits automatic rollback',()=>{
 const f=fixture();
 try{
  const r=f.runner();r.begin();
  assert.throws(()=>r.step(0,{afterIntent(){throw Error('simulated_power_loss')}}),
   /simulated_power_loss/);
  assert.throws(()=>f.recover().preview(),
   /forward_journal_indeterminate_or_empty/);
  assert.equal(fs.existsSync(LAB.mapped(f.root,REC.RECOVERY_PATH)),false);
  assert.equal(fs.existsSync(LAB.mapped(f.root,LOCK.LOCK)),true);
 }finally{f.cleanup()}
});
test('tampered created file and unrecorded writes reject before any deletion',()=>{
 const f=fixture();
 try{
  const runner=f.runner();runner.begin();
  for(let i=0;i<11;i++)runner.step(i);
  const file=f.proposal.operations[10],dest=LAB.mapped(f.root,file.path);
  fs.writeFileSync(dest,'malicious modification');
  assert.throws(()=>f.recover().preview(),/file_bytes_or_digest_drift/);
  assert.equal(fs.existsSync(LAB.mapped(f.root,REC.RECOVERY_PATH)),false);
  fs.writeFileSync(dest,f.data[file.path]);
  const future=f.proposal.operations[11],out=LAB.mapped(f.root,future.path);
  fs.writeFileSync(out,'unrecorded', {mode:0o600});
  assert.throws(()=>f.recover().preview(),/unrecorded_write_requires_manual_review/);
  assert.equal(fs.existsSync(LAB.mapped(f.root,REC.RECOVERY_PATH)),false);
 }finally{f.cleanup()}
});
test('foreign nested file prevents rollback without mutating stage',()=>{
 const f=fixture();
 try{
  const runner=f.runner();runner.begin();
  for(let i=0;i<11;i++)runner.step(i);
  const created=f.proposal.operations.find(x=>x.kind==='mkdir');
  fs.writeFileSync(path.join(LAB.mapped(f.root,created.path),'foreign.txt'),
   'foreign', {mode:0o600});
  assert.throws(()=>f.recover().preview(),/foreign_child_inside_stage_directory/);
  assert.equal(fs.existsSync(LAB.mapped(f.root,REC.RECOVERY_PATH)),false);
  assert.equal(fs.existsSync(LAB.mapped(f.root,f.proposal.operations[10].path)),true);
 }finally{f.cleanup()}
});
test('uncertain rollback after logged intent does not auto-resume or unlink evidence',()=>{
 const f=fixture();
 try{
  const run=f.runner();run.begin();for(let i=0;i<11;i++)run.step(i);
  const victim=f.proposal.operations[10],dest=LAB.mapped(f.root,victim.path);
  assert.throws(()=>f.recover().rollback({
   afterIntent(){throw Error('injected_crash_before_unlink')}
  }),/injected_crash_before_unlink/);
  assert.equal(fs.existsSync(dest),true);
  assert.equal(fs.existsSync(LAB.mapped(f.root,LOCK.LOCK)),true);
  assert.throws(()=>f.recover().rollback(),/existing_recovery_requires_independent_review/);
  const audit=fs.readFileSync(LAB.mapped(f.root,REC.RECOVERY_PATH),'utf8');
  assert.match(audit,/"kind":"intent"/);
  assert.doesNotMatch(audit,/"kind":"done"/);
 }finally{f.cleanup()}
});
test('uncertain rollback after physical unlink cannot be replayed',()=>{
 const f=fixture();
 try{
  const run=f.runner();run.begin();for(let i=0;i<11;i++)run.step(i);
  const victim=f.proposal.operations[10],dest=LAB.mapped(f.root,victim.path);
  assert.throws(()=>f.recover().rollback({
   afterPhysical(){throw Error('injected_crash_after_unlink')}
  }),/injected_crash_after_unlink/);
  assert.equal(fs.existsSync(dest),false);
  assert.throws(()=>f.recover().preview(),/existing_recovery_requires_independent_review/);
  assert.equal(fs.existsSync(LAB.mapped(f.root,LOCK.LOCK)),true);
 }finally{f.cleanup()}
});
test('root rollback lab never accepts actual /opt, /root or /tmp ancestor',()=>{
 const proposal=PLAN.immutablePlan();
 for(const root of ['/opt','/root','/tmp','/var/lib']){
  assert.throws(()=>REC.createLabRecovery({root,proposal}),/non_lab_root_denied/);
 }
 assert.deepEqual(Object.keys(REC).sort(),
  ['RECOVERY_PATH','createLabRecovery'].sort());
});
