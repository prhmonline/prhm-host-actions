'use strict';
/**
 * SOURCE-ONLY exact-resource VM candidate for future Host Actions v2.
 *
 * No executable main, shell runner, SSH, virsh, file writer, approval
 * generator or self-authorization. The live signed Approval Center and
 * registered Host Action must independently attest and authorize immutable
 * assets before executing a separately reviewed rollback-safe installer.
 */
const crypto = require('node:crypto');

const SPEC = Object.freeze({
  schema: 'prhm.honartik-iticket-ci.vm-candidate.v1',
  action: 'honartik_iticket_ci_vm_provision_v1',
  operation: 'host_action.honartik_iticket_ci_vm_provision_v1',
  approval_level: 4,
  approval_kind: 'critical',
  host: 'server1.prhm.ir',
  vm: 'honartik-iticket-ci',
  network: 'honartik-iticket-ci-net',
  bridge: 'virbr-iticket-ci',
  source_image: '/var/lib/libvirt/images/base/noble-server-cloudimg-amd64.img',
  source_image_sha256: 'ffe6203da54deeb6db5d2a98a83f9ec8e55f149d3f7ba622e1abe5fa966ee3d6',
  disk: '/var/lib/libvirt/images/honartik-iticket-ci.qcow2',
  cpu: 4,
  ram_mib: 8192,
  disk_gib: 60,
  forbidden_network: 'prod-net',
});
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function deny(reason) { throw new Error('iticket_ci_vm_candidate_' + reason); }
function check(ok, reason) { if (!ok) deny(reason); }
function exactKeys(value, keys, reason) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...keys].sort().join('|'), reason);
}
function uniqueStrings(values) {
  return Array.isArray(values) && values.every(v => typeof v === 'string' &&
    /^[a-z0-9][a-z0-9-]*$/.test(v)) &&
    new Set(values).size === values.length;
}
const INVENTORY_KEYS = Object.freeze([
  'hostname', 'architecture', 'kvm', 'firewalld',
  'cpu_logical', 'mem_available_kib', 'storage_available_kib',
  'image_sha256', 'domains', 'networks', 'target_disk_absent',
  'virt_install', 'qemu_img', 'genisoimage',
]);
function validateInventory(facts) {
  exactKeys(facts, INVENTORY_KEYS, 'facts_schema');
  check(facts.hostname === SPEC.host, 'wrong_host');
  check(facts.architecture === 'x86_64' && facts.kvm === true &&
    facts.firewalld === true, 'hypervisor_or_firewall_unavailable');
  check(facts.virt_install === true && facts.qemu_img === true &&
    facts.genisoimage === true, 'required_tool_absent');
  check(Number.isSafeInteger(facts.cpu_logical) && facts.cpu_logical >= 12,
    'cpu_reserve');
  // Require 8 GiB guest and at least 4 GiB immediately remaining.
  check(Number.isSafeInteger(facts.mem_available_kib) &&
    facts.mem_available_kib >= 12 * 1024 * 1024, 'ram_reserve');
  // Require 60 GiB for guest plus at least 40 GiB host remaining.
  check(Number.isSafeInteger(facts.storage_available_kib) &&
    facts.storage_available_kib >= 100 * 1024 * 1024, 'disk_reserve');
  check(facts.image_sha256 === SPEC.source_image_sha256, 'base_image_hash');
  check(uniqueStrings(facts.domains) && facts.domains.includes('prhm-production') &&
    facts.domains.includes('imotion-directadmin') &&
    !facts.domains.includes(SPEC.vm), 'domain_inventory_or_collision');
  check(uniqueStrings(facts.networks) &&
    facts.networks.includes(SPEC.forbidden_network) &&
    !facts.networks.includes(SPEC.network), 'network_inventory_or_collision');
  check(facts.target_disk_absent === true, 'disk_collision');
  return true;
}
// No forward, IP, route or DNS at all: no routable guest network.
// Offline-only guest provisioning; NAT is separately reviewed and never
// authorized by this candidate.
const NETWORK_XML = [
  '<network>',
  "  <name>honartik-iticket-ci-net</name>",
  "  <bridge name='virbr-iticket-ci' stp='off' delay='0'/>",
  '</network>',
  '',
].join('\n');
function verifyIsolation(xml = NETWORK_XML) {
  check(typeof xml === 'string' && xml === NETWORK_XML,
    'network_xml_not_exact');
  for (const forbidden of [/<forward\b/i, /<ip\b/i, /<route\b/i,
    /<dns\b/i, /<portgroup\b/i, /prod-net/i, /<virtualport\b/i]) {
    check(!forbidden.test(xml), 'network_not_isolated');
  }
  return true;
}
const ORDER = Object.freeze([
  'verify_trusted_signed_l4_receipt_in_existing_host_actions',
  'recheck_live_inventory_and_base_image_hash',
  'atomically_reserve_new_network_and_vm_names',
  'define_isolated_network_without_forwarding',
  'create_only_new_cow_guest_disk_from_pinned_image',
  'define_only_new_fixed_vm_attached_to_isolated_network',
  'verify_live_guest_network_and_negative_prod_reachability',
  'record_immutable_install_journal_and_cleanup_scope',
]);
const ROLLBACK_ORDER = Object.freeze([
  'stop_only_new_vm_if_started_by_this_transaction',
  'undefine_only_new_vm_if_created_by_this_transaction',
  'delete_only_new_vm_disk_if_created_by_this_transaction',
  'destroy_only_new_network_if_started_by_this_transaction',
  'undefine_only_new_network_if_created_by_this_transaction',
  'verify_original_vm_network_and_disk_inventory_unchanged',
]);
function createCandidate(facts) {
  validateInventory(facts);
  verifyIsolation();
  const artifacts = Object.freeze({
    network_xml: NETWORK_XML,
    vm: SPEC.vm,
    disk: SPEC.disk,
    backing_image: SPEC.source_image,
    backing_image_sha256: SPEC.source_image_sha256,
    network: SPEC.network,
    resource_limits: {cpu: SPEC.cpu, ram_mib: SPEC.ram_mib,
      disk_gib: SPEC.disk_gib},
    allowed_network_names: [SPEC.network],
    forbidden_network_names: [SPEC.forbidden_network],
  });
  return {
    schema: SPEC.schema,
    action: SPEC.action,
    operation: SPEC.operation,
    approval_level: SPEC.approval_level,
    approval_kind: SPEC.approval_kind,
    registration_status: 'SOURCE_ONLY_NOT_INSTALLED',
    privileged_execution: 'DISABLED',
    signed_l4_approval_received: false,
    git_sha_attestation_received: false,
    production_modified: false,
    sandbox_financial_e2e_approved: false,
    network_has_no_forward_or_ip: true,
    isolated_network_xml_sha256: sha256(Buffer.from(NETWORK_XML)),
    artifacts,
    install_plan: [...ORDER],
    rollback_plan: [...ROLLBACK_ORDER],
    rollback_condition: 'ONLY_CREATIONS_OWNED_BY_THIS_TRANSACTION',
  };
}
module.exports = {SPEC, INVENTORY_KEYS, NETWORK_XML, ORDER,
  ROLLBACK_ORDER, validateInventory, verifyIsolation, createCandidate};
