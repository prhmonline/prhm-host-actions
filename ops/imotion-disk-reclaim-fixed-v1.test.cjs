'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const v=require('./imotion-disk-reclaim-fixed-v1.cjs');
const H='a'.repeat(64);
const ID='b'.repeat(64);
function cap({offsite=true,broken=false}={}) {
  let free=100;
  const calls=[];
  const cache={id:ID,kind:'docker_build_cache',bytes:200,age_days:15,
    reclaimable:true,in_use:false,symlink:false,sha256:H};
  const log={id:'/var/log/httpd/app.log.3.gz',kind:'rotated_log',bytes:50,age_days:40,
    reclaimable:true,in_use:false,symlink:false,sha256:H};
  return {
    calls,cache,log,
    probeDisk:async()=>({total_bytes:1000,used_bytes:1000-free,free_bytes:free}),
    probeDocker:async()=>broken?new Promise((_,r)=>r(Error('timed out'))):
      ({complete:true,bytes:400,candidates:[cache]}),
    probeBackups:async()=>({complete:true,bytes:150,latest_local_success:true,latest_offsite_success:offsite}),
    probeLogs:async()=>({complete:true,bytes:80,candidates:[log]}),
    probeHealth:async()=>({healthy:true}),
    getApprovalReceipt:async req=>{calls.push('approval');return {authorized:true,level:4,
      action:v.ACTION,plan_sha256:req.plan_sha256,one_time_use:true};},
    consumeApproval:async()=>{calls.push('consume');return {ok:true};},
    reclaimBuildCache:async()=>{free+=200;calls.push('cache');return {ok:true,bytes:200};},
    removeRotatedLog:async()=>{free+=50;calls.push('log');return {ok:true,bytes:50};}
  };
}
test('inventory is fixed host, typed and no cleanup by default',async()=>{
 const c=cap(),i=await v.collect(c);
 assert.equal(i.complete,true);
 assert.equal(i.cleanup_enabled,false);
 assert.equal(i.host,'imotion-prod-vm');
 assert.equal(c.calls.length,0);
 const plan=v.reviewPlan(i,[ID]);
 assert.equal(plan.approved,false);
 assert.equal(plan.executed,false);
 assert.equal(plan.approval_level,4);
});
test('incomplete bounded scan cannot produce cleanup plan',async()=>{
 const i=await v.collect(cap({broken:true}));
 assert.equal(i.complete,false);
 assert.throws(()=>v.reviewPlan(i,[ID]),/inventory_incomplete/);
});
test('cache cleanup requires fresh exact plan SHA and trusted consumed L4',async()=>{
 const c=cap(),i=await v.collect(c),plan=v.reviewPlan(i,[ID]);
 const r=await v.executeApproved(plan,c);
 assert.equal(r.status,'completed');
 assert.equal(r.before_bytes,100);
 assert.equal(r.after_bytes,300);
 assert.deepEqual(c.calls,['approval','consume','cache']);
 assert.equal(r.backup_files_deleted,false);
 assert.equal(r.volumes_deleted,false);
});
test('no offsite backup blocks rotated log cleanup even when local backup succeeds',async()=>{
 const c=cap({offsite:false}),i=await v.collect(c);
 assert.throws(()=>v.reviewPlan(i,[c.log.id]),/log_retention_or_offsite_block/);
 assert.doesNotThrow(()=>v.reviewPlan(i,[ID]));
});
test('refuses arbitrary paths, old backups, volumes, in-use cache, symlinks and young files',async()=>{
 const c=cap(),i=await v.collect(c);
 for(const id of ['/var/backups/backup.tar','/var/lib/docker/volumes/mydb','../../etc/passwd']){
   assert.throws(()=>v.reviewPlan(i,[id]),/candidate_not_safe/);
 }
 const d=cap();d.cache.in_use=true;
 await assert.rejects(async()=>v.reviewPlan(await v.collect(d),[ID]),/candidate_not_safe/);
 const e=cap();e.cache.age_days=3;
 await assert.rejects(async()=>v.reviewPlan(await v.collect(e),[ID]),/cache_too_new/);
 const f=cap();f.log.symlink=true;
 await assert.rejects(()=>v.collect(f),/candidate_schema/);
});
test('forged plan, changed snapshot, and unconsumed approval fail closed',async()=>{
 const c=cap(),i=await v.collect(c),p=v.reviewPlan(i,[ID]);
 await assert.rejects(()=>v.executeApproved({...p,bytes_max:999},c),/plan_hash_drift/);
 c.cache.bytes=199;
 await assert.rejects(()=>v.executeApproved(p,c),/preimage_changed/);
 const d=cap(),j=await v.collect(d),q=v.reviewPlan(j,[ID]);
 d.getApprovalReceipt=async()=>({authorized:false});
 await assert.rejects(()=>v.executeApproved(q,d),/level4_not_authorized/);
 assert.equal(d.calls.length,0);
});
test('missing trusted capability and duplicate selection cannot be used as backdoor',async()=>{
 const c=cap(),i=await v.collect(c);
 assert.throws(()=>v.reviewPlan(i,[ID,ID]),/selection_invalid/);
 delete c.reclaimBuildCache;
 await assert.rejects(()=>v.collect(c),/trusted_capability_missing_reclaimBuildCache/);
});
