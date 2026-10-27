'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const A=require('./prhm-registry-v2-bootstrap-authorization-boundary-v1.cjs');
const L=require('./prhm-registry-v2-36-bundle-fs-lab-v1.cjs');
let cached;
const REQUEST='12345678-1234-4234-8234-123456789abc';
function bytes(){
 if(cached)return cached;
 const spec=A.immutableCandidate();
 const out={};
 for(const item of spec.artifacts){
  const r=cp.spawnSync('git',['show',item.source_commit+':'+item.source_path],
   {cwd:__dirname,timeout:20000,maxBuffer:4500000});
  assert.equal(r.status,0,'missing pinned immutable Git blob '+item.source_path);
  assert.ok(r.stdout.length>0);
  out[item.destination]=r.stdout;
 }
 cached=out;return cached;
}
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),L.PREFIX));
 fs.chmodSync(root,0o700);
 const plan=L.proposalFor({requestId:REQUEST,bytes:bytes()});
 return {root,plan,make:()=>L.createLab({root,proposal:plan}),
  cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('36 exact immutable Git blob artifacts and dedicated unit are independently bound',()=>{
 const a=A.immutableCandidate();
 const p=L.proposalFor({requestId:REQUEST,bytes:bytes()});
 assert.equal(a.artifacts.length,36);
 assert.equal(p.stage_count,36);
 assert.equal(p.operations.length,38);
 assert.equal(p.operations.filter(s=>s.kind==='file').length,36);
 assert.equal(p.operations.at(-1).path,A.UNIT);
 assert.equal(p.operations[0].kind,'mkdir');
 assert.equal(p.operations[1].kind,'mkdir');
 assert.equal(p.authorized,false);
 assert.deepEqual(L.proposalFor({requestId:REQUEST,bytes:bytes()}).identity_sha256,
   p.identity_sha256);
 const bad={...bytes()};
 bad[A.UNIT]=Buffer.from('not the signed service unit');
 assert.throws(()=>L.proposalFor({requestId:REQUEST,bytes:bad}),
   /git_object_mismatch/);
 assert.throws(()=>L.proposalFor({requestId:REQUEST,bytes:{
  ...bytes(),'/opt/foreign':Buffer.from('x')
 }}),/exact_36_byte_set_required/);
});
test('real filesystem stages 35 runtime blobs plus systemd unit, then fully rolls back',()=>{
 const f=fixture();
 try {
  const lab=f.make();lab.begin();
  for(let i=0;i<lab.count;i++){
   const s=lab.step(i);
   assert.equal(s.completed,i+1);
   assert.equal(s.pending,null);
  }
  assert.equal(lab.count,38);
  const unit=L.mapped(f.root,A.UNIT);
  assert.deepEqual(fs.readFileSync(unit),bytes()[A.UNIT]);
  assert.equal(fs.statSync(unit).mode&0o777,0o600);
  const pre=lab.previewRecovery();
  assert.equal(pre.completed,38);
  const r=lab.rollback();
  assert.equal(r.result,'LAB_36_ROLLBACK_VERIFIED');
  assert.equal(r.reversed,38);
  assert.equal(r.production_changed,false);
  for(const op of f.plan.operations)
   assert.equal(fs.existsSync(L.mapped(f.root,op.path)),false);
  assert.ok(fs.existsSync(L.mapped(f.root,L.LOCK)));
  assert.ok(fs.existsSync(L.mapped(f.root,L.FORWARD)));
  assert.ok(fs.existsSync(L.mapped(f.root,L.UNDO)));
  const log=fs.readFileSync(L.mapped(f.root,L.UNDO),'utf8').trim()
   .split('\n').map(JSON.parse);
  assert.equal(log.length,1+38*2+1);
  assert.equal(log.at(-1).lock_preserved,true);
  assert.throws(()=>lab.rollback(),/undo_already_attempted/);
  assert.throws(()=>f.make().rollback(),/existing_undo/);
  assert.throws(()=>f.make().begin(),/preexisting_staged_or_journal|EEXIST/);
 } finally {f.cleanup()}
});
test('known WAL prefix rolls back exact created objects; later targets remain absent',()=>{
 const f=fixture();
 try{
  const lab=f.make();lab.begin();
  for(let i=0;i<19;i++)lab.step(i);
  assert.equal(f.make().previewRecovery().completed,19);
  const r=f.make().rollback();
  assert.equal(r.reversed,19);
  for(const op of f.plan.operations)
   assert.equal(fs.existsSync(L.mapped(f.root,op.path)),false);
 }finally{f.cleanup()}
});
test('pending forward intent after injected failure is terminal; rollback refused',()=>{
 const f=fixture();
 try{
  const lab=f.make();lab.begin();
  assert.throws(()=>lab.step(0,{afterIntent(){throw Error('power_cut')}}),/power_cut/);
  assert.equal(f.make().inspect().pending,0);
  assert.throws(()=>f.make().rollback(),/incomplete_forward_wal_or_existing_undo/);
  assert.ok(fs.existsSync(L.mapped(f.root,L.LOCK)));
  assert.equal(fs.existsSync(L.mapped(f.root,L.UNDO)),false);
 }finally{f.cleanup()}
});
test('physical stage write followed by injected crash is indeterminate and not re-run',()=>{
 const f=fixture();
 try{
  const lab=f.make();lab.begin();
  assert.throws(()=>lab.step(0,{
   afterPhysical(){throw Error('lost_after_mkdir')}
  }),/lost_after_mkdir/);
  assert.ok(fs.existsSync(L.mapped(f.root,A.ROOT)));
  assert.equal(f.make().inspect().pending,0);
  assert.throws(()=>f.make().rollback(),/incomplete_forward_wal_or_existing_undo/);
  assert.throws(()=>f.make().begin(),/preexisting_staged_or_journal|EEXIST/);
 }finally{f.cleanup()}
});
test('tampered staged bytes are detected before first rollback write',()=>{
 const f=fixture();
 try{
  const lab=f.make();lab.begin();
  for(let i=0;i<18;i++)lab.step(i);
  const op=f.plan.operations[17],file=L.mapped(f.root,op.path);
  assert.equal(op.kind,'file');
  fs.writeFileSync(file,'tampered data');
  assert.throws(()=>f.make().rollback(),/stage_bytes_or_git_drift/);
  assert.equal(fs.existsSync(L.mapped(f.root,L.UNDO)),false);
  assert.ok(fs.existsSync(file));
 }finally{f.cleanup()}
});
test('unexpected file below staged root prevents rollback',()=>{
 const f=fixture();
 try{
  const lab=f.make();lab.begin();
  for(let i=0;i<20;i++)lab.step(i);
  fs.writeFileSync(path.join(L.mapped(f.root,A.ROOT),'other.txt'),'unexpected',
   {mode:0o600});
  assert.throws(()=>f.make().rollback(),/foreign_staged_child/);
  assert.equal(fs.existsSync(L.mapped(f.root,L.UNDO)),false);
 }finally{f.cleanup()}
});
test('rollback crash after intent preserves lock and denies replay',()=>{
 const f=fixture();
 try{
  const lab=f.make();lab.begin();
  for(let i=0;i<20;i++)lab.step(i);
  assert.throws(()=>f.make().rollback({
   afterIntent(){throw Error('undo_interrupted')}
  }),/undo_interrupted/);
  assert.ok(fs.existsSync(L.mapped(f.root,L.UNDO)));
  assert.ok(fs.existsSync(L.mapped(f.root,L.LOCK)));
  assert.throws(()=>f.make().rollback(),/existing_undo/);
 }finally{f.cleanup()}
});
test('rollback crash after unlink keeps indeterminate journal; cannot auto-resume',()=>{
 const f=fixture();
 try{
  const lab=f.make();lab.begin();
  for(let i=0;i<20;i++)lab.step(i);
  const victim=f.plan.operations[19];
  assert.throws(()=>f.make().rollback({
   afterPhysical(){throw Error('power_cut_after_unlink')}
  }),/power_cut_after_unlink/);
  assert.equal(fs.existsSync(L.mapped(f.root,victim.path)),false);
  assert.throws(()=>f.make().rollback(),/existing_undo/);
  const log=fs.readFileSync(L.mapped(f.root,L.UNDO),'utf8');
  assert.match(log,/"kind":"intent"/);
  assert.doesNotMatch(log,/"kind":"done"/);
 }finally{f.cleanup()}
});
test('reject fake root, incorrect permissions and no production API',()=>{
 const plan=L.proposalFor({requestId:REQUEST,bytes:bytes()});
 for(const root of ['/opt','/root','/tmp','/var/lib'])
  assert.throws(()=>L.createLab({root,proposal:plan}),/non_lab_root_denied/);
 const f=fixture();
 try{
  fs.chmodSync(f.root,0o755);
  assert.throws(()=>f.make(),/unsafe_lab_root/);
  fs.chmodSync(f.root,0o700);
  assert.equal(f.make().production_install_enabled,false);
  assert.equal(typeof f.make().installProduction,'undefined');
 }finally{f.cleanup()}
});
