'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const txn=require('../ops/agent3-universal-backup/four-owner-rollback-transaction.cjs');
const KEYS=txn.KEYS;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent3-four-owner-real-topology-'));
 fs.chmodSync(dir,0o700);
 const journalRoot=path.join(dir,'root-journal');
 fs.mkdirSync(journalRoot,{mode:0o700});
 const ownerPaths={},beforeSha={},afterSha={},afterBuffers={},beforeBuffers={},parents={};
 for(const k of KEYS){
  const parent=path.join(dir,'root-'+k);
  fs.mkdirSync(parent,{mode:0o700});
  parents[k]=parent;
  ownerPaths[k]=path.join(parent,'control-owner.js');
  const before=Buffer.from('fixture original '+k+'\n');
  const after=Buffer.from('fixture reviewed candidate '+k+'\n');
  fs.writeFileSync(ownerPaths[k],before,{mode:k==='mcp'?0o640:0o600});
  beforeSha[k]=sha(before);
  afterSha[k]=sha(after);
  afterBuffers[k]=after;
  beforeBuffers[k]=before;
 }
 const all=map=>KEYS.every(k=>sha(fs.readFileSync(ownerPaths[k]))===map[k]);
 const healthProbe=async({phase})=>({
  ok:phase==='postinstall'?all(afterSha):all(beforeSha),
  owners_verified:phase==='postinstall'?all(afterSha):all(beforeSha),
  services_active:4
 });
 return {dir,journalRoot,ownerPaths,parents,beforeSha,afterSha,afterBuffers,
  beforeBuffers,all,healthProbe,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
function request(f,extras={}){return {
 ownerPaths:f.ownerPaths,beforeSha:f.beforeSha,afterSha:f.afterSha,
 afterBuffers:f.afterBuffers,journalRoot:f.journalRoot,
 healthProbe:f.healthProbe,...extras
};}
function crash(f,n){
 const target=path.join(__dirname,'../ops/agent3-universal-backup/four-owner-rollback-transaction.cjs');
 const obj={...request(f),afterBuffers:Object.fromEntries(KEYS.map(k=>[
   k,f.afterBuffers[k].toString('base64')])),n};
 delete obj.healthProbe;
 const script=[
  'const t=require(process.argv[1]);',
  'const x=JSON.parse(process.argv[2]);',
  "const buffers=Object.fromEntries(Object.entries(x.afterBuffers).map(([k,b])=>[k,Buffer.from(b,'base64')]));",
  't.runIsolatedFourOwnerTransaction({...x,afterBuffers:buffers,',
  'healthProbe:async()=>({ok:true,owners_verified:true,services_active:4}),',
  "observer:e=>{if(e.phase==='owner_replaced'&&e.completed===x.n)process.kill(process.pid,'SIGKILL');}",
  '}).then(()=>process.exit(22)).catch(()=>process.exit(23));'
 ].join('\n');
 return cp.spawnSync(process.execPath,['-e',script,target,JSON.stringify(obj)],{
  encoding:'utf8',timeout:20000,maxBuffer:200000
 });
}
test('four distinct owner parent directories can be preflighted and committed in private fixture',async()=>{
 const f=fixture();
 try{
  const parents=txn.verifiedFixtureParents(f.ownerPaths);
  assert.equal(new Set(Object.values(parents)).size,4);
  for(const k of KEYS)assert.equal(parents[k],f.parents[k]);
  const out=await txn.runIsolatedFourOwnerTransaction(request(f));
  assert.equal(out.ok,true);
  assert.equal(out.updated_owner_count,4);
  assert.equal(out.production_mutated,false);
  assert.equal(f.all(f.afterSha),true);
  for(const k of KEYS){
   const old=fs.readFileSync(path.join(out.durable_preimage_dir,k+'.preimage'));
   assert.deepEqual(old,f.beforeBuffers[k]);
   assert.equal(fs.statSync(f.ownerPaths[k]).mode&0o777,k==='mcp'?0o640:0o600);
  }
 }finally{f.cleanup();}
});
test('fault after every independent directory rename rolls back all four SHA-pinned owners',async()=>{
 for(let n=1;n<=4;n++){
  const f=fixture();
  try{
   await assert.rejects(txn.runIsolatedFourOwnerTransaction(request(f,{
    observer:e=>{if(e.phase==='owner_replaced'&&e.completed===n)
     throw Error('injected_fault_at_'+n);}
   })),/rollback_verified/);
   assert.equal(f.all(f.beforeSha),true,'all-four byte restoration '+n);
   assert.equal(fs.statSync(f.ownerPaths.mcp).mode&0o777,0o640);
   assert.equal(fs.existsSync(path.join(f.journalRoot,'.four-owner-install.lock')),false);
  }finally{f.cleanup();}
 }
});
test('genuine SIGKILL after three independent parent renames allows audited recovery',async()=>{
 const f=fixture();
 try{
  const result=crash(f,3);
  assert.equal(result.signal,'SIGKILL',result.stderr);
  assert.equal(fs.existsSync(path.join(f.journalRoot,'.four-owner-install.lock')),true);
  for(const [i,k] of KEYS.entries())
   assert.equal(sha(fs.readFileSync(f.ownerPaths[k])),
    i<3?f.afterSha[k]:f.beforeSha[k]);
  const out=await txn.recoverIsolatedFourOwnerTransaction({
   ownerPaths:f.ownerPaths,journalRoot:f.journalRoot,healthProbe:f.healthProbe
  });
  assert.equal(out.ok,true);
  assert.equal(out.restored_count,3);
  assert.equal(out.production_mutated,false);
  assert.equal(f.all(f.beforeSha),true);
  assert.equal(fs.statSync(f.ownerPaths.mcp).mode&0o777,0o640);
 }finally{f.cleanup();}
});
test('a foreign post-crash file change fails before modifying another owner directory',async()=>{
 const f=fixture();
 try{
  assert.equal(crash(f,2).signal,'SIGKILL');
  fs.writeFileSync(f.ownerPaths.executor,'unexpected external change');
  await assert.rejects(txn.recoverIsolatedFourOwnerTransaction({
   ownerPaths:f.ownerPaths,journalRoot:f.journalRoot,healthProbe:f.healthProbe
  }),/recovery_foreign_owner_change:executor/);
  assert.equal(sha(fs.readFileSync(f.ownerPaths.base)),f.afterSha.base);
  assert.equal(fs.readFileSync(f.ownerPaths.executor,'utf8'),'unexpected external change');
  assert.equal(fs.existsSync(path.join(f.journalRoot,'.four-owner-install.lock')),true);
 }finally{f.cleanup();}
});
test('symlinked or publicly writable one-of-four parent rejects whole transaction before lock',async()=>{
 for(const mode of ['symlink','public']){
  const f=fixture();
  try{
   if(mode==='symlink'){
    const src=f.parents.mcp,link=src+'-alias';
    fs.symlinkSync(src,link);
    f.ownerPaths.mcp=path.join(link,'control-owner.js');
   }else fs.chmodSync(f.parents.policy,0o777);
   await assert.rejects(txn.runIsolatedFourOwnerTransaction(request(f)),
    /fixture_root_only|private_fixture_directory_required/);
   assert.deepEqual(fs.readdirSync(f.journalRoot),[]);
  }finally{f.cleanup();}
 }
});
test('refuses real Production owner and non-fixture roots without reading or changing them',async()=>{
 const f=fixture();
 try{
  const obj={...f.ownerPaths,executor:'/opt/prhm-agent-selfmaint-exec/server.js'};
  assert.throws(()=>txn.verifiedFixtureParents(obj),
   /production_or_noncanonical_owner_disallowed/);
  const other={...f.ownerPaths,mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'};
  assert.throws(()=>txn.verifiedFixtureParents(other),
   /production_or_noncanonical_owner_disallowed/);
  assert.equal(f.all(f.beforeSha),true);
 }finally{f.cleanup();}
});
