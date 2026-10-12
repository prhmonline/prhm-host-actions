'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const m=require('./rahekomak-host-action-typed-registration-bootstrap-v2.js');
const reg=require('./rahekomak-host-action-registration-v2.js');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const candidate=fs.readFileSync(path.join(__dirname,'rahekomak-host-action-typed-registration-bootstrap-v2.js'),'utf8');
const sandbox={require,module:{exports:{}},Buffer,process:{argv:['node','test-only'],stderr:{write(){}}}};
vm.runInNewContext(candidate+'\\n;__simulateTransaction=runApprovedTransaction;',sandbox,{
 filename:'isolated-regression-fixture',timeout:1000});
const simulateTransaction=sandbox.__simulateTransaction;

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function setup(cfg={}){
 const file=new Map(),original=new Map(),events=[],receipts=[];
 let attempt=0,failed=false;
 const steps=m.paths().map((target,i)=>{
   const before=i<4?Buffer.from('original-'+i):null;
   const bytes=Buffer.from('candidate-'+i);
   if(before)file.set(target,Buffer.from(before));
   original.set(target,before);
   return {key:String(i),target,previous:before,previous_sha:before?sha(before):null,
     bytes,next_sha:sha(bytes),mode:0o644,uid:0,gid:0,was_present:i<4};
 });
 const io={
   async acquireExclusive(){events.push('lock');return async()=>events.push('unlock')},
   async consumeSignedLevel4(){events.push('auth');return {
      trusted_dispatcher:!cfg.badAuth,signature_verified:true,one_time_consumed:true,
      action:m.ACTION,operation:m.OPERATION,source_commit:m.SOURCE_COMMIT,request_id:'test-unique'}},
   async hasReceipt(){return !!cfg.replay},
   statExact(p){return {exists:file.has(p),regular:file.has(p),symlink:false,realpath:p,mode:0o644,uid:0,gid:0}},
   readBytes(p){return file.get(p)},
   async backupExact(p,bytes){events.push('backup');assert.deepEqual(bytes,original.get(p))},
   async replaceAtomic(p,bytes){
      events.push('replace');file.set(p,Buffer.from(bytes));
      if(++attempt===cfg.failAt&&!failed){failed=true;throw Error('after_atomic_rename')}
   },
   async removeExact(p){events.push('remove');file.delete(p)},
   async reloadAndHealth(phase){events.push('health:'+phase);return {
     ok:!(cfg.badHealth&&phase==='candidate'),protect_home:'yes',
     actions:[reg.ACTION_STAGE,reg.ACTION_ACTIVATE]}},
   async persistReceipt(r){receipts.push(r);if(cfg.badReceipt&&r.status==='registration_installed')
      throw Error('receipt_commit_failed')}
 };
 function assertRestored(){for(const [path,b] of original.entries()){
    if(b)assert.deepEqual(file.get(path),b);
    else assert.equal(file.has(path),false);
 }}
 return {io,steps,events,receipts,assertRestored};
}
const plan=s=>({action:m.ACTION,operation:m.OPERATION,source_commit:m.SOURCE_COMMIT,steps:s});
test('exact 4+5 target allowlist; public API has NO test-only bypass',async()=>{
 assert.equal(Object.hasOwn(m,'_testTransactionOnly'),false);
 const h=setup();assert.equal(m.paths().length,9);
 assert.equal(new Set(m.paths()).size,9);
 await assert.rejects(m.applyFromTrustedDispatcher(h.io,plan(h.steps)),/owner_plan_preimage_invalid/);
 assert.equal(h.events.length,0);
});
test('signed consumed approval and replay gate happen before backups and writes',async()=>{
 for(const cfg of [{badAuth:true},{replay:true}]){
  const h=setup(cfg);
  await assert.rejects(simulateTransaction(h.io,plan(h.steps)),
    /trusted_signed_consumed_level4_required|registration_replay_forbidden/);
  h.assertRestored();assert.ok(!h.events.includes('replace'));
  assert.equal(h.events.at(-1),'unlock');
 }
});
test('success: all four backups precede nine atomic writes, positive health & receipt',async()=>{
 const h=setup(),r=await simulateTransaction(h.io,plan(h.steps));
 assert.equal(r.status,'registration_installed');assert.equal(r.changed.length,9);
 assert.equal(h.events.filter(x=>x==='backup').length,4);
 assert.ok(h.events.lastIndexOf('backup')<h.events.indexOf('replace'));
 assert.ok(h.events.includes('health:candidate'));assert.equal(h.events.at(-1),'unlock');
 assert.equal(r.application_deployed,false);
});
test('every write can fail AFTER rename: exact rollback of nine targets',async()=>{
 for(let n=1;n<=9;n++){
   const h=setup({failAt:n});
   await assert.rejects(simulateTransaction(h.io,plan(h.steps)),/registration_failed_rollback_complete/);
   h.assertRestored();assert.ok(h.events.includes('health:baseline'));
   assert.equal(h.receipts.at(-1).rollback_performed,true);
   assert.equal(h.events.at(-1),'unlock');
 }
});
test('candidate health and persistent receipt failures cause rollback',async()=>{
 for(const cfg of [{badHealth:true},{badReceipt:true}]){
   const h=setup(cfg);
   await assert.rejects(simulateTransaction(h.io,plan(h.steps)),/registration_failed_rollback_complete/);
   h.assertRestored();assert.ok(h.events.includes('health:baseline'));
 }
});
test('live byte drift fails before any backup or write',async()=>{
 const h=setup();h.io.readBytes=p=>Buffer.from('drifted');
 await assert.rejects(simulateTransaction(h.io,plan(h.steps)),/prewrite_drift/);
 assert.ok(!h.events.includes('replace'));assert.ok(!h.events.includes('backup'));
});
test('no standalone CLI mutation; sources pinned to fixed Git commit',()=>{
 assert.equal(m.SOURCE_COMMIT,'12d4c80011c723bf0f51defa6a515db30a432aa7');
 assert.throws(()=>m.prepare({}),/trusted_read_adapter_required/);
});
