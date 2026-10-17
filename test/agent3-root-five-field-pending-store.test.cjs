'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const store=require('../ops/agent3-universal-backup/root-five-field-pending-store.cjs');
const registration=require('../ops/agent3-universal-backup/registration-contract.cjs');
const gateway=require('../prhm-action-registry-gateway-v1.cjs');
const native=require('../ops/agent3-universal-backup/five-field-native-route-contract.cjs');
const ID='31677403-7157-418d-9902-60f4d0011ac9';
const base=()=>({
 action:registration.REGISTRY_ACTION,project:registration.PROJECT,
 source_commit:registration.SOURCE_COMMIT,manifest_commit:'b'.repeat(40),
 manifest_sha256:'c'.repeat(64)
});
const req=(id=ID,offset=90000)=>({
 requestId:id,arguments:base(),expiresAt:new Date(Date.now()+offset).toISOString()
});
function withDir(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent3-reg-pending-'));
 fs.chmodSync(dir,0o700);
 try{return fn(dir,process.getuid());}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('real O_EXCL pending record is fsynced and round-trips exact native five fields',()=>{
 withDir((dir,uid)=>{
  const data=req();
  const result=store.writeInVerifiedDirectory(data,dir,uid);
  assert.equal(result.ok,true);
  assert.equal(result.request_id,ID);
  assert.equal(result.arguments_sha256,gateway.approvalBindingSha(base()));
  assert.equal(result.durable,true);
  assert.equal(result.exclusive,true);
  assert.equal(result.approved,false);
  assert.equal(result.consumed,false);
  assert.equal(result.installed,false);
  const filename=path.join(dir,ID+'.json');
  const st=fs.lstatSync(filename);
  assert.equal(st.isFile(),true);
  assert.equal(st.mode&0o077,0);
  const read=store.readFromVerifiedDirectory(ID,dir,uid);
  assert.deepEqual(read.arguments,base());
  assert.deepEqual(Object.keys(read).sort(),
   store.REC_KEYS.slice().sort());
  assert.equal(read.arguments_sha256,result.arguments_sha256);
  const apply=native.prepareApply({
   body:{request_id:ID,second_confirmation:native.CRITICAL_CONFIRM,...base()},
   persistedRequest:read
  });
  assert.equal(apply.request_id,ID);
  assert.equal(apply.signed_approval_verified,false);
 });
});
test('repeated request ID, even for different SHA-pinned payload, cannot overwrite pending file',()=>{
 withDir((dir,uid)=>{
  store.writeInVerifiedDirectory(req(),dir,uid);
  const filename=path.join(dir,ID+'.json'),bytes=fs.readFileSync(filename);
  const change=req();change.arguments.manifest_sha256='d'.repeat(64);
  assert.throws(()=>store.writeInVerifiedDirectory(change,dir,uid),e=>e.code==='EEXIST');
  assert.deepEqual(fs.readFileSync(filename),bytes);
 });
});
test('concurrent pending creations cannot both win exclusive slot',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent3-reg-pending-concurrency-'));
 fs.chmodSync(dir,0o700);
 const uid=process.getuid();
 try{
  const results=await Promise.allSettled([
   Promise.resolve().then(()=>store.writeInVerifiedDirectory(req(),dir,uid)),
   Promise.resolve().then(()=>store.writeInVerifiedDirectory(req(),dir,uid))
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected'&&r.reason?.code==='EEXIST').length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('crash marker and corrupt JSON block the same request ID, never auto-delete',()=>{
 withDir((dir,uid)=>{
  const file=path.join(dir,ID+'.json');
  fs.writeFileSync(file,'',{flag:'wx',mode:0o600});
  assert.throws(()=>store.writeInVerifiedDirectory(req(),dir,uid),e=>e.code==='EEXIST');
  assert.throws(()=>store.readFromVerifiedDirectory(ID,dir,uid),/unsafe_request_file/);
  assert.equal(fs.existsSync(file),true);
  fs.writeFileSync(file,'{not json}',{mode:0o600});
  assert.throws(()=>store.readFromVerifiedDirectory(ID,dir,uid),/unsafe_request_file|request_not_json/);
 });
});
test('hash, request ID, extra approved flags, deleted fields and expired time fail closed',()=>{
 withDir((dir,uid)=>{
  const data=req();
  store.writeInVerifiedDirectory(data,dir,uid);
  const file=path.join(dir,ID+'.json');
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  const changes=[
   x=>{x.arguments.manifest_sha256='d'.repeat(64)},
   x=>{x.arguments_sha256='0'.repeat(64)},
   x=>{x.request_hash='0'.repeat(64)},
   x=>{x.request_id='e5c83f23-e121-48a9-819f-6ea2d2117320'},
   x=>{x.approved=true},
   x=>{x.approval_token='forbidden'},
   x=>{delete x.request_hash},
   x=>{x.status='consumed'},
   x=>{x.expires_at='2020-01-01T00:00:00Z'},
   x=>{x.expires_at=new Date(Date.now()+360000).toISOString()}
  ];
  for(const mutate of changes){
   const x=structuredClone(saved);mutate(x);
   fs.writeFileSync(file,JSON.stringify(x)+'\n',{mode:0o600});
   assert.throws(()=>store.readFromVerifiedDirectory(ID,dir,uid));
  }
 });
});
test('symlink or publicly writable directory and leaf are rejected',()=>{
 withDir((dir,uid)=>{
  const writable=path.join(dir,'unsafe');
  fs.mkdirSync(writable,{mode:0o700});fs.chmodSync(writable,0o777);
  assert.throws(()=>store.writeInVerifiedDirectory(req(),writable,uid),
    /unsafe_directory/);
  const symlink=path.join(dir,'link');
  fs.symlinkSync(writable,symlink);
  assert.throws(()=>store.writeInVerifiedDirectory(req(),symlink,uid),
    /noncanonical_directory/);
  const file=path.join(dir,ID+'.json');
  fs.writeFileSync(file,'seed',{mode:0o600});
  const leaf=path.join(dir,ID+'.json');
  fs.renameSync(leaf,leaf+'.old');
  fs.symlinkSync(leaf+'.old',leaf);
  assert.throws(()=>store.readFromVerifiedDirectory(ID,dir,uid),
    /unsafe_request_file/);
 });
});
test('reject forged ID, unauthorized source and request TTL before touching disk',()=>{
 withDir((dir,uid)=>{
  for(const invalid of [
   {...req(),requestId:'../escape'},
   {...req(),requestId:'x'.repeat(36)},
   {...req(),arguments:{...base(),project:'honartik'}},
   {...req(),arguments:{...base(),approved:true}},
   {...req(),expiresAt:'2010-01-01T00:00:00Z'},
   {...req(),expiresAt:new Date(Date.now()+600000).toISOString()}
  ])assert.throws(()=>store.writeInVerifiedDirectory(invalid,dir,uid));
  assert.deepEqual(fs.readdirSync(dir),[]);
 });
});
test('the module never auto-creates Production roots and is not a signing/installer CLI',()=>{
 const file=path.join(__dirname,'../ops/agent3-universal-backup/root-five-field-pending-store.cjs');
 const proc=cp.spawnSync(process.execPath,[file,'--apply'],{
  encoding:'utf8',timeout:10000
 });
 assert.equal(proc.status,78);
 assert.match(proc.stderr,/no standalone native request persistence/);
 assert.equal(store.ROOT,'/var/lib/prhm-agent-selfmaint-exec/agent3-registry-pending-v1');
 assert.equal(typeof store.mintApproval,'undefined');
 assert.equal(typeof store.consumeApproval,'undefined');
 assert.equal(typeof store.runInstaller,'undefined');
 if(process.getuid?.()!==0){
  assert.throws(()=>store.storeNativePending(req()),/trusted_root_required/);
  assert.throws(()=>store.loadNativePending(ID),/trusted_root_required/);
 }
});
