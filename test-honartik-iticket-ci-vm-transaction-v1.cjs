'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const vm=require('./honartik-iticket-ci-vm-candidate-v1.cjs');
const tx=require('./honartik-iticket-ci-vm-transaction-v1.cjs');
const UUID='12345678-1234-4234-8234-123456789abc';
const SOURCE={
  source_commit:'1'.repeat(40),
  manifest_commit:'2'.repeat(40),
  manifest_sha256:'3'.repeat(64),
};
function facts(){
  return {
    hostname:vm.SPEC.host,architecture:'x86_64',kvm:true,firewalld:true,
    cpu_logical:48,mem_available_kib:30*1024*1024,
    storage_available_kib:200*1024*1024,
    image_sha256:vm.SPEC.source_image_sha256,
    domains:['prhm-production','imotion-directadmin'],
    networks:['prod-net'],target_disk_absent:true,
    virt_install:true,qemu_img:true,genisoimage:true,
  };
}
function fixture({fault='',unapproved=false,unsafe=false,replay=false}={}){
  const events=[], owned=[], rollbacks=[];
  const state={events,owned,rollbacks,lock:false};
  const binding=tx.bindings(SOURCE);
  function makeCreate(kind){
    return async ({request_id,name,resources})=>{
      assert.equal(request_id,UUID);
      assert.ok(resources);
      if(fault==='uncertain_'+kind)throw new Error('injected_uncertain_'+kind);
      events.push('created_'+kind);
      owned.push(kind);
      return {status:'created',kind,name,request_id,ownership_verified:true};
    };
  }
  function makeInspect(kind){
    return async ({request_id,name})=>{
      events.push('inspected_'+kind);
      return {kind,name,request_id,matches_expected:!unsafe,
        has_prod_connection:unsafe,running:false};
    };
  }
  function makeRollback(kind){
    return async ({name,request_id,only_if_owned})=>{
      assert.equal(request_id,UUID);
      assert.equal(only_if_owned,true);
      assert.equal(name,kind==='network'?vm.SPEC.network:
        kind==='disk'?vm.SPEC.disk:vm.SPEC.vm);
      if(fault==='rollback_'+kind)throw Error('injected_rollback');
      rollbacks.push(kind);
      return {removed:true,ownership_verified:true};
    };
  }
  const io={
    readLiveFacts:async()=>facts(),
    attestImmutableGitSource:async x=>{
      events.push('attested');
      assert.equal(x.source_commit,SOURCE.source_commit);
      assert.match(x.resource_sha256,/^[a-f0-9]{64}$/);
      return fault!=='bad_source';
    },
    assertConsumedL4:async x=>{
      events.push('approval_consumed');
      return {
        request_id:UUID,action:vm.SPEC.action,level:4,risk:'critical',
        one_time_use:true,consumed:!unapproved,
        arguments_sha256:x.arguments_sha256===binding.hash?binding.hash:'0'.repeat(64),
        source_sha:SOURCE.source_commit,
      };
    },
    acquireLock:async()=>{events.push('lock');state.lock=true;return true;},
    releaseLock:async()=>{events.push('unlock');state.lock=false;return true;},
    readJournal:async()=>replay?{replayed:true}:null,
    createJournal:async()=>{events.push('journal_open');return true;},
    appendJournal:async record=>{
      events.push('journal_'+record.event+'_'+record.kind);
      if(fault==='journal_'+record.event && record.kind==='network')return false;
      return true;
    },
    finishJournal:async record=>{
      events.push('finish_'+record.outcome);
      return fault!=='finish';
    },
    defineNetwork:makeCreate('network'),
    createDisk:makeCreate('disk'),
    defineVm:makeCreate('vm'),
    inspectNetwork:makeInspect('network'),
    inspectDisk:makeInspect('disk'),
    inspectVm:makeInspect('vm'),
    rollbackNetwork:makeRollback('network'),
    rollbackDisk:makeRollback('disk'),
    rollbackVm:makeRollback('vm'),
  };
  return {io,state};
}
test('exact canonical five-field source and manifest SHA approval binding',()=>{
  const got=tx.bindings(SOURCE);
  const fields=JSON.parse(got.args);
  assert.deepEqual(Object.keys(fields),Object.keys(fields).slice().sort());
  assert.deepEqual(fields,{
    action:vm.SPEC.action,manifest_commit:SOURCE.manifest_commit,
    manifest_sha256:SOURCE.manifest_sha256,project:'honartik_iticket_ci',
    source_commit:SOURCE.source_commit,
  });
  assert.equal(got.hash,crypto.createHash('sha256').update(got.args).digest('hex'));
  assert.throws(()=>tx.bindings({...SOURCE,host:'other'}),/source_binding_schema/);
  assert.throws(()=>tx.bindings({...SOURCE,source_commit:'main'}),/source_binding_invalid/);
});
test('fixed XML defines only non-booted isolated guest; no prod-net or host devices',()=>{
  const r=tx.xmlAndResources(facts());
  assert.match(r.domainXml,/<source network='honartik-iticket-ci-net'/);
  assert.match(r.domainXml,/<vcpu placement="static">4<\/vcpu>/);
  assert.match(r.networkXml,/<name>honartik-iticket-ci-net<\/name>/);
  for(const bad of ['prod-net','<forward','<route','<ip ','<filesystem','<hostdev']){
    assert.equal(r.domainXml.includes(bad),false,bad);
    assert.equal(r.networkXml.includes(bad),false,bad);
  }
});
test('healthy mocked host transaction journaled, owned and guest is never started',async()=>{
  const {io,state}=fixture();
  const result=await tx.executeBoundCandidate({io,source:SOURCE});
  assert.equal(result.state,'DEFINED_OFFLINE_GUEST_NOT_STARTED');
  assert.equal(result.financial_e2e_verified,false);
  assert.equal(result.production_modified,false);
  assert.deepEqual(state.owned,['network','disk','vm']);
  assert.deepEqual(state.rollbacks,[]);
  assert.ok(state.events.indexOf('attested')<state.events.indexOf('approval_consumed'));
  assert.ok(state.events.indexOf('journal_intent_network')<
    state.events.indexOf('created_network'));
  assert.ok(state.events.indexOf('journal_created_owned_network')<
    state.events.indexOf('inspected_network'));
  assert.ok(state.events.includes('finish_defined_offline_no_guest_boot_no_financial_e2e'));
  assert.equal(state.lock,false);
  assert.equal(state.events.includes('startVm'),false);
});
test('no approved signed L4 receipt, no trusted Git source, no host mutations',async()=>{
  for(const f of [{unapproved:true},{fault:'bad_source'}]){
    const {io,state}=fixture(f);
    await assert.rejects(()=>tx.executeBoundCandidate({io,source:SOURCE}),
      /signed_approval_unverified|git_source_not_attested/);
    assert.deepEqual(state.owned,[]);
    assert.deepEqual(state.rollbacks,[]);
    assert.equal(state.lock,false);
  }
});
test('uncertain disk creation never deletes the uncertain disk; only network owned',async()=>{
  const {io,state}=fixture({fault:'uncertain_disk'});
  await assert.rejects(()=>tx.executeBoundCandidate({io,source:SOURCE}),
    /MANUAL_RECOVERY_REQUIRED/);
  assert.deepEqual(state.owned,['network']);
  assert.deepEqual(state.rollbacks,['network']);
  assert.ok(state.events.includes('finish_MANUAL_RECOVERY_REQUIRED'));
  assert.equal(state.lock,false);
});
test('inspect fails closed and rollback only proven owned artifacts',async()=>{
  const {io,state}=fixture({unsafe:true});
  await assert.rejects(()=>tx.executeBoundCandidate({io,source:SOURCE}),
    /MANUAL_RECOVERY_REQUIRED/);
  assert.deepEqual(state.owned,['network']);
  assert.deepEqual(state.rollbacks,['network']);
  assert.equal(state.lock,false);
});
test('completed operations undone in reverse order after journal finalization failure',async()=>{
  const {io,state}=fixture({fault:'finish'});
  await assert.rejects(()=>tx.executeBoundCandidate({io,source:SOURCE}),
    /MANUAL_RECOVERY_REQUIRED/);
  assert.deepEqual(state.owned,['network','disk','vm']);
  assert.deepEqual(state.rollbacks,['vm','disk','network']);
  assert.equal(state.lock,false);
});
test('replay rejected; cannot overwrite already recorded action',async()=>{
  const {io,state}=fixture({replay:true});
  await assert.rejects(()=>tx.executeBoundCandidate({io,source:SOURCE}),
    /ROLLED_BACK:original_iticket_ci_vm_tx_request_replay/);
  assert.deepEqual(state.owned,[]);
  assert.deepEqual(state.rollbacks,[]);
  assert.equal(state.lock,false);
});
test('rollback failure explicitly requires manual recovery',async()=>{
  const {io,state}=fixture({fault:'rollback_network'});
  // Induce post-network collision by mutating subsequent API, not production.
  io.createDisk=async()=>{throw Error('unknown_disk_state');};
  await assert.rejects(()=>tx.executeBoundCandidate({io,source:SOURCE}),
    /MANUAL_RECOVERY_REQUIRED/);
  assert.deepEqual(state.owned,['network']);
  assert.deepEqual(state.rollbacks,[]);
  assert.equal(state.lock,false);
});
test('module cannot itself spawn host commands, write disks, or fetch approvals',()=>{
  const body=fs.readFileSync(require.resolve('./honartik-iticket-ci-vm-transaction-v1.cjs'),'utf8');
  for(const forbidden of ["require('node:child_process')","require('node:fs')",
    'spawnSync(', 'execSync(', 'writeFileSync(', 'virsh net-', 'virt-install ',
    'curl --', 'fetch(', 'process.env.', 'ssh root@']){
    assert.equal(body.includes(forbidden),false,forbidden);
  }
  assert.equal(Object.hasOwn(tx,'main'),false);
  assert.equal(Object.hasOwn(tx,'cli'),false);
});
