'use strict';
/**
 * CANDIDATE ONLY: explicit Host Action v2 transaction contract for ONE
 * off-line, non-booted, isolated iTicket CI VM.
 *
 * No CLI, SSH, child_process, filesystem, root, network, or approval adapter.
 * All 'io' capabilities must be supplied by a separately reviewed, root-owned
 * Action v2 dispatcher AFTER independent Ed25519 approval consumption and
 * immutable Git SHA attestation. Exporting this module does not register it.
 *
 * Journal MUST be durably fsynced by the trusted executor. Each creation
 * operation MUST be atomic or report uncertain result without claiming it
 * didn't mutate the host. Uncertain operations are NEVER blindly undone.
 */
const crypto=require('node:crypto');
const candidate=require('./honartik-iticket-ci-vm-candidate-v1.cjs');
const {SPEC,NETWORK_XML,createCandidate}=candidate;
const SHA=/^[a-f0-9]{40}$/;
const HEX=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function reject(reason){throw new Error('iticket_ci_vm_tx_'+reason);}
function requireTrue(ok,reason){if(!ok)reject(reason);}
function exactKeys(o,keys,code){
  requireTrue(o&&typeof o==='object'&&!Array.isArray(o)&&
    Object.keys(o).sort().join('|')===keys.slice().sort().join('|'),code);
}
function sha(s){return crypto.createHash('sha256').update(s).digest('hex');}
const DOMAIN_XML=[
  '<domain type="kvm">',
  '  <name>honartik-iticket-ci</name>',
  '  <memory unit="MiB">8192</memory>',
  '  <vcpu placement="static">4</vcpu>',
  '  <os><type arch="x86_64">hvm</type></os>',
  '  <devices>',
  "    <disk type='file' device='disk'>",
  "      <driver name='qemu' type='qcow2'/>",
  "      <source file='/var/lib/libvirt/images/honartik-iticket-ci.qcow2'/>",
  "      <target dev='vda' bus='virtio'/>",
  '    </disk>',
  "    <interface type='network'>",
  "      <source network='honartik-iticket-ci-net'/>",
  "      <model type='virtio'/>",
  '    </interface>',
  '  </devices>',
  '</domain>',
  '',
].join('\n');
const FIXED_STEPS=Object.freeze([
  Object.freeze({kind:'network',name:SPEC.network}),
  Object.freeze({kind:'disk',name:SPEC.disk}),
  Object.freeze({kind:'vm',name:SPEC.vm}),
]);
const undo=Object.freeze({vm:'rollbackVm',disk:'rollbackDisk',
  network:'rollbackNetwork'});
const create=Object.freeze({vm:'defineVm',disk:'createDisk',
  network:'defineNetwork'});
const inspect=Object.freeze({vm:'inspectVm',disk:'inspectDisk',
  network:'inspectNetwork'});
const trustedMethods=Object.freeze([
  'assertConsumedL4', 'attestImmutableGitSource',
  'acquireLock', 'releaseLock', 'readLiveFacts',
  'createJournal', 'appendJournal', 'readJournal',
  'defineNetwork','createDisk','defineVm',
  'inspectNetwork','inspectDisk','inspectVm',
  'rollbackNetwork','rollbackDisk','rollbackVm',
  'finishJournal',
]);
function bindings(params){
  exactKeys(params,['source_commit','manifest_commit','manifest_sha256'],
    'source_binding_schema');
  requireTrue(SHA.test(params.source_commit)&&SHA.test(params.manifest_commit)&&
    HEX.test(params.manifest_sha256),'source_binding_invalid');
  const args=JSON.stringify({
    action:SPEC.action,project:'honartik_iticket_ci',
    source_commit:params.source_commit,
    manifest_commit:params.manifest_commit,
    manifest_sha256:params.manifest_sha256,
  });
  return Object.freeze({args,hash:sha(Buffer.from(args)),...params});
}
function assertCapabilities(io){
  for(const name of trustedMethods)requireTrue(
    io && typeof io[name]==='function','trusted_capability_missing_'+name);
  return io;
}
function xmlAndResources(facts){
  createCandidate(facts);
  requireTrue(!/<forward\b|<ip\b|<route\b|<dns\b|prod-net/i.test(NETWORK_XML),
    'network_not_isolated');
  requireTrue(!/prod-net|hostdev|filesystem|source bridge=/i.test(DOMAIN_XML),
    'domain_xml_not_isolated');
  return Object.freeze({domainXml:DOMAIN_XML,networkXml:NETWORK_XML,
    vm:SPEC.vm,network:SPEC.network,disk:SPEC.disk,image:SPEC.source_image,
    source_image_sha256:SPEC.source_image_sha256,
    cpu:SPEC.cpu,ram_mib:SPEC.ram_mib,disk_gib:SPEC.disk_gib});
}
function strictlyOwned(receipt,step,requestId){
  exactKeys(receipt,['status','kind','name','request_id','ownership_verified'],
    'creation_receipt_schema');
  requireTrue(receipt.status==='created'&&receipt.kind===step.kind&&
    receipt.name===step.name&&receipt.request_id===requestId&&
    receipt.ownership_verified===true,'creation_not_proven_owned');
}
function inspected(receipt,step,requestId){
  exactKeys(receipt,['kind','name','request_id','matches_expected',
    'has_prod_connection','running'],'inspection_receipt_schema');
  requireTrue(receipt.kind===step.kind&&receipt.name===step.name&&
    receipt.request_id===requestId&&receipt.matches_expected===true&&
    receipt.has_prod_connection===false&&receipt.running===false,
    'isolation_or_identity_not_verified');
}
function approval(authorized,binding){
  exactKeys(authorized,['request_id','action','level','risk',
    'one_time_use','consumed','arguments_sha256','source_sha'],
    'approval_receipt_schema');
  requireTrue(UUID.test(authorized.request_id)&&
    authorized.action===SPEC.action&&authorized.level===4&&
    authorized.risk==='critical'&&authorized.one_time_use===true&&
    authorized.consumed===true&&authorized.source_sha===binding.source_commit&&
    authorized.arguments_sha256===binding.hash,'signed_approval_unverified');
}
async function record(io,entry){
  const done=await io.appendJournal(entry);
  requireTrue(done===true,'durable_journal_write_unproven');
}
async function rollback(io,owner,requestId){
  const failures=[];
  for(const step of owner.slice().reverse()){
    try{
      const r=await io[undo[step.kind]]({name:step.name,
        request_id:requestId,only_if_owned:true});
      requireTrue(r&&r.removed===true&&r.ownership_verified===true,
        'rollback_not_verified');
      await record(io,{request_id:requestId,event:'rollback_verified',
        kind:step.kind,name:step.name});
    }catch(e){failures.push(step.kind);}
  }
  return failures;
}
/**
 * This is a *candidate core*, not a standalone executable. A trusted,
 * audited dispatcher must supply io and independently validate the real
 * signed approval through Approval Center. Forged injected test adapters
 * are NEVER acceptable for host writes.
 */
