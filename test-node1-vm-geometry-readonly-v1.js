'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const p=require('./node1-vm-geometry-readonly-v1');
const vm=require('./node1-live-vm-backup-v1').DOMAINS;
const GIB=1024**3;
function validInfo(domain){
 const cap=domain==='prhm-production'?350*GIB:80*GIB;
 return {
  diskList:'Type Device Target Source\n-------------------------\nfile disk vda '+vm[domain].source+'\n',
  block:'Capacity: '+cap+'\nAllocation: '+(cap-10*GIB)+'\nPhysical: '+(cap-12*GIB)+'\n',
  fs:'Mountpoint Name Type Target\n-------------------------\n/ dm-0 xfs vda\n/boot vda1 ext4 vda\n',
  qemu:JSON.stringify({'virtual-size':cap,format:'qcow2','actual-size':cap-12*GIB})
 };
}
function runner(overrides={}){
 const commands=[];
 return {
  commands,
  read(spec){
   commands.push({bin:spec.bin,args:[...spec.args]});
   const domain=spec.bin===p.VIRSH?spec.args[2]:Object.keys(vm).find(d=>vm[d].source===spec.args[2]);
   const info=validInfo(domain);
   const kind=spec.bin===p.QEMU_IMG?'qemu':spec.args[1];
   const val=overrides[domain]?.[kind];
   if(val instanceof Error)throw val;
   if(val!==undefined)return val;
   if(kind==='domstate')return 'running\n';
   if(kind==='domblklist')return info.diskList;
   if(kind==='domblkinfo')return info.block;
   if(kind==='domfsinfo')return info.fs;
   if(kind==='qemu')return info.qemu;
   throw Error('unexpected_command');
  },
  fileMeta(file){
   if(overrides.meta)return overrides.meta(file);
   return {isRegular:true,isSymlink:false,realpath:file};
  }
 };
}
test('read-only plans are fixed to two known host VM identities',()=>{
 assert.deepEqual(p.DOMAINS,['imotion-directadmin','prhm-production']);
 for(const d of p.DOMAINS){
  const cmd=p.getCommands(d);
  assert.equal(cmd.length,5);
  assert(cmd.slice(0,4).every(x=>x.bin===p.VIRSH&&x.args[0]==='--readonly'&&x.args[2]===d));
  assert.deepEqual(cmd[4],{bin:'/usr/bin/qemu-img',args:['info','--output=json',vm[d].source]});
 }
 assert.throws(()=>p.getCommands('random-or-evil'),/unlisted_vm/);
});
test('valid QEMU geometry and live guest FS discovery are summarized with no guest paths',()=>{
 const a=runner();
 const r=p.report(a);
 assert.equal(r.readonly,true);
 assert.equal(r.production_mutation,false);
 assert.equal(r.ready_for_deployment,false);
 assert.equal(r.all_domains_verified,true);
 assert.equal(r.domains.length,2);
 assert.equal(r.totalVirtualBytes,430*GIB);
 assert(r.domains.every(x=>x.guestAgentResponsive&&x.mountedFilesystems===2&&x.geometrySource==='qemu-img-info'));
 assert(!JSON.stringify(r).includes('/boot'));
 assert.equal(a.commands.length,10);
});
test('missing guest agent fails closed and virtual capacity is not asserted',()=>{
 const a=runner({'prhm-production':{domfsinfo:new Error('guest agent not configured')}});
 const r=p.report(a);
 const d=r.domains.find(x=>x.domain==='prhm-production');
 assert.equal(r.all_domains_verified,false);
 assert.equal(r.totalVirtualBytes,null);
 assert.equal(d.virtualBytes,null);
 assert.equal(d.guestAgentResponsive,false);
});
test('QEMU virtual capacity mismatch against virsh is fatal',()=>{
 const a=runner({'prhm-production':{qemu:JSON.stringify({'virtual-size':349*GIB,format:'qcow2'})}});
 const d=p.assessDomain('prhm-production',a);
 assert.equal(d.ok,false);
 assert(d.errors.includes('virsh_qemu_virtual_size_mismatch'));
});
test('backing-chain images require separate validated capture plan',()=>{
 const a=runner({'imotion-directadmin':{qemu:JSON.stringify({'virtual-size':80*GIB,format:'qcow2','backing-filename':'../../base.qcow2'})}});
 const d=p.assessDomain('imotion-directadmin',a);
 assert.equal(d.ok,false);
 assert(d.errors.includes('backing_chain_requires_review'));
});
test('source disk substitution, symlink or unknown extra disk fail closed',()=>{
 const a=runner({'imotion-directadmin':{domblklist:'file disk vda /tmp/foreign.qcow2\n'}});
 assert.equal(p.assessDomain('imotion-directadmin',a).ok,false);
 const b=runner({meta:file=>({isRegular:true,isSymlink:true,realpath:file})});
 assert(p.assessDomain('prhm-production',b).errors.includes('vm_source_file_unsafe'));
 const c=runner({'prhm-production':{domblklist:validInfo('prhm-production').diskList+'file disk vdb /tmp/extra.qcow2\n'}});
 assert(p.assessDomain('prhm-production',c).errors.includes('unexpected_disk_mapping'));
});
test('invalid or human-formatted blockinfo numbers are never assumed to be bytes',()=>{
 assert.throws(()=>p.parseBlockInfo('Capacity: 350 GiB\nAllocation: 2 GiB\nPhysical: 2 GiB'),/invalid_blockinfo_Capacity/);
 assert.throws(()=>p.parseBlockInfo('Capacity: 100\nCapacity: 200\nAllocation: 2\nPhysical: 2'),/duplicate_blockinfo_key/);
});
test('guest agent empty output, headers only and errors never get GREEN',()=>{
 assert.throws(()=>p.validateFsInfo('Mountpoint Name Type Target\n------\n'),/guest_fsinfo_missing/);
 assert.throws(()=>p.validateFsInfo('error: guest agent is not responding'),/guest_agent_error/);
 assert.throws(()=>p.validateFsInfo(''),/guest_agent_empty_or_too_large/);
});
test('no dangerous stateful libvirt actions exist in the plans',()=>{
 for(const domain of p.DOMAINS){
  for(const cmd of p.getCommands(domain)){
   const t=cmd.args.join(' ');
   assert.doesNotMatch(t,/domfsfreeze|domfsthaw|backup-begin|snapshot-create|blockcommit|virsh\s+destroy|domjobabort|blockcopy|detach|attach|resize|domfstrim/);
  }
 }
});
test('VM not running is never certified',()=>{
 const a=runner({'prhm-production':{domstate:'shut off\n'}});
 assert(p.assessDomain('prhm-production',a).errors.includes('vm_not_running'));
});
