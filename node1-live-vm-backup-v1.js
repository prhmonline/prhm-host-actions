'use strict';
// Candidate orchestration module only: no executable CLI, no production activation.
// Requires an approved, SHA-bound installer/Host Action and a separately reviewed adapter.
const path=require('node:path');
const ROOT='/var/lib/prhm-backup/node1/staging';
const DOMAINS=Object.freeze({
  'prhm-production':Object.freeze({target:'vda',source:'/var/lib/libvirt/images/prhm-production.qcow2'}),
  'imotion-directadmin':Object.freeze({target:'vda',source:'/var/lib/libvirt/images/imotion-directadmin.qcow2'})
});
const GIB=1024**3;
function invariant(ok,code){if(!ok)throw new Error(code)}
function xmlSafe(s){return String(s).replace(/&/g,'&amp;').replace(/'/g,'&apos;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function validateRunId(s){invariant(/^20\d{6}T\d{6}Z$/.test(s),'invalid_run_id');return s}
function parseDiskLines(stdout){
  const lines=String(stdout).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const entries=lines.filter(s=>/^(file|block)\s+disk\s+/.test(s)).map(s=>{
    const m=s.match(/^(file|block)\s+disk\s+(\S+)\s+(\S+)$/);
    invariant(!!m,'disk_inventory_malformed');
    return {type:m[1],target:m[2],source:m[3]};
  });
  return entries;
}
function makePlan(domain,runId,diskListing){
  validateRunId(runId); const def=DOMAINS[domain];
  invariant(!!def,'domain_not_allowlisted');
  const disks=parseDiskLines(diskListing);
  invariant(disks.length===1,'unexpected_disk_count');
  invariant(disks[0].type==='file'&&disks[0].target===def.target&&disks[0].source===def.source,'unexpected_vm_disk_source');
  const dir=path.join(ROOT,runId,'vm',domain);
  const target=path.join(dir,'vda.qcow2');
  const xml=path.join(dir,'backup.xml');
  const body="<domainbackup mode='push'><disks><disk name='"+xmlSafe(def.target)+"' type='file' backup='yes'><target file='"+xmlSafe(target)+"'/><driver type='qcow2'/></disk></disks></domainbackup>\n";
  return Object.freeze({domain,runId,dir,xml,target,body,source:def.source});
}
function capacityGate({freeBytes,vmVirtualBytes,holdbackBytes=80*GIB}){
  invariant(Number.isSafeInteger(freeBytes)&&freeBytes>=0,'free_space_unverified');
  invariant(Number.isSafeInteger(vmVirtualBytes)&&vmVirtualBytes>0,'disk_virtual_size_unverified');
  const required=Math.ceil(vmVirtualBytes*1.15)+holdbackBytes;
  return Object.freeze({ok:freeBytes>=required,freeBytes,requiredBytes:required,holdbackBytes,can_start:freeBytes>=required});
}
function checkCompleted(stdout){
  const s=String(stdout);
  invariant(/Job type:\s*Completed\b/.test(s),'backup_completion_not_recorded');
  invariant(/Operation:\s*Backup\b/.test(s),'completed_job_not_backup');
  invariant(/File remaining:\s*0(?:\.0+)?\s*(?:B|KiB|MiB|GiB)/.test(s),'backup_not_fully_copied');
  return true;
}
function checkNoActiveJob(stdout){invariant(/Job type:\s*None\b/.test(String(stdout)),'another_domain_job_active');return true}
function assertAdapter(adapter){
  invariant(adapter && typeof adapter.command==='function' && typeof adapter.createOutput==='function' && typeof adapter.artifact==='function','adapter_missing');
  return adapter;
}
function executeDomainBackup({domain,runId,adapter,freeBytes,vmVirtualBytes,timeoutPolls=1440}){
  assertAdapter(adapter);
  invariant(Number.isInteger(timeoutPolls)&&timeoutPolls>=1&&timeoutPolls<=1440,'invalid_poll_budget');
  // Stage capacity is checked against VM *virtual* size; no unsupported best-effort fallbacks.
  const c=capacityGate({freeBytes,vmVirtualBytes});
  invariant(c.ok,'capacity_preflight_failed');
  const listing=adapter.command('/usr/bin/virsh',['domblklist',domain,'--details']);
  const plan=makePlan(domain,runId,listing);
  checkNoActiveJob(adapter.command('/usr/bin/virsh',['domjobinfo',domain]));
  const state=String(adapter.command('/usr/bin/virsh',['domstate',domain])).trim();
  invariant(state==='running','vm_not_running');
  adapter.createOutput(plan.dir,plan.xml,plan.body);
  let freezeAttempted=false;
  let beginStarted=false;
  let thawError;
  try{
    freezeAttempted=true;
    adapter.command('/usr/bin/virsh',['domfsfreeze',domain]);
    adapter.command('/usr/bin/virsh',['backup-begin',domain,plan.xml]);
    beginStarted=true;
  }finally{
    if(freezeAttempted){
      try{adapter.command('/usr/bin/virsh',['domfsthaw',domain])}
      catch(e){thawError=e}
    }
  }
  invariant(!thawError,'guest_thaw_unverified');
  invariant(beginStarted,'backup_start_unverified');
  let completed=false;
  for(let i=0;i<timeoutPolls;i++){
    const stat=String(adapter.command('/usr/bin/virsh',['domjobinfo',domain]));
    if(/Job type:\s*None\b/.test(stat)){completed=true;break;}
    invariant(/Job type:\s*(?:Backup|Running|Unbounded|Completed)\b/.test(stat),'unexpected_backup_job_state');
    if(typeof adapter.poll==='function') adapter.poll(i);
  }
  invariant(completed,'backup_timeout_or_active_job');
  checkCompleted(adapter.command('/usr/bin/virsh',['domjobinfo',domain,'--completed']));
  const meta=adapter.artifact(plan.target);
  invariant(meta?.regular===true&&meta?.symlink===false&&Number.isSafeInteger(meta?.bytes)&&meta.bytes>0,'backup_artifact_invalid');
  invariant(/^[a-f0-9]{64}$/.test(meta?.sha256||''),'backup_artifact_unhashed');
  return Object.freeze({
    status:'vm_disk_backup_captured',
    domain,runId,artifact:plan.target,bytes:meta.bytes,sha256:meta.sha256,
    filesystem_quiesced:true,
    application_consistency_verified:false,
    vm_boot_restore_verified:false,
    offsite_verified:false
  });
}
module.exports={ROOT,DOMAINS,parseDiskLines,makePlan,capacityGate,checkCompleted,checkNoActiveJob,executeDomainBackup};
