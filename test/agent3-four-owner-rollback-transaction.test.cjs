'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const transaction=require('../ops/agent3-universal-backup/four-owner-rollback-transaction.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const KEYS=transaction.KEYS;
function fixture(){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'agent3-owner-txn-'));
 fs.chmodSync(tmp,0o700);
 const parent=path.join(tmp,'owners'),journalRoot=path.join(tmp,'journal');
 fs.mkdirSync(parent,{mode:0o700});
 fs.mkdirSync(journalRoot,{mode:0o700});
 const ownerPaths={},beforeSha={},afterSha={},afterBuffers={},beforeBuffers={};
 for(const [i,k] of KEYS.entries()){
  const old=Buffer.from('synthetic owner '+k+' preimage '+i+'\n');
  const next=Buffer.from('synthetic owner '+k+' reviewed postimage '+i+'\n');
  const file=path.join(parent,k+'.owner.cjs');
  fs.writeFileSync(file,old,{mode:i===0?0o640:0o600});
  ownerPaths[k]=file;beforeSha[k]=sha(old);afterSha[k]=sha(next);
  afterBuffers[k]=next;beforeBuffers[k]=old;
 }
 const all=(shaMap)=>KEYS.every(k=>sha(fs.readFileSync(ownerPaths[k]))===shaMap[k]);
 const healthProbe=async ({phase,ownerCount})=>({
  ok:ownerCount===4&&(phase==='postinstall'?all(afterSha):all(beforeSha)),
  owners_verified:phase==='postinstall'?all(afterSha):all(beforeSha),
  services_active:4
 });
 return {tmp,parent,journalRoot,ownerPaths,beforeSha,afterSha,afterBuffers,
  beforeBuffers,all,healthProbe,cleanup:()=>fs.rmSync(tmp,{recursive:true,force:true})};
}
const input=f=>({ownerPaths:f.ownerPaths,beforeSha:f.beforeSha,
 afterSha:f.afterSha,afterBuffers:f.afterBuffers,journalRoot:f.journalRoot,
 healthProbe:f.healthProbe});
