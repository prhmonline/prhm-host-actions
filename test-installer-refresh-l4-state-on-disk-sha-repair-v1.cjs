'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const C=require('./installer-refresh-l4-state-on-disk-sha-repair-v1.cjs');
const source=fs.readFileSync(C.SOURCE);
const reviewed=C.deriveReviewedBytes(source);
const validRelease='0123456789abcdef0123456789abcdef01234567';
const reqId='6bff7a18-4f56-4d68-bb66-7b1ca263ac82';
function simulator(opts={}){
  let data=Buffer.from(reviewed.old),backup=null,lock=0,write=0,restore=0;
  const audits=[];
  const adapter={
    async assertConsumedSignedLevel4(request){
      return {...request,signed:opts.unsigned!==true,consumed:true,one_time:true,
        level:4,approver:'mohammad',request_id:reqId,
        reviewed_release_sha:opts.wrongRelease?'f'.repeat(40):validRelease,
        target_sha256:opts.wrongSha?'f'.repeat(64):request.target_sha256};
    },
    async assertReviewedRelease(sha){return sha===validRelease;},
    async exclusiveLock(){lock++;return ()=>lock--;},
    async state(){return {regular:true,symlink:opts.symlink===true,sha256:C.hash(data),
      uid:0,gid:0,mode:0o600};},
    async read(){return Buffer.from(data);},
    async saveDurableBackup(_,before){
      backup=Buffer.from(before);return {durable:true,sha256:C.hash(backup)};
    },
    async atomicWrite(_,next){
      data=Buffer.from(next);write++;
      if(opts.fail==='write')throw Error('simulated_partial_write');
    },
    async checkInstallerPreflight(){
      if(opts.fail==='preflight')return {ok:false};
      return {ok:true,live_sha256:C.TO_SHA,read_only:true};
    },
    async restore(_,handle){assert.equal(handle?.durable,true);restore++;
      data=Buffer.from(backup);},
    async recordAudit(record){
      audits.push(record);
      if(opts.fail==='audit'&&record.ok)throw Error('simulated_audit_failure');
    }
  };
  return {adapter,audits,stats:()=>({data,backup,lock,write,restore})};
}
test('actual reviewed source template reconstructs EXACT live and target SHA',()=>{
  assert.equal(C.hash(reviewed.old),C.FROM_SHA);
  assert.equal(C.hash(reviewed.target),C.TO_SHA);
  assert.equal(reviewed.target.toString().split(C.NEW).length,2);
  assert.equal(reviewed.old.toString().split(C.OLD).length,2);
  const plan=C.plan(source,C.FROM_SHA);
  assert.equal(plan.changes_count,1);
  assert.equal(plan.execute_authorized,false);
  assert.equal(plan.expected_mode,0o600);
  assert.throws(()=>C.plan(source,'f'.repeat(64)),/actual_live_sha_drift/);
  assert.throws(()=>C.deriveReviewedBytes(Buffer.from('tampered')),
    /reviewed_source_anchor_missing_or_duplicate/);
});
test('signed approval + reviewed release are required before any writes',async()=>{
 for(const o of [{unsigned:true},{wrongRelease:true},{wrongSha:true}]){
   const m=simulator(o);
   await assert.rejects(C.applySigned(C.plan(source),m.adapter),
    /signed_level4_binding_invalid|reviewed_release_not_verified/);
   assert.deepEqual(m.stats().data,reviewed.old);
   assert.equal(m.stats().write,0);
 }
});
test('reject on-disk symlinks even if the file has the correct SHA',async()=>{
 const m=simulator({symlink:true});
 await assert.rejects(C.applySigned(C.plan(source),m.adapter),
   /on_disk_preimage_mismatch/);
 assert.equal(m.stats().write,0);
});
test('fixed change succeeds in isolated simulation and preserves single file scope',async()=>{
 const m=simulator();
 const r=await C.applySigned(C.plan(source),m.adapter);
 assert.equal(r.ok,true);
 assert.equal(r.sha256_before,C.FROM_SHA);
 assert.equal(r.sha256_after,C.TO_SHA);
 assert.equal(r.production_database_mutation,false);
 assert.equal(r.other_files_changed,0);
 assert.deepEqual(m.stats().data,reviewed.target);
 assert.equal(m.stats().write,1);
 assert.equal(m.stats().restore,0);
 assert.equal(m.stats().lock,0);
});
test('partial write, failed live preflight, audit failure ALL restore exact old SHA',async()=>{
 for(const fail of ['write','preflight','audit']){
   const m=simulator({fail});
   await assert.rejects(C.applySigned(C.plan(source),m.adapter),/repair_failed/);
   assert.equal(C.hash(m.stats().data),C.FROM_SHA);
   assert.deepEqual(m.stats().data,reviewed.old);
   assert.equal(m.stats().write,1);
   assert.equal(m.stats().restore,1);
   assert.equal(m.stats().lock,0);
   assert.equal(m.audits.at(-1).rollback_performed,true);
 }
});
test('tampered plan does not reach a trusted installer',async()=>{
 const m=simulator();
 const p={...C.plan(source),current_sha256:'f'.repeat(64)};
 await assert.rejects(C.applySigned(p,m.adapter),/plan_identity_mismatch/);
 assert.equal(m.stats().write,0);
});
