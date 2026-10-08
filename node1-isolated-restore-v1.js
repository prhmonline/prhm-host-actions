'use strict';
// Recovery contract for a disposable, offline sandbox. No host-facing CLI or default backend.
// Exact approved Git SHA and Level-4 boundary must be enforced outside this candidate.
const path=require('node:path');
const offsite=require('./node1-db-offsite-v1');
const vm=require('./node1-live-vm-backup-v1');
const STAGE='/var/lib/prhm-backup/node1/staging';
const RESTORE='/var/lib/prhm-backup/node1/restore-sandbox';
const GATES=Object.freeze(['restic_full_integrity','remote_snapshot_present','database_replayed','vm_prhm_production_boot','vm_imotion_directadmin_boot','sandbox_destroyed']);
function assert(v,reason){if(!v)throw Error(reason)}
function runValid(id){assert(/^20[0-9]{6}T[0-9]{6}Z$/.test(id),'invalid_run_id');return id}
function buildPlan({runId,snapshotId,dbSha,vmShas}){
 runValid(runId);
 assert(/^[0-9a-f]{64}$/.test(snapshotId||''),'snapshot_id_invalid');
 assert(/^[0-9a-f]{64}$/.test(dbSha||''),'db_digest_invalid');
 assert(vmShas&&Object.keys(vmShas).sort().join(',')===Object.keys(vm.DOMAINS).sort().join(','),'vm_set_invalid');
 assert(Object.values(vmShas).every(x=>/^[0-9a-f]{64}$/.test(x)),'vm_digest_invalid');
 const root=path.posix.join(RESTORE,runId);
 function restored(origin){assert(origin.startsWith(STAGE+'/'+runId+'/'),'origin_outside_run');return root+origin}
 const dbOrigin=offsite.sqlDumpPlan(runId).file;
 const disks=Object.fromEntries(Object.keys(vm.DOMAINS).sort().map(domain=>{
    const origin=path.posix.join(STAGE,runId,'vm',domain,'vda.qcow2');
    return [domain,Object.freeze({source:origin,restored:restored(origin),sha256:vmShas[domain]})];
 }));
 return Object.freeze({schema_version:'prhm.node1-isolated-restore-plan.v1',runId,snapshotId,remote:offsite.CONF.remote,root,db:Object.freeze({source:dbOrigin,restored:restored(dbOrigin),sha256:dbSha}),disks:Object.freeze(disks),network:'none',scratchMode:'exclusive',productionAttached:false});
}
function verifyRecovered(meta,sha,label){
 assert(meta&&meta.regular===true&&meta.symlink===false,'restored_file_invalid:'+label);
 assert(meta.sha256===sha,'restored_checksum_mismatch:'+label);
 assert(Number.isSafeInteger(meta.bytes)&&meta.bytes>0,'restored_size_invalid:'+label);
}
function validSqlReceipt(value){
 assert(value?.result==='pass'&&value.network==='none'&&value.disposable===true&&value.productionDsnUsed===false&&value.schemasRestored>0&&value.sqlValidation==='pass','isolated_sql_replay_failed');
 return true;
}
function validVmReceipt(value,domain){
 assert(value?.domain===domain&&value.result==='pass'&&value.network==='none'&&value.disposable===true&&value.sourceReadOnly===true&&value.productionDomainTouched===false&&value.guestBootObserved===true,'isolated_vm_boot_failed:'+domain);
 return true;
}
function restoreIndependently(plan,adapter){
 assert(plan?.schema_version==='prhm.node1-isolated-restore-plan.v1'&&plan.root===path.posix.join(RESTORE,runValid(plan.runId)),'invalid_restore_plan');
 assert(adapter&&['prepare','fullRepoCheck','restoreSnapshot','statHash','replaySql','bootVm','destroy'].every(k=>typeof adapter[k]==='function'),'restore_adapter_missing');
 let prepared=false,proof=null,cleanup=false,primaryError=null;
 try {
   const p=adapter.prepare(plan);
   assert(p?.exclusive===true&&p.root===plan.root&&p.network==='none'&&p.realpathConfined===true&&p.productionMounts===false,'sandbox_isolation_unverified');
   prepared=true;
   const check=adapter.fullRepoCheck({repo:plan.remote,passwordFile:offsite.CONF.password,readData:true});
   assert(check?.verified===true&&check.readDataFull===true&&check.repo===plan.remote,'restic_full_check_failed');
   const snap=adapter.restoreSnapshot({repo:plan.remote,snapshotId:plan.snapshotId,target:plan.root,passwordFile:offsite.CONF.password,network:'none'});
   assert(snap?.ok===true&&snap.snapshotId===plan.snapshotId&&snap.root===plan.root,'remote_restore_failed');
   verifyRecovered(adapter.statHash(plan.db.restored),plan.db.sha256,'database');
   for(const domain of Object.keys(plan.disks))verifyRecovered(adapter.statHash(plan.disks[domain].restored),plan.disks[domain].sha256,domain);
   validSqlReceipt(adapter.replaySql({source:plan.db.restored,network:'none',disposable:true,root:plan.root}));
   for(const domain of Object.keys(plan.disks))
     validVmReceipt(adapter.bootVm({domain,image:plan.disks[domain].restored,network:'none',overlay:'disposable',sourceReadOnly:true,root:plan.root}),domain);
   proof={restic_full_integrity:true,remote_snapshot_present:true,database_replayed:true,vm_prhm_production_boot:true,vm_imotion_directadmin_boot:true};
 } catch(e){primaryError=e}
 finally {
   if(prepared){
     try {const r=adapter.destroy({root:plan.root,onlyDisposable:true});
       cleanup=r?.sandboxDestroyed===true&&r.root===plan.root&&r.productionTouched===false;
     }catch{}
   }
 }
 assert(cleanup,'restore_sandbox_cleanup_unverified');
 if(primaryError)throw primaryError;
 assert(proof!==null,'restore_evidence_missing');
 return Object.freeze({schema_version:'prhm.node1-isolated-restore-evidence.v1',runId:plan.runId,snapshotId:plan.snapshotId,read_only_on_production:true,disposable_sandbox:plan.root,isolated_restore_pass:true,...proof,sandbox_destroyed:true,closed:false});
}
function closureFromEvidence(backup,offsiteEvidence,restoreEvidence,preflight){
 const gates={
   backup_pass:backup?.backup_pass===true,
   offsite_pass:offsiteEvidence?.remote_snapshot_confirmed===true,
   restore_pass:restoreEvidence?.isolated_restore_pass===true,
   central_capacity_preflight_pass:preflight?.central_capacity_preflight_pass===true,
   sql_replay_verified:restoreEvidence?.database_replayed===true,
   vm_boot_restore_verified:restoreEvidence?.vm_prhm_production_boot===true&&restoreEvidence?.vm_imotion_directadmin_boot===true,
   offsite_full_integrity_verified:restoreEvidence?.restic_full_integrity===true,
   closed:restoreEvidence?.sandbox_destroyed===true
 };
 return Object.freeze({gates,...offsite.closureGate(gates)});
}
module.exports={STAGE,RESTORE,GATES,buildPlan,verifyRecovered,validSqlReceipt,validVmReceipt,restoreIndependently,closureFromEvidence};