test('all four reviewed fixture postimages commit only after full SHA verification and healthy probes',async()=>{
 const f=fixture();
 try{
  const observations=[];
  const outcome=await transaction.runIsolatedFourOwnerTransaction({
   ...input(f),observer:p=>observations.push(p)
  });
  assert.equal(outcome.ok,true);
  assert.equal(outcome.updated_owner_count,4);
  assert.equal(outcome.rollback,'not_needed');
  assert.equal(outcome.production_mutated,false);
  assert.equal(outcome.signed_approval_consumed,false);
  assert.equal(f.all(f.afterSha),true);
  assert.equal(observations[0].phase,'durable_preimages');
  assert.equal(observations.filter(x=>x.phase==='owner_replaced').length,4);
  const manifest=JSON.parse(fs.readFileSync(
   path.join(outcome.durable_preimage_dir,'manifest.json'),'utf8'));
  assert.equal(manifest.mode,'FIXTURE_ONLY_NOT_PRODUCTION');
  for(const k of KEYS){
   const backup=path.join(outcome.durable_preimage_dir,k+'.preimage');
   assert.deepEqual(fs.readFileSync(backup),f.beforeBuffers[k]);
   assert.equal(fs.statSync(backup).mode&0o077,0);
   assert.equal(manifest.owners[k].before_sha256,f.beforeSha[k]);
   assert.equal(manifest.owners[k].after_sha256,f.afterSha[k]);
  }
  assert.equal(fs.statSync(f.ownerPaths.base).mode&0o777,0o640);
  assert.equal(fs.existsSync(path.join(f.journalRoot,'.four-owner-install.lock')),false);
 }finally{f.cleanup();}
});
test('any failure after first, second, third or fourth swap rolls back all touched owner bytes',async()=>{
 for(let n=1;n<=4;n++){
  const f=fixture();
  try{
   await assert.rejects(transaction.runIsolatedFourOwnerTransaction({
    ...input(f),
    observer:p=>{if(p.phase==='owner_replaced'&&p.completed===n)
      throw Error('FAULT_INJECT_AFTER_OWNER_'+n);}
   }),/rollback_verified/);
   assert.equal(f.all(f.beforeSha),true,'byte-perfect rollback at '+n);
   assert.equal(fs.statSync(f.ownerPaths.base).mode&0o777,0o640);
   assert.equal(fs.existsSync(path.join(f.journalRoot,'.four-owner-install.lock')),false);
   const backupFolders=fs.readdirSync(f.journalRoot).filter(x=>x.startsWith('txn-'));
   assert.equal(backupFolders.length,1,'retain durable backup for audit');
  }finally{f.cleanup();}
 }
});
test('postinstall health failure rolls back all four and verifies rollback health',async()=>{
 const f=fixture();
 try{
  const phases=[];
  await assert.rejects(transaction.runIsolatedFourOwnerTransaction({
   ...input(f),healthProbe:async p=>{
    phases.push(p.phase);
    if(p.phase==='postinstall')return{ok:false,owners_verified:true,services_active:4};
    return f.healthProbe(p);
   }
  }),/rollback_verified/);
  assert.deepEqual(phases,['postinstall','rollback']);
  assert.equal(f.all(f.beforeSha),true);
 }finally{f.cleanup();}
});
test('unverified service recovery remains locked after byte-perfect rollback',async()=>{
 const f=fixture();
 try{
  await assert.rejects(transaction.runIsolatedFourOwnerTransaction({
   ...input(f),
   healthProbe:async p=>({
    ok:false,owners_verified:false,services_active:0
   })
  }),/rollback_unverified:rollback_services_unhealthy/);
  assert.equal(f.all(f.beforeSha),true);
  assert.equal(fs.existsSync(path.join(f.journalRoot,'.four-owner-install.lock')),true);
 }finally{f.cleanup();}
});
test('concurrent unreviewed mutation blocks rollback overwrite, retains lock and escrow',async()=>{
 const f=fixture();
 try{
  await assert.rejects(transaction.runIsolatedFourOwnerTransaction({
   ...input(f),observer:p=>{
    if(p.phase==='owner_replaced'&&p.key==='executor'){
     fs.writeFileSync(f.ownerPaths.executor,Buffer.from('FOREIGN CHANGE'),{mode:0o600});
     throw Error('simulate third-party writer');
    }
   }
  }),/rollback_unverified/);
  assert.equal(fs.readFileSync(f.ownerPaths.executor,'utf8'),'FOREIGN CHANGE');
  assert.equal(fs.existsSync(path.join(f.journalRoot,'.four-owner-install.lock')),true);
  assert.equal(fs.readdirSync(f.journalRoot).filter(x=>x.startsWith('txn-')).length,1);
 }finally{f.cleanup();}
});
test('wrong SHA, symlink owner, world writable owner or duplicate paths abort before lock',async()=>{
 for(const mutate of [
  f=>{f.afterSha.base='0'.repeat(64);},
  f=>{f.beforeSha.base='0'.repeat(64);},
  f=>{f.ownerPaths.base=f.ownerPaths.executor;},
  f=>{fs.chmodSync(f.ownerPaths.base,0o666);},
  f=>{
   const p=f.ownerPaths.base;
   fs.renameSync(p,p+'.old');fs.symlinkSync(p+'.old',p);
  }
 ]){
  const f=fixture();
  try{
   mutate(f);
   await assert.rejects(transaction.runIsolatedFourOwnerTransaction(input(f)));
   assert.equal(fs.readdirSync(f.journalRoot).length,0);
  }finally{f.cleanup();}
 }
});
test('Production owner paths and arbitrary rooted outside-fixture targets are rejected',async()=>{
 const f=fixture();
 try{
  const prod={
   ...input(f),ownerPaths:{...f.ownerPaths,
     base:'/opt/prhm-agent-selfmaint/server.js'}
  };
  await assert.rejects(transaction.runIsolatedFourOwnerTransaction(prod),
   /production_or_cross_directory_owner_disallowed/);
  const nonPrivate={...input(f),journalRoot:path.dirname(f.tmp)};
  await assert.rejects(transaction.runIsolatedFourOwnerTransaction(nonPrivate),
   /private_fixture_directory_required|fixture_root_only/);
  assert.equal(fs.readdirSync(f.journalRoot).length,0);
 }finally{f.cleanup();}
});
test('stale exclusive transaction lock blocks new run without deleting it',async()=>{
 const f=fixture();
 try{
  const lock=path.join(f.journalRoot,'.four-owner-install.lock');
  fs.writeFileSync(lock,'CRASH-MARKER',{flag:'wx',mode:0o600});
  await assert.rejects(transaction.runIsolatedFourOwnerTransaction(input(f)),
   /existing_or_stale_transaction_lock/);
  assert.equal(fs.readFileSync(lock,'utf8'),'CRASH-MARKER');
  assert.equal(f.all(f.beforeSha),true);
 }finally{f.cleanup();}
});
test('the fixture-only transaction has no CLI production install or approval path',()=>{
 const filename=path.join(__dirname,
  '../ops/agent3-universal-backup/four-owner-rollback-transaction.cjs');
 const result=cp.spawnSync(process.execPath,[filename,'--apply'],{
  encoding:'utf8',timeout:10000
 });
 assert.equal(result.status,78);
 assert.match(result.stderr,/fixture-only rollback rehearsal/);
 assert.equal(typeof transaction.installProduction,'undefined');
 assert.equal(typeof transaction.verifySignedApproval,'undefined');
 assert.equal(typeof transaction.registerMcpTool,'undefined');
});
