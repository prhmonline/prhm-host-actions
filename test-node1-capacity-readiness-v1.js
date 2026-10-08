'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('./node1-capacity-readiness-v1');
const V=require('./node1-live-vm-backup-v1');
const GiB=m.GIB;
const okChecks=()=>Object.fromEntries(m.CHECKS.map(k=>[k,true]));
const disks=()=>Object.fromEntries(m.REQUIRED_DOMAINS.map(d=>[d,{source:V.DOMAINS[d].source,
  virtualBytes:d==='prhm-production'?300*GiB:20*GiB,
  physicalBytes:d==='prhm-production'?250*GiB:2*GiB,
  geometrySource:'qemu-img-info'}]));
const input=()=>({freeBytes:550*GiB,dbStagingBytes:3*GiB,vmDisks:disks(),checks:okChecks()});
test('all static checks with verified aggregate geometry can pass, never approve deployment',()=>{
 const x=m.assess(input());
 assert.equal(x.all_static_gates_pass,true);
 assert.equal(x.approved_for_production,false);
 assert.equal(x.capacity.virtualVmBytes,320*GiB);
 assert.equal(x.capacity.requiredBytes,Math.ceil(323*GiB*1.2)+80*GiB);
});
test('429 GiB is inadequate for the synthetic 320 GiB combined virtual VM budget',()=>{
 const p=input();p.freeBytes=429*GiB;
 const r=m.assess(p);
 assert.equal(r.all_static_gates_pass,false);
 assert.equal(r.approved_for_production,false);
 assert(r.missing.includes('aggregate_staging_capacity_insufficient'));
});
test('physical qcow2 byte size cannot substitute for qemu virtual geometry',()=>{
 const p=input();
 p.vmDisks['prhm-production'].geometrySource='filesystem-stat';
 const r=m.assess(p);
 assert.equal(r.all_static_gates_pass,false);
 assert(r.missing.includes('vm_geometry_unverified:prhm-production'));
 assert(r.missing.includes('aggregate_capacity_not_provable'));
});
test('aggregate capacity fails where per-domain capacity might misleadingly pass',()=>{
 const p=input();p.freeBytes=420*GiB;
 p.vmDisks['prhm-production'].virtualBytes=350*GiB;
 p.vmDisks['imotion-directadmin'].virtualBytes=45*GiB;
 const r=m.assess(p);
 assert.equal(r.all_static_gates_pass,false);
 assert(r.missing.includes('aggregate_staging_capacity_insufficient'));
 assert(r.capacity.requiredBytes>p.freeBytes);
});
test('missing snapshot, QEMU, crypto, or independent restore requirements block',()=>{
 const p=input();
 for(const name of ['libvirt_push_backup_supported','guest_agent_both_verified','encrypted_repository_verified','independent_restore_runtime_verified']){
  const c=structuredClone(p);c.checks[name]=false;const r=m.assess(c);
  assert.equal(r.all_static_gates_pass,false);
  assert(r.missing.includes('runtime_requirement_missing:'+name));
 }
});
test('unknown VM and omitted VM fail closed',()=>{
 const x=input();x.vmDisks['extra']={...x.vmDisks['prhm-production']};
 assert(m.assess(x).missing.includes('vm_inventory_incomplete'));
 delete x.vmDisks['extra']; delete x.vmDisks['imotion-directadmin'];
 assert(m.assess(x).missing.includes('vm_inventory_incomplete'));
});
test('unknown live VM virtual disk capacity cannot be guessed',()=>{
 const x=input();delete x.vmDisks['prhm-production'].virtualBytes;
 const r=m.assess(x);
 assert.equal(r.all_static_gates_pass,false);
 assert.equal(r.capacity,null);
});
test('missing database estimate and zero available space block',()=>{
 const x=input();x.dbStagingBytes=0;x.freeBytes=0;
 const r=m.assess(x);
 assert(r.missing.includes('database_staging_estimate_unverified'));
 assert(r.missing.includes('free_capacity_unverified'));
});
test('all static green never produces a level 4 confirmation or signed restore',()=>{
 const r=m.assess(input());
 assert.equal(r.approved_for_production,false);
 assert.equal(r.requires_independent_level4_approval,true);
 assert.equal(r.requires_signed_restore_evidence,true);
 assert(Object.isFrozen(r));
});
test('actual audit without verified qemu-img geometry stays RED',()=>{
 const r=m.assess({
  freeBytes:429*GiB,dbStagingBytes:0,
  vmDisks:{'prhm-production':{source:V.DOMAINS['prhm-production'].source,physicalBytes:263610171392},
    'imotion-directadmin':{source:V.DOMAINS['imotion-directadmin'].source,physicalBytes:2001403904}},
  checks:{'restic_installed':false,'rclone_installed':false}
 });
 assert.equal(r.all_static_gates_pass,false);
 assert(r.missing.includes('runtime_requirement_missing:restic_installed'));
 assert(r.missing.includes('runtime_requirement_missing:rclone_installed'));
 assert(r.missing.includes('vm_geometry_unverified:prhm-production'));
});
