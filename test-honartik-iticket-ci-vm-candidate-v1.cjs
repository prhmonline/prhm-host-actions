'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const vm = require('./honartik-iticket-ci-vm-candidate-v1.cjs');

function valid() {
  return {
    hostname:'server1.prhm.ir', architecture:'x86_64',
    kvm:true, firewalld:true,
    cpu_logical:48, mem_available_kib:40847*1024,
    storage_available_kib:419645*1024,
    image_sha256:vm.SPEC.source_image_sha256,
    domains:['prhm-production','imotion-directadmin'],
    networks:['prod-net'],
    target_disk_absent:true,
    virt_install:true, qemu_img:true, genisoimage:true,
  };
}
function denied(facts, expected) {
  assert.throws(()=>vm.createCandidate(facts),
    new RegExp('iticket_ci_vm_candidate_'+expected));
}
test('approved candidate has fixed resources but no executable installer',()=>{
  const c=vm.createCandidate(valid());
  assert.equal(c.registration_status,'SOURCE_ONLY_NOT_INSTALLED');
  assert.equal(c.privileged_execution,'DISABLED');
  assert.equal(c.approval_level,4);
  assert.equal(c.signed_l4_approval_received,false);
  assert.equal(c.git_sha_attestation_received,false);
  assert.equal(c.production_modified,false);
  assert.equal(c.sandbox_financial_e2e_approved,false);
  assert.deepEqual(c.artifacts.resource_limits,{cpu:4,ram_mib:8192,disk_gib:60});
  assert.equal(c.artifacts.vm,'honartik-iticket-ci');
  assert.equal(c.artifacts.network,'honartik-iticket-ci-net');
  assert.equal(c.artifacts.disk,'/var/lib/libvirt/images/honartik-iticket-ci.qcow2');
  assert.equal(c.isolated_network_xml_sha256,
    crypto.createHash('sha256').update(vm.NETWORK_XML).digest('hex'));
  assert.equal(c.rollback_plan.length,6);
  assert.equal(Object.hasOwn(vm,'apply'),false);
  assert.equal(Object.hasOwn(vm,'execute'),false);
  assert.equal(Object.hasOwn(vm,'register'),false);
});
test('network is truly isolated in candidate XML, not NAT or prod-net',()=>{
  assert.equal(vm.verifyIsolation(),true);
  for (const evil of ['<forward mode="nat"/>','<ip address="10.71.0.77"/>',
    '<route address="10.71.0.0"/>','<dns/>','prod-net',
    '<virtualport type="openvswitch"/>','<portgroup/>']) {
    assert.throws(()=>vm.verifyIsolation(vm.NETWORK_XML.replace(
      '</network>',evil+'</network>')));
  }
  assert.equal(vm.NETWORK_XML.includes('virbr-iticket-ci'),true);
});
test('rejects non-node1, missing KVM, no firewall, and unsupported image',()=>{
  for(const [key,value,reason] of [
    ['hostname','prhm-production.prhm.ir','wrong_host'],
    ['hostname','server2.prhm.ir','wrong_host'],
    ['architecture','aarch64','hypervisor_or_firewall_unavailable'],
    ['kvm',false,'hypervisor_or_firewall_unavailable'],
    ['firewalld',false,'hypervisor_or_firewall_unavailable'],
    ['image_sha256','0'.repeat(64),'base_image_hash'],
    ['virt_install',false,'required_tool_absent'],
    ['qemu_img',false,'required_tool_absent'],
    ['genisoimage',false,'required_tool_absent'],
  ]) denied({...valid(),[key]:value},reason);
});
test('rejects inadequate reserve, collisions and incomplete host inventory',()=>{
  for(const [key,value,reason] of [
    ['cpu_logical',4,'cpu_reserve'],
    ['mem_available_kib',4*1024*1024,'ram_reserve'],
    ['storage_available_kib',50*1024*1024,'disk_reserve'],
    ['domains',['prhm-production'],'domain_inventory_or_collision'],
    ['domains',['prhm-production','imotion-directadmin','honartik-iticket-ci'],'domain_inventory_or_collision'],
    ['networks',['prod-net','honartik-iticket-ci-net'],'network_inventory_or_collision'],
    ['networks',[],'network_inventory_or_collision'],
    ['target_disk_absent',false,'disk_collision'],
  ]) denied({...valid(),[key]:value},reason);
});
test('rejects extra keys and caller-specified privileged behavior',()=>{
  denied({...valid(),command:'virsh destroy prhm-production'},'facts_schema');
  denied({...valid(),approval_token:'dummy'},'facts_schema');
  denied({...valid(),network:'prod-net'},'facts_schema');
  denied({...valid(),disk:'/var/lib/libvirt/images/prhm-production.qcow2'},'facts_schema');
  denied({...valid(),domains:['prhm-production','imotion-directadmin','imotion-directadmin']},
    'domain_inventory_or_collision');
  assert.throws(()=>vm.validateInventory(null),/facts_schema/);
});
test('source has no privileged side effects or generic command interface',()=>{
  const src=fs.readFileSync(require.resolve('./honartik-iticket-ci-vm-candidate-v1.cjs'),'utf8');
  for(const needle of ['child_process','execSync','spawnSync','ssh ','virsh ',
    'writeFileSync','unlinkSync','mkdirSync','rmSync','systemctl ',
    'curl ','wget ','eval(','new Function','process.env']) {
    assert.equal(src.includes(needle),false,needle);
  }
  assert.deepEqual(Object.keys(vm).sort(),
    ['INVENTORY_KEYS','NETWORK_XML','ORDER','ROLLBACK_ORDER','SPEC',
     'createCandidate','validateInventory','verifyIsolation'].sort());
});
