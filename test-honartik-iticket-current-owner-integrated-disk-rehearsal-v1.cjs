'use strict';
/**
 * Integration of:
 *  - the observed CURRENT Base/Exec/MCP registry shapes
 *  - new independently hardened Level4 approval policy (not old {level:4})
 *  - four-owner fsync + rename + persisted journal rollback engine
 * Physical disk and real process-exit tests are SCRATCH FILES ONLY.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),vm=require('node:vm');
const tx=require('./honartik-iticket-root-installer-transaction-engine-v1.cjs');
const disk=require('./honartik-iticket-root-installer-disk-fixture-v1.cjs');
const structural=require('./honartik-iticket-current-owner-structural-preflight-v2.cjs');
const policy=require('./honartik-iticket-worktree-level4-policy-contract-v1.cjs');
const KEYS=tx.ORDER;
const ID='honartik-integrated-disk-001';

function originals(){
  return {
    base:"'use strict';\n"+
      "const HOST_ACTION_V2_SPECS=Object.freeze({\n"+
      "  agent_zero_downtime_bootstrap_v1:{operation:'host_action.agent_zero_downtime_bootstrap_v1',rollback:'backup-restore'},\n"+
      "  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',rollback:'four-file-restore'},\n"+
      "  honartik_iticket_dark_backend_batch2_v1:{operation:'host_action.honartik_iticket_dark_backend_batch2_v1',rollback:'batch2-rollback'}\n"+
      "});\n"+
      "const HOST_ACTION_V2_LEVEL3=new Set(['host_action_v2_installer_v1']);\n"+
      "function hostActionV2ApprovalMeta(action){return {level:HOST_ACTION_V2_LEVEL3.has(action)?3:4,spec:HOST_ACTION_V2_SPECS[action]}}\n",
    exec:"'use strict';\n"+
      "const HOST_ACTION_V2_SPECS=Object.freeze({\n"+
      "  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',kind:'host_action_v2_installer_v1'},\n"+
      "  honartik_iticket_dark_backend_batch2_v1:{operation:'host_action.honartik_iticket_dark_backend_batch2_v1',kind:'honartik_iticket_dark_backend_batch2_v1'}\n"+
      "});\n"+
      "let applyHostActionV2=async function(){return {ok:false};};\n"+
      "const applyHostActionV2Original=applyHostActionV2;\n"+
      "async function applyAgentZdtSourceShaRefreshPublisherV1(){return {ok:true};}\n"+
      "applyHostActionV2=async function(action){if(action==='agent_zdt_source_sha_refresh_publisher_v1')return applyAgentZdtSourceShaRefreshPublisherV1();return applyHostActionV2Original(action);};\n",
    mcp:"const z={enum:xs=>xs};\n"+
      "const HostActionV2=z.enum(['agent_api_process_sandbox_v1','host_action_v2_installer_v1','honartik_iticket_dark_backend_batch2_v1']);\n",
    policy:JSON.stringify({
      schema_version:'prhm.approval-policy.v1',
      version:policy.EXISTING_VERSION,default_deny:true,one_time_use:true,
      issuer:'prhm-company-approval',high_risk_approver:'mohammad',
      levels:{
        '4':{risks:['critical'],max_ttl_seconds:180,human_approval:true,
          required_approver:'mohammad',second_confirmation_required:true}
      },
      operations:{
        'host_action.host_action_v2_installer_v1':{level:3},
        'host_action.agent_zero_downtime_bootstrap_v1':{level:3}
      },
      typed_scopes:[{action:'host_action_v2_installer_v1',operation:'host_action.host_action_v2_installer_v1',risk:'high'}]
    },null,2)+'\n'
  };
}
function candidatePack(s){
  const struct=structural.patchAll(s);
  // For final policy, NEVER trust the original legacy {level:4} addition.
  // Rebase on approved hardened source contract; other 3 shapes unchanged.
  struct.policy=policy.transform(s.policy);
  assert.equal(JSON.parse(struct.policy).operations[policy.OPERATION].requires_second_confirmation,true);
  assert.ok(struct.exec.includes('requires_separate_signed_helper_activation'));
  return struct;
}
function prepared(t,options={}){
  const base=disk.createFixture();
  t.after(()=>disk.destroyFixture(base.root));
  const s=originals();
  const before={},expected={};
  for(const key of KEYS){
    const p=path.join(base.root,'owners',key+'.owner');
    fs.writeFileSync(p,Buffer.from(s[key]));
    before[key]=fs.readFileSync(p);
    expected[key]=tx.sha256(before[key]);
  }
  const transformed=candidatePack(s);
  const candidates=Object.fromEntries(KEYS.map(k=>[k,Buffer.from(transformed[k])]));
  const adapter=disk.openFixture(base.root,options);
  return {...base,before,expected,candidates,adapter,transformed};
}
function params(p){
  return {mode:'isolated-fixture',id:ID,adapter:p.adapter,expected:p.expected,candidates:p.candidates};
}
function state(p,key){
  const f=path.join(p.root,'owners',key+'.owner'),s=fs.statSync(f);
  return {bytes:fs.readFileSync(f),mode:s.mode&0o7777,uid:s.uid,gid:s.gid};
}
function originalsRestored(p){
  for(const key of KEYS){
    const s=state(p,key);
    assert.equal(tx.sha256(s.bytes),p.expected[key],key);
    assert.equal(s.mode,key==='exec'?0o750:0o640,key+' mode');
    assert.equal(s.uid,process.getuid(),key+' uid');
    assert.equal(s.gid,process.getgid(),key+' gid');
  }
}
function journal(p){
  return JSON.parse(fs.readFileSync(path.join(p.root,'transactions',ID,'journal.json'),'utf8'));
}
test('integration: full SHA-bound 4-owner candidate installs only in scratch and persists COMMITTED',async t=>{
  const p=prepared(t);
  const r=await tx.execute(params(p));
  assert.equal(r.ok,true);
  assert.equal(r.fixture_only,true);
  assert.equal(r.signed_install_authorized,false);
  assert.equal(journal(p).state,'COMMITTED');
  for(const key of KEYS)assert.equal(tx.sha256(state(p,key).bytes),tx.sha256(p.candidates[key]));
  const candidate=JSON.parse(state(p,'policy').bytes.toString());
  const op=candidate.operations[policy.OPERATION];
  assert.equal(op.level,4);
  assert.equal(op.risk,'critical');
  assert.equal(op.one_time_use,true);
  assert.equal(op.requires_second_confirmation,true);
  assert.equal(op.expires_seconds,180);
  const old=candidate.operations['host_action.host_action_v2_installer_v1'];
  assert.equal(old.level,3);
  const execSandbox=vm.createContext({});
  vm.runInContext(state(p,'exec').bytes.toString(),execSandbox);
  assert.equal((await vm.runInContext("applyHostActionV2('agent_zdt_source_sha_refresh_publisher_v1')",execSandbox)).ok,true);
  await assert.rejects(
    vm.runInContext("applyHostActionV2('honartik_git_worktree_fixed_v1')",execSandbox),
    /requires_separate_signed_helper_activation/);
});
for(const key of KEYS){
  for(const where of ['Before','After']){
    test('integration real disk rollback, failure '+where+' rename '+key,async t=>{
      const p=prepared(t,{[where==='Before'?'failBefore':'failAfter']:key});
      await assert.rejects(tx.execute(params(p)),/installer_tx_failed_and_rolled_back/);
      originalsRestored(p);
      assert.equal(journal(p).state,'ROLLED_BACK');
      const again=await tx.recover({mode:'isolated-fixture',id:ID,adapter:disk.openFixture(p.root),expected:p.expected});
      assert.equal(again.already,true);
    });
  }
}
test('integration: crash child process immediately after second real rename; parent recovers',async t=>{
  const p=prepared(t);
  const child=String.raw`
    const fs=require('node:fs'),path=require('node:path');
    const root=process.argv[1],t=require(process.argv[2]),d=require(process.argv[3]),
      structural=require(process.argv[4]),policy=require(process.argv[5]);
    const keys=t.ORDER;
    const old=Object.fromEntries(keys.map(k=>[k,fs.readFileSync(path.join(root,'owners',k+'.owner'),'utf8')]));
    const s=structural.patchAll(old);s.policy=policy.transform(old.policy);
    const candidates=Object.fromEntries(keys.map(k=>[k,Buffer.from(s[k])]));
    const expected=Object.fromEntries(keys.map(k=>[k,t.sha256(Buffer.from(old[k]))]));
    const adapter=d.openFixture(root);
    const original=adapter.commitCandidate;
    adapter.commitCandidate=async (id,key,stage)=>{
      await original(id,key,stage);
      if(key==='exec')process.exit(79);
    };
    t.execute({mode:'isolated-fixture',id:'honartik-integrated-disk-001',adapter,candidates,expected})
      .catch(e=>{console.error(e.message);process.exit(90);});
  `;
  const result=cp.spawnSync(process.execPath,
    ['-e',child,p.root,
      require.resolve('./honartik-iticket-root-installer-transaction-engine-v1.cjs'),
      require.resolve('./honartik-iticket-root-installer-disk-fixture-v1.cjs'),
      require.resolve('./honartik-iticket-current-owner-structural-preflight-v2.cjs'),
      require.resolve('./honartik-iticket-worktree-level4-policy-contract-v1.cjs')],
    {timeout:25000,encoding:'utf8'});
  assert.equal(result.status,79,'child stderr: '+result.stderr);
  assert.equal(journal(p).state,'APPLYING');
  assert.equal(journal(p).inflight,'exec');
  const recovered=await tx.recover({mode:'isolated-fixture',id:ID,
    adapter:disk.openFixture(p.root),expected:p.expected});
  assert.equal(recovered.ok,true);
  originalsRestored(p);
  assert.equal(journal(p).state,'ROLLED_BACK');
});
test('integration: unexpected concurrent change blocks rollback and preserves journal',async t=>{
  const p=prepared(t,{failAfter:'policy',failRollback:'policy'});
  await assert.rejects(tx.execute(params(p)),/installer_tx_recovery_required/);
  fs.writeFileSync(path.join(p.root,'owners','policy.owner'),Buffer.from('THIRD_PARTY_POLICY_WRITE'));
  await assert.rejects(tx.recover({mode:'isolated-fixture',id:ID,
    adapter:disk.openFixture(p.root),expected:p.expected}),/unrecognized_live_drift/);
  assert.equal(journal(p).state,'RECOVERY_BLOCKED');
});
test('integration: runtime unhealthy forces fully durable four-owner rollback',async t=>{
  const p=prepared(t,{failHealth:'after-apply'});
  await assert.rejects(tx.execute(params(p)),/installer_tx_failed_and_rolled_back/);
  originalsRestored(p);
  assert.equal(journal(p).state,'ROLLED_BACK');
});
test('integration: fail-closed if global L4 policy has second-confirmation disabled',()=>{
  const s=originals(),p=JSON.parse(s.policy);
  p.levels['4'].second_confirmation_required=false;
  s.policy=JSON.stringify(p);
  assert.throws(()=>candidatePack(s),/honartik_l4_policy_blocked_level4_effective_structure/);
});
test('integration: old in-memory structural policy alone is not approved as hardened Level4',()=>{
  const s=originals();
  const naive=JSON.parse(structural.patchAll(s).policy).operations[policy.OPERATION];
  assert.equal(naive.level,4);
  assert.equal(naive.requires_second_confirmation,undefined);
  assert.equal(naive.one_time_use,undefined);
  const hardened=JSON.parse(candidatePack(s).policy).operations[policy.OPERATION];
  assert.equal(hardened.requires_second_confirmation,true);
  assert.equal(hardened.one_time_use,true);
});
