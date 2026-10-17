'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {createFixture,openFixture,destroyFixture}=require('./honartik-iticket-root-installer-disk-fixture-v1.cjs');
const engine=require('./honartik-iticket-root-installer-transaction-engine-v1.cjs');
const {ORDER,sha256,execute,recover}=engine;
const TX='disk-fixture-case-001';
const setup=(t,opts={})=>{
  const f=createFixture();
  t.after(()=>{destroyFixture(f.root);});
  return {...f,adapter:openFixture(f.root,opts)};
};
const params=(f,id=TX)=>({mode:'isolated-fixture',id,adapter:f.adapter,
  candidates:f.candidates,expected:f.expected});
function readState(f,key){
  const p=path.join(f.root,'owners',key+'.owner');
  const st=fs.lstatSync(p);
  return {sha256:sha256(fs.readFileSync(p)),uid:st.uid,gid:st.gid,mode:st.mode&0o7777};
}
function assertRestored(f){
  for(const key of ORDER){
    const s=readState(f,key);
    assert.equal(s.sha256,f.expected[key],key+' sha');
    assert.equal(s.mode,key==='exec'?0o750:0o640,key+' mode');
    assert.equal(s.uid,process.getuid(),key+' uid');
    assert.equal(s.gid,process.getgid(),key+' gid');
  }
}
const journal=(f)=>JSON.parse(fs.readFileSync(path.join(f.root,'transactions',TX,'journal.json'),'utf8'));
test('real scratch-disk commit; SHA and uid/gid/mode retained',async t=>{
  const f=setup(t);
  const result=await execute(params(f));
  assert.equal(result.ok,true);
  assert.equal(result.signed_install_authorized,false);
  assert.equal(journal(f).state,'COMMITTED');
  for(const k of ORDER){
    assert.equal(readState(f,k).sha256,sha256(f.candidates[k]));
    assert.equal(readState(f,k).mode,k==='exec'?0o750:0o640);
  }
  await assert.rejects(execute(params(f)),/transaction_id_reuse/);
});
for(const k of ORDER){
  test('real disk rollback for failed rename BEFORE '+k,async t=>{
    const f=setup(t,{failBefore:k});
    await assert.rejects(execute(params(f)),/installer_tx_failed_and_rolled_back/);
    assertRestored(f);
    assert.equal(journal(f).state,'ROLLED_BACK');
  });
  test('real disk rollback for failed rename AFTER '+k,async t=>{
    const f=setup(t,{failAfter:k});
    await assert.rejects(execute(params(f)),/installer_tx_failed_and_rolled_back/);
    assertRestored(f);
    assert.equal(journal(f).state,'ROLLED_BACK');
  });
}
test('real disk rollback is resumable after injected restore failure',async t=>{
  const f=setup(t,{failAfter:'policy',failRollback:'policy'});
  await assert.rejects(execute(params(f)),/installer_tx_recovery_required/);
  assert.equal(journal(f).state,'APPLYING');
  const retry=openFixture(f.root);
  const result=await recover({mode:'isolated-fixture',id:TX,adapter:retry,expected:f.expected});
  assert.equal(result.recovered,true);assertRestored(f);
  assert.equal(journal(f).state,'ROLLED_BACK');
});
test('real durable journal recovers after child process hard-exits immediately after second rename',async t=>{
  const f=setup(t);
  const worker=String.raw`
  const engine=require(process.argv[2]),disk=require(process.argv[3]);
  const root=process.argv[1],order=engine.ORDER;
  const expected=Object.fromEntries(order.map(k=>[k,engine.sha256(Buffer.from('DISK_FIXTURE_ORIGINAL_'+k))]));
  const candidates=Object.fromEntries(order.map(k=>[k,Buffer.from('DISK_FIXTURE_CANDIDATE_'+k)]));
  const adapter=disk.openFixture(root);
  const original=adapter.commitCandidate;
  adapter.commitCandidate=async (id,k,stage)=>{
    await original(id,k,stage);
    if(k==='exec')process.exit(86);
  };
  engine.execute({mode:'isolated-fixture',id:'disk-fixture-case-001',adapter,candidates,expected})
    .catch(e=>{console.error(e.message);process.exit(90);});
  `;
  const child=cp.spawnSync(process.execPath,
    ['-e',worker,f.root,require.resolve('./honartik-iticket-root-installer-transaction-engine-v1.cjs'),
    require.resolve('./honartik-iticket-root-installer-disk-fixture-v1.cjs')],
    {encoding:'utf8',timeout:20000});
  assert.equal(child.status,86,'child error: '+child.stderr);
  assert.equal(journal(f).state,'APPLYING');
  assert.equal(journal(f).inflight,'exec');
  assert.equal(readState(f,'exec').sha256,sha256(f.candidates.exec));
  assert.equal(readState(f,'base').sha256,sha256(f.candidates.base));
  assert.equal(readState(f,'policy').sha256,f.expected.policy);
  const retry=openFixture(f.root);
  const r=await recover({mode:'isolated-fixture',id:TX,adapter:retry,expected:f.expected});
  assert.equal(r.ok,true);
  assertRestored(f);
  assert.equal(journal(f).state,'ROLLED_BACK');
  const r2=await recover({mode:'isolated-fixture',id:TX,adapter:openFixture(f.root),expected:f.expected});
  assert.equal(r2.already,true);
});
test('unexpected third-party owner content halts and preserves recovery evidence',async t=>{
  const f=setup(t,{failAfter:'exec',failRollback:'exec'});
  await assert.rejects(execute(params(f)),/installer_tx_recovery_required/);
  const changed=path.join(f.root,'owners','exec.owner');
  fs.writeFileSync(changed,Buffer.from('UNRECOGNIZED_THIRD_PARTY_MODIFICATION'));
  await assert.rejects(recover({mode:'isolated-fixture',id:TX,adapter:openFixture(f.root),
    expected:f.expected}),/unrecognized_live_drift/);
  assert.equal(journal(f).state,'RECOVERY_BLOCKED');
  assert.equal(readState(f,'exec').sha256,sha256(Buffer.from('UNRECOGNIZED_THIRD_PARTY_MODIFICATION')));
});
test('corrupt persisted backup refuses any recovery overwrite',async t=>{
  const f=setup(t,{failAfter:'exec',failRollback:'exec'});
  await assert.rejects(execute(params(f)),/installer_tx_recovery_required/);
  const p=path.join(f.root,'transactions',TX,'base.bak');
  fs.writeFileSync(p,Buffer.from('BROKEN_BACKUP'));
  const execPrior=readState(f,'exec').sha256;
  await assert.rejects(recover({mode:'isolated-fixture',id:TX,adapter:openFixture(f.root),
    expected:f.expected}),/backup_integrity/);
  assert.equal(readState(f,'exec').sha256,execPrior);
});
test('isolated adapter rejects symlink owner and external paths',async t=>{
  const f=setup(t);
  assert.throws(()=>openFixture('/opt/prhm-agent-selfmaint'),/root_invalid|root_outside_scratch/);
  const p=path.join(f.root,'owners','base.owner');
  fs.unlinkSync(p);fs.symlinkSync('/etc/hostname',p);
  await assert.rejects(execute(params(f)),/unsafe_file/);
  assert.equal(fs.existsSync(path.join(f.root,'transactions',TX,'journal.json')),false);
});
test('scratch disk adapter NEVER exposes a production install command',()=>{
  const src=fs.readFileSync(require.resolve('./honartik-iticket-root-installer-disk-fixture-v1.cjs'),'utf8');
  for(const term of ['/opt/prhm-agent-selfmaint/server.js','systemctl restart',
      "require('node:child_process')",'CONFIRM_LEVEL_4_CRITICAL','approval_token'])
    assert.equal(src.includes(term),false,'unexpected production capability: '+term);
});