async function executeBoundCandidate({io,source}){
  assertCapabilities(io);
  const bind=bindings(source);
  const live=await io.readLiveFacts();
  const resources=xmlAndResources(live);
  // Do not consume an approval before proving the exact source and plan.
  requireTrue(await io.attestImmutableGitSource({source_commit:bind.source_commit,
    manifest_commit:bind.manifest_commit,
    manifest_sha256:bind.manifest_sha256,resource_sha256:sha(Buffer.from(
      DOMAIN_XML+NETWORK_XML))})===true,'git_source_not_attested');
  const receipt=await io.assertConsumedL4({action:SPEC.action,
    operation:SPEC.operation,arguments_sha256:bind.hash,
    source_commit:bind.source_commit,manifest_commit:bind.manifest_commit,
    manifest_sha256:bind.manifest_sha256});
  approval(receipt,bind);
  const requestId=receipt.request_id;
  const locked=await io.acquireLock({resource:SPEC.vm,request_id:requestId});
  requireTrue(locked===true,'exclusive_resource_lock_failed');
  const owner=[];
  let pending=null;
  let journalCreated=false;
  try {
    // Recovery is fail-closed. Do not overwrite/replace an earlier journal.
    const existing=await io.readJournal({request_id:requestId,
      resource:SPEC.vm});
    requireTrue(existing===null,'request_replay_or_unreconciled_journal');
    requireTrue(await io.createJournal({request_id:requestId,
      source_commit:bind.source_commit,network:SPEC.network,
      disk:SPEC.disk,vm:SPEC.vm,stage:'started'})===true,
      'journal_create_unproven');
    journalCreated=true;
    // Prevent TOCTOU and fail-closed on newly created colliding VM/net/disk.
    xmlAndResources(await io.readLiveFacts());
    for(const step of FIXED_STEPS){
      pending=step;
      await record(io,{request_id:requestId,event:'intent',
        kind:step.kind,name:step.name});
      const done=await io[create[step.kind]]({request_id:requestId,
        kind:step.kind,name:step.name,resources});
      strictlyOwned(done,step,requestId);
      owner.push(step);
      await record(io,{request_id:requestId,event:'created_owned',
        kind:step.kind,name:step.name});
      inspected(await io[inspect[step.kind]]({request_id:requestId,
        kind:step.kind,name:step.name,resources}),step,requestId);
      await record(io,{request_id:requestId,event:'inspected',
        kind:step.kind,name:step.name});
      pending=null;
    }
    requireTrue(await io.finishJournal({request_id:requestId,
      outcome:'defined_offline_no_guest_boot_no_financial_e2e'})===true,
      'journal_finalize_failed');
    return {state:'DEFINED_OFFLINE_GUEST_NOT_STARTED',
      action:SPEC.action,request_id:requestId,
      isolated:true,financial_e2e_verified:false,
      production_modified:false,source_commit:bind.source_commit};
  } catch(error){
    // If creation/inspection or the write-ahead journal fails ambiguously,
    // we cannot prove whether the pending operation created host state.
    // Avoid automatically deleting unrelated/preexisting resources.
    const uncertain=pending!==null;
    const failures=await rollback(io,owner,requestId);
    if(journalCreated){
      try{
        await io.finishJournal({request_id:requestId,
          outcome:(uncertain||failures.length)?
            'MANUAL_RECOVERY_REQUIRED':'ROLLBACK_VERIFIED'});
      }catch(_ignored){failures.push('journal');}
    }
    reject((uncertain||failures.length?
      'MANUAL_RECOVERY_REQUIRED':'ROLLED_BACK')+
      ':original_'+String(error.message).slice(0,160));
  } finally {
    const released=await io.releaseLock({resource:SPEC.vm,request_id:requestId});
    if(released!==true)reject('EXCLUSIVE_LOCK_RELEASE_UNVERIFIED');
  }
}
module.exports=Object.freeze({DOMAIN_XML,FIXED_STEPS,bindings,xmlAndResources,
  executeBoundCandidate});
