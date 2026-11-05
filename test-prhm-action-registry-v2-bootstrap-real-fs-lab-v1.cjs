'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const P=require('./prhm-action-registry-v2-bootstrap-transaction-plan-v1.cjs');
const W=require('./prhm-action-registry-v2-bootstrap-wal-v1.cjs');
const L=require('./prhm-action-registry-v2-bootstrap-exclusive-lock-v1.cjs');
const REAL=require('./prhm-action-registry-v2-bootstrap-real-fs-lab-v1.cjs');
const STAGE=require('./manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json');
const REQUEST='12345678-1234-4234-8234-123456789abc';
let cached;
function immutableData(){
 if(cached)return cached;
 const bytes={};
 for(const x of STAGE.files){
  const got=cp.spawnSync('git',['show',x.source_commit+':'+x.source_path],
   {cwd:__dirname,timeout:15000,maxBuffer:5000000});
  assert.equal(got.status,0,'missing immutable Git blob '+x.source_path);
  bytes[x.destination]=got.stdout;
 }
 const bundle=Object.fromEntries(STAGE.files.map(x=>[x.source_path,bytes[x.destination]]));
 const plan=P.immutablePlan();
 const observed={owners:{},files:{},directories:{},journal_absent:true,socket_absent:true};
 for(const [key,x] of Object.entries(plan.protected_owners))
  observed.owners[key]=x.sha256;
 for(const file of plan.files)observed.files[file.path]='absent';
 for(const dir of plan.dirs)observed.directories[dir.path]='absent';
 const proposal=P.proposal({
  request_id:REQUEST,bundle:P.attestBundle(bundle),observed
 });
 assert.equal(proposal.operation_count,30);
 cached={proposal,bytes};
 return cached;
}
function prepare(root,proposal){
 const planned=new Set(proposal.operations.filter(x=>x.kind==='mkdir').map(x=>x.path));
 const ancestors=new Set();
 const targets=[
  ...proposal.operations.map(x=>x.path),L.LOCK,W.JPATH
 ];
 for(const target of targets){
  let p=path.posix.dirname(target);
  while(p!=='/'&&!ancestors.has(p)){
   if(!planned.has(p)&&![...planned].some(x=>p.startsWith(x+'/')))
    ancestors.add(p);
   p=path.posix.dirname(p);
  }
 }
 for(const p of [...ancestors].sort((a,b)=>a.split('/').length-b.split('/').length)){
  const mapped=REAL.mapped(root,p);
  if(!fs.existsSync(mapped))fs.mkdirSync(mapped,{mode:0o700});
 }
}
function fresh(){
 const data=immutableData();
 const root=fs.mkdtempSync(path.join(os.tmpdir(),REAL.PREFIX));
 fs.chmodSync(root,0o700);
 prepare(root,data.proposal);
 return {...data,root,
  cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function guestPayload(f){
 const filename=path.join(f.root,'fixture.json');
 fs.writeFileSync(filename,JSON.stringify({
  proposal:f.proposal,
  bytes:Object.fromEntries(Object.entries(f.bytes)
   .map(([key,v])=>[key,v.toString('base64')]))
 }),{mode:0o600});
 return filename;
}
test('real O_EXCL lock, fsync and 30 ordered Git-verified operations in private /tmp jail',()=>{
 const f=fresh();
 try{
  const lab=REAL.createLab({
   root:f.root,proposal:f.proposal,pinnedBytes:f.bytes
  });
  let progress=lab.begin();
  assert.equal(progress.completed,0);
  assert.equal(progress.pending,null);
  assert.ok(fs.existsSync(REAL.mapped(f.root,L.LOCK)));
  assert.ok(fs.existsSync(REAL.mapped(f.root,W.JPATH)));
  assert.equal(fs.statSync(REAL.mapped(f.root,L.LOCK)).mode&0o777,0o600);
  for(let i=0;i<f.proposal.operation_count;i++){
   progress=lab.step(i);
   assert.equal(progress.completed,i+1);
   assert.equal(progress.pending,null);
  }
  assert.equal(progress.total,30);
  assert.equal(progress.safe_to_resume,false);
  assert.equal(progress.ready_for_external_review,true);
  const file=f.proposal.operations.find(x=>x.kind==='create_file');
  assert.deepEqual(fs.readFileSync(REAL.mapped(f.root,file.path)),f.bytes[file.path]);
  assert.equal(fs.statSync(REAL.mapped(f.root,file.path)).mode&0o777,0o600);
  assert.throws(()=>lab.begin(),/session_already_used/);
  assert.throws(()=>lab.step(29),/step_not_next_or_pending/);
  assert.throws(()=>REAL.createLab({
   root:f.root,proposal:f.proposal,pinnedBytes:f.bytes
  }).begin(),/EEXIST/);
  assert.equal(lab.production_install_enabled,false);
  assert.equal(lab.simulated_approval_only,true);
 }finally{f.cleanup()}
});
function crashAt(hook){
 const f=fresh();
 try{
  const fixture=guestPayload(f);
  const child=[
   "const fs=require('node:fs');",
   "const mod=require(process.argv[3]);",
   "const state=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));",
   "const bytes=Object.fromEntries(Object.entries(state.bytes).map(([k,v])=>[k,Buffer.from(v,'base64')]));",
   "const w=mod.createLab({root:process.argv[2],proposal:state.proposal,pinnedBytes:bytes});",
   "w.begin();",
   "w.step(0,{[process.argv[4]]:()=>process.kill(process.pid,'SIGKILL')});"
  ].join('\n');
  const result=cp.spawnSync(process.execPath,['-e',child,fixture,f.root,
   require.resolve('./prhm-action-registry-v2-bootstrap-real-fs-lab-v1.cjs'),hook],
   {cwd:__dirname,timeout:30000,encoding:'utf8'});
  assert.equal(result.signal,'SIGKILL',result.stderr||'child did not stop');
  const journal=fs.readFileSync(REAL.mapped(f.root,W.JPATH));
  const progress=W.scan(journal,f.proposal);
  assert.equal(progress.completed,0);
  assert.equal(progress.pending,0);
  assert.equal(progress.indeterminate,true);
  assert.equal(progress.safe_to_resume,false);
  assert.ok(fs.existsSync(REAL.mapped(f.root,L.LOCK)));
  assert.throws(()=>REAL.createLab({
   root:f.root,proposal:f.proposal,pinnedBytes:f.bytes
  }).begin(),/EEXIST/);
  const first=REAL.mapped(f.root,f.proposal.operations[0].path);
  assert.equal(fs.existsSync(first),hook==='afterOperation');
 }finally{f.cleanup()}
}
test('real OS child SIGKILL after WAL intent retains durable pending intent and lock',()=>{
 crashAt('afterIntent');
});
test('real OS child SIGKILL after physical directory before WAL done never replays',()=>{
 crashAt('afterOperation');
});
test('tampered WAL / pinned file / stale path and non-lab roots are denied',()=>{
 const f=fresh();
 try{
  const b={...f.bytes};
  b[f.proposal.operations.find(x=>x.kind==='create_file').path]=Buffer.from('tamper');
  assert.throws(()=>REAL.createLab({root:f.root,proposal:f.proposal,pinnedBytes:b}),
   /source_blob_not_git_pinned/);
  assert.throws(()=>REAL.createLab({root:'/opt',proposal:f.proposal,pinnedBytes:f.bytes}),
   /non_lab_root_denied/);
  const lab=REAL.createLab({root:f.root,proposal:f.proposal,pinnedBytes:f.bytes});
  lab.begin();
  const j=REAL.mapped(f.root,W.JPATH);
  fs.appendFileSync(j,'untrusted\n');
  assert.throws(()=>lab.inspect(),/journal_/);
 }finally{f.cleanup()}
});
test('private-lab boundary rejects symlinks and unsafe permissions, no install/undo API',()=>{
 const f=fresh();
 try{
  fs.chmodSync(f.root,0o755);
  assert.throws(()=>REAL.createLab({root:f.root,proposal:f.proposal,pinnedBytes:f.bytes}),
   /unsafe_directory_or_owner/);
  fs.chmodSync(f.root,0o700);
  const parent=REAL.mapped(f.root,W.PARENT);
  const original=parent+'-safe';
  fs.renameSync(parent,original);
  fs.symlinkSync(original,parent);
  assert.throws(()=>REAL.createLab({
   root:f.root,proposal:f.proposal,pinnedBytes:f.bytes
  }).begin(),/unsafe_directory_or_owner/);
  assert.deepEqual(Object.keys(REAL).sort(),
   ['PREFIX','checkJail','mapped','createLab'].sort());
 }finally{f.cleanup()}
});
