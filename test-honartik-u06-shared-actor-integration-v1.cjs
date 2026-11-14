'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const Shared=require('./honartik-u06-shared-exclusive-lock-v1.cjs');
const Integrated=require('./honartik-u06-shared-actor-integration-v1.cjs');
const modulePath=path.join(__dirname,'honartik-u06-shared-actor-integration-v1.cjs');
const SHA=x=>crypto.createHash('sha256').update(x).digest('hex');
const rootFixture=()=>{
 const root='/tmp/u06-owner-shared-test-'+crypto.randomBytes(6).toString('hex');
 fs.mkdirSync(root,{mode:0o700});
 return {root,clean:()=>fs.rmSync(root,{recursive:true,force:true})};
};
const fixtures=(fn)=>{const f=rootFixture();try{return fn(f)}finally{f.clean()}};
function handlers(callback){
 return Object.fromEntries(Integrated.KINDS.map(kind=>[kind,
  async(cap,payload)=>callback?callback(cap,payload):({
   kind,terminal:true,evidence_sha256:SHA('fixture:'+kind),production_mutated:false
  })
 ]));
}
const bad=(name,fn)=>assert.throws(fn,new RegExp('u06_shared_integration_'+name));
const badAsync=(name,fn)=>assert.rejects(fn,new RegExp(name));
test('all five real actor categories are wired to the same held lease before callbacks',async()=>{
 const f=rootFixture();
 try{
  const calls=[];
  const impl=handlers(async(cap,payload)=>{
   assert.equal(cap.assertHeld(),true);
   const lock=path.join(f.root,Shared.LOCK_NAME);
   assert.equal(fs.statSync(lock).mode&0o777,0o600);
   calls.push({kind:cap.kind,payload});
   return {kind:cap.kind,terminal:true,
    evidence_sha256:SHA(cap.kind),production_mutated:false};
  });
  const system=Integrated.createUnprivilegedFixtureU06Integration(f.root,impl);
  for(let i=0;i<Integrated.KINDS.length;i++){
   const kind=Integrated.KINDS[i];
   const result=await system.run(kind,{index:i});
   assert.equal(result.kind,kind);
   assert.equal(result.production_mutated,false);
   assert.equal(system.inspect().locked,false);
  }
  assert.deepEqual(calls.map(x=>x.kind),Integrated.KINDS);
  assert.deepEqual(calls.map(x=>x.payload.index),[0,1,2,3,4]);
 }finally{f.clean()}
});
test('all five callbacks are denied BEFORE invocation when any other actor holds the lock',async()=>{
 const f=rootFixture();
 try{
  const external=Shared.createUnprivilegedFixtureSharedGate(f.root);
  const existing=external.begin('native_backup_transaction');
  let invoked=0;
  const sys=Integrated.createUnprivilegedFixtureU06Integration(f.root,handlers(cap=>{
   invoked++;return {kind:cap.kind,terminal:true,evidence_sha256:SHA(cap.kind),production_mutated:false};
  }));
  for(const kind of Integrated.KINDS){
   await badAsync('busy_or_unrecovered',()=>sys.run(kind));
  }
  assert.equal(invoked,0);
  assert.equal(external.inspect().locked,true);
  external.finish(existing,existing.kind,{terminalProof:true});
 }finally{f.clean()}
});
test('operation failure retains the exact lease and refuses every subsequent callback',async()=>{
 const f=rootFixture();
 try{
  const sys=Integrated.createUnprivilegedFixtureU06Integration(f.root,handlers(async(cap)=>{
   if(cap.kind==='owner_evidence_consumption')throw Error('synthetic_callback_failure');
   return {kind:cap.kind,terminal:true,evidence_sha256:SHA(cap.kind),production_mutated:false};
  }));
  await badAsync('synthetic_callback_failure',()=>sys.run('owner_evidence_consumption'));
  assert.equal(sys.inspect().kind,'owner_evidence_consumption');
  for(const kind of Integrated.KINDS)await badAsync('busy_or_unrecovered',()=>sys.run(kind));
 }finally{f.clean()}
});
test('missing or insufficient terminal evidence never releases the shared lock',async()=>{
 for(const invalid of [
  null,{kind:'owner_challenge_issuance',terminal:true,evidence_sha256:SHA('ok'),production_mutated:true},
  {kind:'owner_challenge_issuance',terminal:false,evidence_sha256:SHA('ok'),production_mutated:false},
  {kind:'owner_evidence_staging',terminal:true,evidence_sha256:SHA('ok'),production_mutated:false}
 ]){
  const f=rootFixture();
  try{
   const sys=Integrated.createUnprivilegedFixtureU06Integration(f.root,handlers(async()=>invalid));
   await badAsync('terminal_evidence_required',()=>sys.run('owner_challenge_issuance'));
   assert.equal(sys.inspect().locked,true);
  }finally{f.clean()}
 }
});
test('unrecognized operation or incomplete handler map is rejected fail-closed',async()=>{
 const f=rootFixture();
 try{
  const handlersMap=handlers();
  delete handlersMap.native_backup_transaction;
  bad('all_five_handlers_required',()=>Integrated.createUnprivilegedFixtureU06Integration(f.root,handlersMap));
  const sys=Integrated.createUnprivilegedFixtureU06Integration(f.root,handlers());
  await badAsync('kind_unrecognized',()=>sys.run('generic_root_shell'));
  assert.equal(sys.inspect().locked,false);
 }finally{f.clean()}
});
test('eight concurrent ACTOR integrations result in exactly one callback executing',async()=>{
 const f=rootFixture();
 try{
  const js="const F=require("+JSON.stringify(modulePath)+");"+
   "const fs=require('node:fs'),path=require('node:path');"+
   "const root="+JSON.stringify(f.root)+";"+
   "const cb=Object.fromEntries(F.KINDS.map(k=>[k,async(cap)=>{cap.assertHeld();"+
   "fs.writeFileSync(path.join(root,'effect-'+k),k,{flag:'wx',mode:0o600});"+
   "await new Promise(r=>setTimeout(r,450));return {kind:k,terminal:true,evidence_sha256:'a'.repeat(64),production_mutated:false}}]));"+
   "F.createUnprivilegedFixtureU06Integration(root,cb).run('owner_evidence_staging').then(()=>process.stdout.write('WIN\\n')).catch(e=>{if(e.message==='u06_shared_lock_busy_or_unrecovered'){process.stdout.write('BUSY\\n')}else{process.stderr.write(e.stack);process.exitCode=2}})";
  const runs=Array.from({length:8},()=>new Promise((resolve,reject)=>{
   const proc=spawn(process.execPath,['-e',js],{stdio:['ignore','pipe','pipe']});
   let out='',err='';
   proc.stdout.on('data',b=>out+=b.toString());
   proc.stderr.on('data',b=>err+=b.toString());
   proc.on('error',reject);proc.on('close',exit=>resolve({exit,out,err}));
  }));
  const results=await Promise.all(runs);
  assert.ok(results.every(x=>x.exit===0),JSON.stringify(results));
  assert.equal(results.filter(x=>x.out.includes('WIN')).length,1,JSON.stringify(results));
  assert.equal(results.filter(x=>x.out.includes('BUSY')).length,7,JSON.stringify(results));
  assert.equal(fs.readFileSync(path.join(f.root,'effect-owner_evidence_staging'),'utf8'),'owner_evidence_staging');
 }finally{f.clean()}
});
test('SIGKILL inside integrated actor callback preserves fail-closed lease',async()=>{
 const f=rootFixture();
 try{
  const js="const F=require("+JSON.stringify(modulePath)+");"+
   "const root="+JSON.stringify(f.root)+";"+
   "const cb=Object.fromEntries(F.KINDS.map(k=>[k,async(cap)=>{"+
   "cap.assertHeld();process.kill(process.pid,'SIGKILL')} ]));"+
   "F.createUnprivilegedFixtureU06Integration(root,cb).run('expired_challenge_reconciliation')";
  const child=spawnSync(process.execPath,['-e',js],{encoding:'utf8',timeout:5000});
  assert.equal(child.signal,'SIGKILL');
  const sys=Integrated.createUnprivilegedFixtureU06Integration(f.root,handlers());
  assert.equal(sys.inspect().kind,'expired_challenge_reconciliation');
  for(const kind of Integrated.KINDS)await badAsync('busy_or_unrecovered',()=>sys.run(kind));
 }finally{f.clean()}
});
test('source-only module exports no privileged Root integration or CLI',()=>{
 assert.equal(Integrated.ROOT_ENTRYPOINT,false);
 assert.equal(Integrated.PRODUCTION_AUTHORIZED,false);
 assert.equal(Integrated.LEVEL4_ISSUER,false);
 assert.equal(Integrated.NATIVE_BACKUP_ENABLED,false);
 const r=spawnSync(process.execPath,[modulePath],{encoding:'utf8'});
 assert.equal(r.status,64);
 assert.match(r.stderr,/unprivileged fixtures only/);
});
