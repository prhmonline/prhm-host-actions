'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./node1-isolated-restore-v1');
const RUN='20261008T154100Z',SH='a'.repeat(64),DB='b'.repeat(64),V1='c'.repeat(64),V2='d'.repeat(64);
function plan(){return h.buildPlan({runId:RUN,snapshotId:SH,dbSha:DB,vmShas:{'prhm-production':V1,'imotion-directadmin':V2}})}
function adapter(p,opts={}){
 const calls=[];
 const a={
   calls,
   prepare(x){calls.push('prepare');return {exclusive:true,root:x.root,network:'none',realpathConfined:true,productionMounts:false}},
   fullRepoCheck(x){calls.push('full');return {verified:true,readDataFull:!opts.partialCheck,repo:x.repo}},
   restoreSnapshot(x){calls.push('restore');return {ok:!opts.restoreFailed,snapshotId:x.snapshotId,root:x.target}},
   statHash(x){calls.push('hash');const sha=x===p.db.restored?DB:x===p.disks['prhm-production'].restored?V1:V2;return {regular:true,symlink:!!opts.symlink,bytes:10,sha256:opts.badHash?'0'.repeat(64):sha}},
   replaySql(){calls.push('sql');return{result:opts.sqlFailed?'fail':'pass',network:'none',disposable:true,productionDsnUsed:false,schemasRestored:1,sqlValidation:'pass'}},
   bootVm(x){calls.push('vm:'+x.domain);return {domain:x.domain,result:'pass',network:opts.vmNetwork||'none',disposable:true,sourceReadOnly:true,productionDomainTouched:false,guestBootObserved:!opts.bootFailed}},
   destroy(x){calls.push('destroy');return{root:x.root,sandboxDestroyed:!opts.cleanupFailed,productionTouched:false}}
 };
 return a;
}
test('manifest is fixed to exact two known VM images and unique restore root',()=>{
 const p=plan();assert.equal(p.network,'none');assert.equal(p.productionAttached,false);
 assert(p.root.endsWith('/restore-sandbox/'+RUN));
 assert(p.db.restored.startsWith(p.root+'/var/lib/prhm-backup/node1/staging/'+RUN));
 assert.deepEqual(Object.keys(p.disks),['imotion-directadmin','prhm-production']);
});
test('rejects traversal run ID, invalid snapshot and omitted VM',()=>{
 assert.throws(()=>h.buildPlan({runId:'../../etc',snapshotId:SH,dbSha:DB,vmShas:{'prhm-production':V1,'imotion-directadmin':V2}}),/invalid_run_id/);
 assert.throws(()=>h.buildPlan({runId:RUN,snapshotId:'latest',dbSha:DB,vmShas:{'prhm-production':V1,'imotion-directadmin':V2}}),/snapshot_id_invalid/);
 assert.throws(()=>h.buildPlan({runId:RUN,snapshotId:SH,dbSha:DB,vmShas:{'prhm-production':V1}}),/vm_set_invalid/);
});
test('successful offline full-restic+SQL+two isolated VM boots records evidence after cleanup',()=>{
 const p=plan(),a=adapter(p),r=h.restoreIndependently(p,a);
 assert.equal(r.restic_full_integrity,true);assert.equal(r.database_replayed,true);
 assert.equal(r.vm_prhm_production_boot,true);assert.equal(r.vm_imotion_directadmin_boot,true);
 assert.equal(r.sandbox_destroyed,true);assert.equal(r.closed,false);
 assert.deepEqual(a.calls,['prepare','full','restore','hash','hash','hash','sql','vm:imotion-directadmin','vm:prhm-production','destroy']);
});
test('fails closed when repository integrity is only sampled',()=>{
 const p=plan(),a=adapter(p,{partialCheck:true});
 assert.throws(()=>h.restoreIndependently(p,a),/restic_full_check_failed/);
 assert.deepEqual(a.calls,['prepare','full','destroy']);
});
test('fails closed when restored checksum differs',()=>{
 const p=plan(),a=adapter(p,{badHash:true});
 assert.throws(()=>h.restoreIndependently(p,a),/restored_checksum_mismatch/);
 assert(a.calls.includes('destroy'));assert(!a.calls.includes('sql'));
});
test('refuses SQL replay failure and still destroys sandbox',()=>{
 const p=plan(),a=adapter(p,{sqlFailed:true});
 assert.throws(()=>h.restoreIndependently(p,a),/isolated_sql_replay_failed/);
 assert.equal(a.calls.at(-1),'destroy');
});
test('refuses VM boot with network and refuses unproven boot',()=>{
 for(const opts of [{vmNetwork:'bridge'},{bootFailed:true}]){
  const p=plan(),a=adapter(p,opts);
  assert.throws(()=>h.restoreIndependently(p,a),/isolated_vm_boot_failed/);
  assert.equal(a.calls.at(-1),'destroy');
 }
});
test('does not label backup complete when sandbox cleanup fails',()=>{
 const p=plan(),a=adapter(p,{cleanupFailed:true});
 assert.throws(()=>h.restoreIndependently(p,a),/restore_sandbox_cleanup_unverified/);
});
test('missing sandbox isolation refuses any remote operations',()=>{
 const p=plan(),a=adapter(p);a.prepare=()=>({exclusive:true,root:p.root,network:'bridge',realpathConfined:true,productionMounts:false});
 assert.throws(()=>h.restoreIndependently(p,a),/restore_sandbox_cleanup_unverified/);
 assert.equal(a.calls.length,0);
});
test('closure requires every independently verified backup/offsite/replay gate',()=>{
 const p=plan(),r=h.restoreIndependently(p,adapter(p));
 const c=h.closureFromEvidence({backup_pass:true},{remote_snapshot_confirmed:true},r,{central_capacity_preflight_pass:true});
 assert.equal(c.ok,true);
 assert.equal(h.closureFromEvidence({backup_pass:true},{remote_snapshot_confirmed:true},r,{central_capacity_preflight_pass:false}).ok,false);
});
