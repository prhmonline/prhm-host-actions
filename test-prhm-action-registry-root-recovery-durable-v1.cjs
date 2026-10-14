'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const once=require('./prhm-action-registry-one-time-fence-v1.cjs');
const A=require('./prhm-action-registry-root-recovery-durable-v1.cjs');
const uuid='a8c1de40-17bf-41c0-b26a-56ad9d1b30a7';
const approval='f2178055-5508-440a-8d51-3a571107ea08';
const hex=b=>crypto.createHash('sha256').update(b).digest('hex');
const args={action:G.ACTION,project:'honartik',
 source_commit:'a'.repeat(40),manifest_commit:'b'.repeat(40),
 manifest_sha256:'c'.repeat(64)};
function createIo(){
 const map=new Map();const dirs=new Map();
 let ino=20,opens=0,closed=0,fdRead=0;
 function mkdir(p,mode=0o40700){dirs.set(p,{ino:++ino,dev:1,uid:0,gid:0,
  mode,isDirectory:()=>true,isSymbolicLink:()=>false});}
 function file(p,body,mode=0o100600){
  const b=Buffer.from(body);
  map.set(p,{ino:++ino,dev:1,uid:0,gid:0,mode,size:b.length,body:b,
   isFile:()=>true,isSymbolicLink:()=>false});
 }
 for(const d of [once.DIR,A.CONSUMED,'/tmp/test-root'])mkdir(d);
 const io={
  lstatSync:p=>{
   const m=dirs.get(p)||map.get(p);
   if(!m)throw Object.assign(Error('ENOENT'),{code:'ENOENT'});
   return m;
  },
  realpathSync:p=>p,
  openSync:(p,flags)=>{
   assert.equal(flags&fs.constants.O_NOFOLLOW,fs.constants.O_NOFOLLOW);
   opens++;
   return p;
  },
  fstatSync:p=>{fdRead++;return dirs.get(p)||map.get(p)},
  readFileSync:p=>Buffer.from(map.get(p).body),
  closeSync:()=>{closed++},
  readdirSync:p=>{assert.equal(p,A.CONSUMED);return [...map.keys()]
    .filter(x=>x.startsWith(p+'/')).map(x=>x.slice(p.length+1))}
 };
 return {io,dirs,map,file,mkdir,stats:()=>({opens,closed,fdRead})};
}
function fixture(){
 const f=createIo(),digest=G.approvalBindingSha(args);
 const claim={schema:'prhm.registry.once.v1',request_id:uuid,action:G.ACTION,
  operation:G.OPERATION,project:'honartik',source_commit:args.source_commit,
  manifest_commit:args.manifest_commit,manifest_sha256:args.manifest_sha256,
  arguments_sha256:digest};
 const ledger={schema_version:'prhm.approval-consumption.v1',
  approval_id:approval,request_id:uuid,work_order_id:'reviewed',
  project_id:'control_plane',operation:G.OPERATION,request_hash:digest,
  consumed_at:'2026-10-13T20:00:00.000Z',
  consumer:'prhm-agent-selfmaint-exec-host-actions-v2',
  consumption_hash:null};
 ledger.consumption_hash=hex(Buffer.from(JSON.stringify(ledger)));
 const claimPath=once.DIR+'/'+uuid+'.json';
 const ledgerPath=A.CONSUMED+'/'+approval+'.json';
 f.file(claimPath,G.canonicalJson(claim)+'\n');
 f.file(ledgerPath,JSON.stringify(ledger)+'\n');
 return {...f,claim,ledger,claimPath,ledgerPath,release:{
  normalized:{project:'honartik'},source_commit:args.source_commit,
  manifest_commit:args.manifest_commit,manifest_sha256:args.manifest_sha256
 },snapshot:{request_id:uuid}};
}
test('actual fixed-path root journal reader uses O_NOFOLLOW and stat/fstat',()=>{
 const f=fixture();
 const b=A.readFixed(f.io,f.claimPath);
 assert.equal(JSON.parse(b).request_id,uuid);
 assert.equal(f.stats().opens,1);assert.equal(f.stats().closed,1);
 assert.equal(f.stats().fdRead,1);
});
test('original claimed request and uniquely consumed Approval Center ledger are independently bound',()=>{
 const f=fixture();
 assert.equal(A.assertConsumed({io:f.io,id:uuid,release:f.release,snapshot:f.snapshot}),true);
 assert.ok(f.stats().opens>=2);
});
test('a forged once-only claim cannot authorize recovery',()=>{
 for(const key of ['arguments_sha256','source_commit','manifest_commit','project','request_id']){
  const f=fixture();
  const bad={...f.claim,[key]:key==='project'?'other':'f'.repeat(key==='arguments_sha256'?64:40)};
  f.file(f.claimPath,G.canonicalJson(bad)+'\n');
  assert.throws(()=>A.assertConsumed({io:f.io,id:uuid,release:f.release,snapshot:f.snapshot}),
   /claim_binding_mismatch/);
 }
});
test('ledger tampering, wrong consumer or second same-request ledger deny recovery',()=>{
 for(const k of ['consumer','operation','request_hash','consumption_hash']){
  const f=fixture();const bad={...f.ledger,[k]:'unexpected'};
  f.file(f.ledgerPath,JSON.stringify(bad)+'\n');
  assert.throws(()=>A.assertConsumed({io:f.io,id:uuid,release:f.release,snapshot:f.snapshot}),
   /consumption_binding_invalid/);
 }
 const repeated=fixture();
 const second={...repeated.ledger,approval_id:'da499702-9785-47d8-9823-56aa44dc1eb0',
  consumption_hash:null};
 second.consumption_hash=hex(Buffer.from(JSON.stringify(second)));
 repeated.file(A.CONSUMED+'/'+second.approval_id+'.json',JSON.stringify(second)+'\n');
 assert.throws(()=>A.assertConsumed({io:repeated.io,id:uuid,
  release:repeated.release,snapshot:repeated.snapshot}),
  /unique_original_consumed_approval_missing/);
});
test('wrong journal ID and missing durable claim deny recovery',()=>{
 const f=fixture();
 assert.throws(()=>A.assertConsumed({io:f.io,id:uuid,release:f.release,
  snapshot:{request_id:'f'.repeat(36)}}),/journal_request_mismatch/);
 f.map.delete(f.claimPath);
 assert.throws(()=>A.assertConsumed({io:f.io,id:uuid,release:f.release,
  snapshot:f.snapshot}),/ENOENT/);
});
test('unsafe root directory and replaced inode reject read before approval',()=>{
 const f=fixture();
 const dir=f.dirs.get(once.DIR);
 dir.mode=0o40777;
 assert.throws(()=>A.readFixed(f.io,f.claimPath),/root_directory_unsafe/);
 dir.mode=0o40700;
 const st=f.map.get(f.claimPath);
 st.uid=1000;
 assert.throws(()=>A.readFixed(f.io,f.claimPath),/root_file_unsafe/);
 st.uid=0;
 f.io.fstatSync=()=>({...st,ino:999999});
 assert.throws(()=>A.readFixed(f.io,f.claimPath),/root_file_race/);
});
test('independent transient root unit is mandatory before any backup/journal I/O',()=>{
 const f=fixture();
 const cgroup=()=> '0::/system.slice/prhm-agent-selfmaint-exec.service\n';
 assert.throws(()=>A.createRecovery({release:f.release,requestId:uuid,
  io:f.io,getuid:()=>0,cgroup}),/independent_transient_runner_required/);
 assert.throws(()=>A.createRecovery({release:f.release,requestId:uuid,
  io:f.io,getuid:()=>1000,
  cgroup:()=> '0::/system.slice/prhm-shared-registry-bootstrap-v1-fixed.service\n'
 }),/root_required/);
});
test('module has no CLI install, token minting or approval reservation entrypoint',()=>{
 assert.deepEqual(Object.keys(A).sort(),[
  'BACKUPS','CONSUMED','LOCKS','assertConsumed','createRecovery',
  'readFixed','safeDir'].sort());
 for(const key of ['apply','approve','install','requestApproval','mintToken',
  'consume','resetClaim','deleteConsumed'])assert.equal(Object.hasOwn(A,key),false);
});
