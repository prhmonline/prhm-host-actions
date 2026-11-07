'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const transaction=require('../ops/agent3-universal-backup/four-owner-rollback-transaction.cjs');
const KEYS=transaction.KEYS;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function create(){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'agent3-real-crash-'));
 fs.chmodSync(tmp,0o700);
 const parent=path.join(tmp,'owners'),journalRoot=path.join(tmp,'journal');
 fs.mkdirSync(parent,{mode:0o700});fs.mkdirSync(journalRoot,{mode:0o700});
 const ownerPaths={},beforeSha={},afterSha={},afterBuffers={};
 for(const k of KEYS){
  const old=Buffer.from('live PREIMAGE fixture '+k+'\n');
  const next=Buffer.from('reviewed POSTIMAGE fixture '+k+'\n');
  ownerPaths[k]=path.join(parent,k+'.js');
  fs.writeFileSync(ownerPaths[k],old,{mode:k==='base'?0o640:0o600});
  beforeSha[k]=sha(old);afterSha[k]=sha(next);afterBuffers[k]=next;
 }
 const pristine=()=>KEYS.every(k=>sha(fs.readFileSync(ownerPaths[k]))===beforeSha[k]);
 const healthProbe=async()=>({ok:pristine(),owners_verified:pristine(),services_active:4});
 return {tmp,ownerPaths,journalRoot,beforeSha,afterSha,afterBuffers,pristine,healthProbe,
  dispose:()=>fs.rmSync(tmp,{recursive:true,force:true})};
}
function crash(f,count=2){
 const modulePath=path.join(__dirname,'../ops/agent3-universal-backup/four-owner-rollback-transaction.cjs');
 const args=JSON.stringify({ownerPaths:f.ownerPaths,journalRoot:f.journalRoot,
   beforeSha:f.beforeSha,afterSha:f.afterSha,
   afterBuffers:Object.fromEntries(KEYS.map(k=>[k,f.afterBuffers[k].toString('base64')])),
   count});
 const script=[
  'const t=require(process.argv[1]);',
  'const data=JSON.parse(process.argv[2]);',
  "const afterBuffers=Object.fromEntries(Object.entries(data.afterBuffers).map(([k,v])=>[k,Buffer.from(v,'base64')]));",
  't.runIsolatedFourOwnerTransaction({...data,afterBuffers,',
  ' healthProbe:async()=>({ok:true,owners_verified:true,services_active:4}),',
  " observer:p=>{if(p.phase==='owner_replaced'&&p.completed===data.count)process.kill(process.pid,'SIGKILL');}",
  '}).then(()=>process.exit(21)).catch(()=>process.exit(22));'
 ].join('\n');
 return cp.spawnSync(process.execPath,['-e',script,modulePath,args],{
  encoding:'utf8',timeout:20000,maxBuffer:200000
 });
}
function lockRecord(f){
 const raw=fs.readFileSync(path.join(f.journalRoot,'.four-owner-install.lock'),'utf8');
 return JSON.parse(raw);
}
const escrowDir=f=>path.join(f.journalRoot,'txn-'+lockRecord(f).txn);
test('hard process exit after two actual renames leaves a durable lock tied to exactly one escrow',async()=>{
 const f=create();
 try{
  const proc=crash(f,2);
  assert.equal(proc.signal,'SIGKILL',proc.stderr);
  const lock=lockRecord(f);
  assert.equal(lock.schema,'prhm.agent3.four-owner-fixture-lock.v1');
  assert.equal(lock.mode,'FIXTURE_ONLY_NOT_PRODUCTION');
  assert.ok(fs.existsSync(path.join(escrowDir(f),'manifest.json')));
  assert.equal(fs.readdirSync(escrowDir(f)).filter(x=>x.endsWith('.preimage')).length,4);
  assert.equal(sha(fs.readFileSync(f.ownerPaths.base)),f.afterSha.base);
  assert.equal(sha(fs.readFileSync(f.ownerPaths.executor)),f.afterSha.executor);
  assert.equal(sha(fs.readFileSync(f.ownerPaths.policy)),f.beforeSha.policy);
  assert.equal(sha(fs.readFileSync(f.ownerPaths.mcp)),f.beforeSha.mcp);
  const outcome=await transaction.recoverIsolatedFourOwnerTransaction({
   ownerPaths:f.ownerPaths,journalRoot:f.journalRoot,healthProbe:f.healthProbe
  });
  assert.equal(outcome.ok,true);
  assert.equal(outcome.restored_count,2);
  assert.equal(outcome.rollback,'verified_after_process_crash');
  assert.equal(outcome.production_mutated,false);
  assert.equal(f.pristine(),true);
  assert.equal(fs.statSync(f.ownerPaths.base).mode&0o777,0o640);
  assert.equal(fs.existsSync(path.join(f.journalRoot,'.four-owner-install.lock')),false);
  assert.equal(fs.existsSync(path.join(f.journalRoot,'.four-owner-recovery.lock')),false);
  assert.equal(fs.existsSync(path.join(f.journalRoot,'txn-'+lock.txn)),true);
 }finally{f.dispose();}
});
test('foreign SHA after SIGKILL fails BEFORE any recovery mutation',async()=>{
 const f=create();
 try{
  assert.equal(crash(f,2).signal,'SIGKILL');
  fs.writeFileSync(f.ownerPaths.executor,'third-party source change',{mode:0o600});
  await assert.rejects(transaction.recoverIsolatedFourOwnerTransaction({
   ownerPaths:f.ownerPaths,journalRoot:f.journalRoot,healthProbe:f.healthProbe
  }),/recovery_foreign_owner_change:executor/);
  assert.equal(fs.readFileSync(f.ownerPaths.executor,'utf8'),'third-party source change');
  assert.equal(sha(fs.readFileSync(f.ownerPaths.base)),f.afterSha.base);
  assert.equal(fs.existsSync(path.join(f.journalRoot,'.four-owner-install.lock')),true);
 }finally{f.dispose();}
});
test('corrupt escrow before recovery aborts without changing an installed owner',async()=>{
 const f=create();
 try{
  assert.equal(crash(f,2).signal,'SIGKILL');
  fs.writeFileSync(path.join(escrowDir(f),'base.preimage'),'tampered',{mode:0o600});
  await assert.rejects(transaction.recoverIsolatedFourOwnerTransaction({
   ownerPaths:f.ownerPaths,journalRoot:f.journalRoot,healthProbe:f.healthProbe
  }),/recovery_escrow_tampered:base/);
  assert.equal(sha(fs.readFileSync(f.ownerPaths.base)),f.afterSha.base);
 }finally{f.dispose();}
});
test('recovery runs only once, never clears an already existing recovery lock',async()=>{
 const f=create();
 try{
  assert.equal(crash(f,2).signal,'SIGKILL');
  const reLock=path.join(f.journalRoot,'.four-owner-recovery.lock');
  fs.writeFileSync(reLock,'stale',{flag:'wx',mode:0o600});
  await assert.rejects(transaction.recoverIsolatedFourOwnerTransaction({
   ownerPaths:f.ownerPaths,journalRoot:f.journalRoot,healthProbe:f.healthProbe
  }),/recovery_already_running_or_stale/);
  assert.equal(fs.readFileSync(reLock,'utf8'),'stale');
  assert.equal(sha(fs.readFileSync(f.ownerPaths.base)),f.afterSha.base);
 }finally{f.dispose();}
});
test('unhealthy services after byte-perfect crash recovery retain audit lock and escrow',async()=>{
 const f=create();
 try{
  assert.equal(crash(f,2).signal,'SIGKILL');
  await assert.rejects(transaction.recoverIsolatedFourOwnerTransaction({
   ownerPaths:f.ownerPaths,journalRoot:f.journalRoot,
   healthProbe:async()=>({ok:false,owners_verified:true,services_active:0})
  }),/recovery_services_unverified/);
  assert.equal(f.pristine(),true);
  assert.equal(fs.existsSync(path.join(f.journalRoot,'.four-owner-install.lock')),true);
  assert.equal(fs.existsSync(path.join(f.journalRoot,'.four-owner-recovery.lock')),true);
 }finally{f.dispose();}
});
test('malformed lock or real production owner is refused before any mutation',async()=>{
 const f=create();
 try{
  fs.writeFileSync(path.join(f.journalRoot,'.four-owner-install.lock'),
   'not a trusted request',{mode:0o600});
  await assert.rejects(transaction.recoverIsolatedFourOwnerTransaction({
   ownerPaths:f.ownerPaths,journalRoot:f.journalRoot,healthProbe:f.healthProbe
  }),/recovery_untrusted_transaction_lock|recovery_invalid_lock_record/);
  const prod={...f.ownerPaths,base:'/opt/prhm-agent-selfmaint/server.js'};
  await assert.rejects(transaction.recoverIsolatedFourOwnerTransaction({
   ownerPaths:prod,journalRoot:f.journalRoot,healthProbe:f.healthProbe
  }),/recovery_production_owner_disallowed/);
  assert.equal(f.pristine(),true);
 }finally{f.dispose();}
});

test('real SIGKILL after owner 1, 3 or 4 recovers exactly that durable prefix',async()=>{
 for(const n of [1,3,4]){
  const f=create();
  try{
   const result=crash(f,n);
   assert.equal(result.signal,'SIGKILL',result.stderr);
   const preimages=KEYS.slice(n),postimages=KEYS.slice(0,n);
   for(const k of preimages)
    assert.equal(sha(fs.readFileSync(f.ownerPaths[k])),f.beforeSha[k]);
   for(const k of postimages)
    assert.equal(sha(fs.readFileSync(f.ownerPaths[k])),f.afterSha[k]);
   const out=await transaction.recoverIsolatedFourOwnerTransaction({
    ownerPaths:f.ownerPaths,journalRoot:f.journalRoot,healthProbe:f.healthProbe
   });
   assert.equal(out.restored_count,n);
   assert.equal(f.pristine(),true);
  }finally{f.dispose();}
 }
});
