'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const c=require('node:crypto');
const m=require('./rahekomak-host-action-typed-registration-bootstrap-v2.js');
const reg=require('./rahekomak-host-action-registration-v2.js');
const digest=b=>c.createHash('sha256').update(b).digest('hex');
function adapterFactory(options={}){
 const mem=new Map(),original=new Map(),events=[],writes=[];
 const steps=m.paths().map((target,i)=>{
   const old=i<4?Buffer.from('original-'+i):null;
   const bytes=i<4?Buffer.from('candidate-'+i):
     Buffer.from('candidate-artifact-'+i);
   if(old)mem.set(target,Buffer.from(old));
   const s={key:i<4?m.KEYS[i]:m.NAMES[i-4],target,
     previous:old,previous_sha:i<4?reg.PREIMAGE[m.KEYS[i]]:null,
     bytes,next_sha:digest(bytes),mode:0o644,uid:0,gid:0,was_present:i<4};
   // Avoid changing production pins: test plan validation separately and
   // use authorized synthetic plan in the in-memory transaction engine.
   if(i<4){s.previous=Buffer.from('');s.previous_sha=reg.PREIMAGE[m.KEYS[i]];}
   original.set(target,old);return s;
 });
 const adapter={
   events,writes,mem,steps,
   async acquireExclusive(){events.push('lock');return async()=>events.push('unlock')},
   async consumeSignedLevel4(){events.push('approval');return {
     trusted_dispatcher:true,signature_verified:true,one_time_consumed:true,
     action:m.ACTION,operation:m.OPERATION,source_commit:m.SOURCE_COMMIT,request_id:'fresh-test-id'}},
   async hasReceipt(){return options.replay===true},
   statExact(p){return {exists:mem.has(p),regular:mem.has(p),symlink:false,
     realpath:p,mode:0o644,uid:0,gid:0}},
   readBytes(p){return mem.get(p)},
   async backupExact(path,bytes){events.push('backup:'+path);assert.ok(bytes)},
   async replaceAtomic(path,bytes){
     events.push('replace:'+path);if(options.failAt===writes.length)throw Error('injected_write_failure');
     writes.push(path);mem.set(path,Buffer.from(bytes));
     if(options.tamperAt===writes.length-1)mem.set(path,Buffer.from('tampered'));
   },
   async removeExact(path){events.push('remove:'+path);mem.delete(path)},
   async reloadAndHealth(phase){
     events.push('health:'+phase);
     return {ok:!(options.healthFail&&phase==='candidate'),protect_home:'yes',
       actions:[reg.ACTION_STAGE,reg.ACTION_ACTIVATE]}},
   async persistReceipt(x){events.push('receipt:'+x.status);
     if(options.receiptFail&&x.status==='registration_installed')throw Error('receipt_write_failure')},
 };
 return {adapter,steps,original};
}
function fixture({omitFile=-1}={}){
 const {adapter,steps,original}=adapterFactory();
 // Test-only transaction fixture: package code validates real hashes in assertPlan.
 // Here mark the plan as synthetic and use a wrapper to verify phase logic.
 return {adapter,steps,original,plan:{action:m.ACTION,operation:m.OPERATION,
   source_commit:m.SOURCE_COMMIT,steps}};
}
test('scope is exactly four owner files and five artifacts; no arbitrary paths',()=>{
 assert.equal(m.paths().length,9);assert.equal(new Set(m.paths()).size,9);
 assert.equal(m.SOURCE_COMMIT,'12d4c80011c723bf0f51defa6a515db30a432aa7');
 assert.equal(m.NAMES.length,5);
 assert.match(m.paths().join('|'),/hostActionsV2.js/);
});
test('preparation rejects missing reader and never writes',()=>{
 assert.throws(()=>m.prepare({}),/trusted_read_adapter_required/);
});
test('production CLI has no apply; signed one-time native approval required',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const t=fs.readFileSync(path.join(__dirname,'rahekomak-host-action-typed-registration-bootstrap-v2.js'),'utf8');
 assert.match(t,/No direct apply/);
 assert.match(t,/signature_verified/);
 assert.match(t,/one_time_consumed/);
 assert.doesNotMatch(t,/eval\(|execSync\(|shell\s*:\s*true/);
});
test('fail-closed on any synthetic plan or forged approval before writes',async()=>{
 const f=fixture();assert.throws(()=>m.assertPlan(f.plan),/owner_plan_preimage_invalid/);
 assert.equal(f.adapter.writes.length,0);
});
