'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const m=require('./node1-live-vm-backup-v1');
const RUN='20261008T151000Z',HASH='b'.repeat(64),G=1024**3;
const DISKS="Type Device Target Source\n--------------------------------\nfile disk vda /var/lib/libvirt/images/prhm-production.qcow2\n";
function harness({listing=DISKS,failAt='',job='ok',artifact='ok'}={}){
 const calls=[];let info=0;
 const adapter={
  command(bin,args){
   calls.push([bin,...args].join(' '));
   const op=args[0];
   if(op===failAt)throw new Error('synthetic_'+op);
   if(op==='domblklist')return listing;
   if(op==='domstate')return 'running\n';
   if(op==='domjobinfo' && args.includes('--completed'))return job==='fail'?'Job type: Failed\nOperation: Backup\nFile remaining: 1.000 MiB':'Job type: Completed\nOperation: Backup\nFile remaining: 0.000 B';
   if(op==='domjobinfo')return info++===0?'Job type: None\n':info===2?'Job type: Backup\n':'Job type: None\n';
   return '';
  },
  createOutput(dir,xml,body){calls.push('createOutput');assert.match(xml,/backup\.xml$/);assert.match(body,/domainbackup mode='push'/)},
  preflight(){calls.push('preflight');return {libvirt_backup_api_supported:true,guest_agent_responsive:true,qemu_output_writable:true,selinux_context_verified:true,stage_path_exclusive:true}},
  artifact(){return artifact==='ok'?{regular:true,symlink:false,bytes:1024,sha256:HASH}:{regular:false,symlink:false,bytes:0,sha256:''}},
  poll(){calls.push('poll')}
 };
 return {adapter,calls};
}
test('plan binds to allowlisted domain, exact disk and run ID',()=>{
 const p=m.makePlan('prhm-production',RUN,DISKS);
 assert.match(p.target,/\/20261008T151000Z\/vm\/prhm-production\/vda\.qcow2$/);
 assert.match(p.body,/driver type='qcow2'/);
 assert.throws(()=>m.makePlan('../etc',RUN,DISKS),/domain_not_allowlisted/);
 assert.throws(()=>m.makePlan('prhm-production','bad',DISKS),/invalid_run_id/);
});
test('refuses altered source path and multiple disks',()=>{
 assert.throws(()=>m.makePlan('prhm-production',RUN,DISKS.replace('prhm-production.qcow2','not-expected.qcow2')),/unexpected_vm_disk_source/);
 assert.throws(()=>m.makePlan('prhm-production',RUN,DISKS+'file disk vdb /tmp/other.qcow2\n'),/unexpected_disk_count/);
});
test('capacity reserve uses virtual size plus margin',()=>{
 const a=m.capacityGate({freeBytes:429*G,vmVirtualBytes:263*G});
 assert.equal(a.ok,true);
 assert.equal(m.capacityGate({freeBytes:200*G,vmVirtualBytes:263*G}).ok,false);
 assert.throws(()=>m.capacityGate({freeBytes:NaN,vmVirtualBytes:263*G}),/free_space_unverified/);
});
test('live VM full push backup verifies thaw, completion, artifact hash',()=>{
 const h=harness();
 const r=m.executeDomainBackup({domain:'prhm-production',runId:RUN,adapter:h.adapter,freeBytes:429*G,vmVirtualBytes:263*G});
 assert.equal(r.status,'vm_disk_backup_captured');
 assert.equal(r.application_consistency_verified,false);
 assert.equal(r.vm_boot_restore_verified,false);
 assert.equal(r.offsite_verified,false);
 assert(h.calls.indexOf('/usr/bin/virsh domfsfreeze prhm-production')<h.calls.indexOf('/usr/bin/virsh backup-begin prhm-production '+m.ROOT+'/'+RUN+'/vm/prhm-production/backup.xml'));
 assert(h.calls.indexOf('/usr/bin/virsh backup-begin prhm-production '+m.ROOT+'/'+RUN+'/vm/prhm-production/backup.xml')<h.calls.indexOf('/usr/bin/virsh domfsthaw prhm-production'));
});
test('unsafe runtime preflight blocks VM freeze and backup begin',()=>{
 const h=harness();h.adapter.preflight=()=>({libvirt_backup_api_supported:true,guest_agent_responsive:true,qemu_output_writable:false,selinux_context_verified:true,stage_path_exclusive:true});
 assert.throws(()=>m.executeDomainBackup({domain:'prhm-production',runId:RUN,adapter:h.adapter,freeBytes:429*G,vmVirtualBytes:263*G}),/runtime_preflight_failed:qemu_output_writable/);
 assert(!h.calls.some(x=>x.includes('domfsfreeze')||x.includes('backup-begin')));
});
test('unknown VM is rejected before external command',()=>{
 const h=harness();assert.throws(()=>m.executeDomainBackup({domain:'unknown-vm',runId:RUN,adapter:h.adapter,freeBytes:429*G,vmVirtualBytes:263*G}),/domain_not_allowlisted/);
 assert.equal(h.calls.length,0);
});
test('begin failure still invokes thaw',()=>{
 const h=harness({failAt:'backup-begin'});
 assert.throws(()=>m.executeDomainBackup({domain:'prhm-production',runId:RUN,adapter:h.adapter,freeBytes:429*G,vmVirtualBytes:263*G}),/synthetic_backup-begin/);
 assert(h.calls.some(c=>c.includes('domfsthaw prhm-production')));
});
test('guest thaw failure always blocks backup success',()=>{
 const h=harness({failAt:'domfsthaw'});
 assert.throws(()=>m.executeDomainBackup({domain:'prhm-production',runId:RUN,adapter:h.adapter,freeBytes:429*G,vmVirtualBytes:263*G}),/guest_thaw_unverified/);
});
test('completed failure never yields success evidence',()=>{
 const h=harness({job:'fail'});
 assert.throws(()=>m.executeDomainBackup({domain:'prhm-production',runId:RUN,adapter:h.adapter,freeBytes:429*G,vmVirtualBytes:263*G}),/backup_completion_not_recorded/);
});
test('invalid target file or hash blocks result',()=>{
 const h=harness({artifact:'fail'});
 assert.throws(()=>m.executeDomainBackup({domain:'prhm-production',runId:RUN,adapter:h.adapter,freeBytes:429*G,vmVirtualBytes:263*G}),/backup_artifact_invalid/);
});
test('no implicit shell, network, service or destructive API',()=>{
 const s=fs.readFileSync(require.resolve('./node1-live-vm-backup-v1'),'utf8');
 assert.doesNotMatch(s,/execSync\s*\(|shell:\s*true|force:\s*true|blockcommit|blockpull|snapshot-create|domjobabort/);
});
