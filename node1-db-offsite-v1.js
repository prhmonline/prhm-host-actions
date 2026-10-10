'use strict';
// Candidate only: invoked exclusively from a future SHA-bound, Level-4-gated service.
// Adapter is intentionally injected: importing this module cannot access a server.
const path=require('node:path');
const vm=require('./node1-live-vm-backup-v1');
const ROOT=vm.ROOT;
const CONF=Object.freeze({
  auth:'/etc/prhm-backup/node1-mariadb.cnf',
  password:'/etc/prhm-backup/node1-restic-password',
  remote:'rclone:gdrive-backup:PRHM-Backups/node1',
  dbBin:'/usr/bin/mariadb-dump',
  restic:'/usr/bin/restic'
});
function guard(b,e){if(!b)throw new Error(e)}
function snapshotDir(runId){vm.makePlan('prhm-production',runId,'file disk vda /var/lib/libvirt/images/prhm-production.qcow2');return path.join(ROOT,runId)}
function sqlDumpPlan(runId){
  const base=snapshotDir(runId),target=path.join(base,'mariadb','all-databases.sql');
  return Object.freeze({file:target,bin:CONF.dbBin,args:[
    '--defaults-extra-file='+CONF.auth,'--all-databases','--single-transaction',
    '--quick','--routines','--events','--triggers','--hex-blob','--set-charset'
  ]});
}
function objectEvidence(e,type){
  guard(e&&e.regular===true&&e.symlink===false&&Number.isSafeInteger(e.bytes)&&e.bytes>0,'invalid_'+type+'_artifact');
  guard(/^[0-9a-f]{64}$/.test(e.sha256||''),'unhashed_'+type+'_artifact');
  guard(Number.isInteger(e.mode)&&(e.mode&0o077)===0,'unsafe_'+type+'_permissions');
  return Object.freeze({bytes:e.bytes,sha256:e.sha256});
}
function exportMariaDb(runId,adapter){
  guard(adapter&&typeof adapter.exportToFile==='function'&&typeof adapter.artifact==='function','missing_database_adapter');
  const p=sqlDumpPlan(runId);
  // Export must stream directly to a root-owned 0600 regular file with no shell.
  // The adapter must use O_EXCL, and it must fail if any command exits nonzero.
  adapter.exportToFile(p.bin,p.args,p.file,{owner:'root',mode:0o600,noShell:true,createExclusive:true});
  const artifact=objectEvidence(adapter.artifact(p.file),'database');
  return Object.freeze({runId,file:p.file,...artifact,sql_replay_verified:false,nontransactional_tables_consistency_verified:false});
}
function evidenceVmSet(runId,evidences){
  guard(Array.isArray(evidences)&&evidences.length===2,'vm_backup_set_incomplete');
  const actual=evidences.map(x=>x.domain).sort();
  guard(actual.join(',')===Object.keys(vm.DOMAINS).sort().join(','),'vm_backup_set_mismatch');
  for(const e of evidences){
    guard(e.runId===runId&&e.status==='vm_disk_backup_captured','vm_backup_incomplete');
    guard(typeof e.artifact==='string'&&e.artifact.startsWith(path.join(snapshotDir(runId),'vm',e.domain)+'/'),'vm_backup_artifact_path_invalid');
    guard(/^[a-f0-9]{64}$/.test(e.sha256||'')&&e.bytes>0,'vm_backup_artifact_invalid');
  }
  return true;
}
function parseResticBackupSummary(output){
  const lines=String(output).split(/\r?\n/).filter(Boolean);
  const summaries=lines.map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(x=>x&&x.message_type==='summary');
  guard(summaries.length===1&&/^[a-f0-9]{64}$/.test(summaries[0].snapshot_id||''),'restic_summary_missing');
  return summaries[0].snapshot_id;
}
function parseResticSnapshotIdentity(output,snapshotId,tag){
  let array;try{array=JSON.parse(String(output))}catch{guard(false,'restic_snapshot_list_invalid')}
  guard(Array.isArray(array)&&array.some(x=>x.id===snapshotId&&Array.isArray(x.tags)&&x.tags.includes(tag)),'remote_snapshot_not_confirmed');
  return true;
}
function encryptedOffsite(runId,vmEvidences,dbEvidence,adapter){
  guard(adapter&&typeof adapter.run==='function','missing_restic_adapter');
  evidenceVmSet(runId,vmEvidences);
  guard(dbEvidence?.runId===runId&&dbEvidence.file===sqlDumpPlan(runId).file,'database_dump_missing');
  objectEvidence({regular:true,symlink:false,mode:0o600,bytes:dbEvidence.bytes,sha256:dbEvidence.sha256},'database');
  guard(adapter.secretFileValid?.(CONF.password)===true,'restic_secret_not_secure');
  guard(adapter.remoteIdentityVerified?.(CONF.remote)===true,'remote_identity_not_verified');
  const tag='node1-'+runId;
  const sources=['/etc','/home','/usr/local/directadmin',path.join(snapshotDir(runId),'vm'),dbEvidence.file];
  const base=['--repo',CONF.remote,'--password-file',CONF.password];
  const snapshotId=parseResticBackupSummary(adapter.run(CONF.restic,[...base,'backup','--json','--tag',tag,'--one-file-system',...sources]));
  parseResticSnapshotIdentity(adapter.run(CONF.restic,[...base,'snapshots','--json','--tag',tag]),snapshotId,tag);
  const check=adapter.run(CONF.restic,[...base,'check','--read-data-subset=10%']);
  guard(typeof check==='string','offsite_sample_check_unverified');
  return Object.freeze({runId,snapshotId,encrypted_by:'restic',target:CONF.remote,remote_snapshot_confirmed:true,integrity_sample_checked:true,full_integrity_verified:false,sql_replay_verified:false,vm_boot_restore_verified:false});
}
function closureGate(e){
  const gates=['backup_pass','offsite_pass','restore_pass','central_capacity_preflight_pass','sql_replay_verified','vm_boot_restore_verified','offsite_full_integrity_verified','closed'];
  const missing=gates.filter(k=>e?.[k]!==true);
  return Object.freeze({ok:missing.length===0,missing,fail_closed:missing.length>0});
}
module.exports={CONF,sqlDumpPlan,objectEvidence,exportMariaDb,evidenceVmSet,parseResticBackupSummary,parseResticSnapshotIdentity,encryptedOffsite,closureGate};
