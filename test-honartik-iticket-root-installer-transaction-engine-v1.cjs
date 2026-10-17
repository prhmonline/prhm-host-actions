'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const engine=require('./honartik-iticket-root-installer-transaction-engine-v1.cjs');
const {ORDER,sha256,execute,recover,SCHEMA}=engine;
const copy=(o)=>({...o,bytes:Buffer.from(o.bytes)});
const deep=(v)=>JSON.parse(JSON.stringify(v));
const id='isolated-case-001';

function fixture(options={}){
  const owners={},original={},candidates={},expected={};
  for(const key of ORDER){
    const before={bytes:Buffer.from('fixture-only-original-owner-'+key),
      uid:20,gid:50,mode:key==='exec'?0o750:0o640};
    owners[key]=copy(before);original[key]=copy(before);
    candidates[key]=Buffer.from('fixture-only-replacement-owner-'+key);
    expected[key]=sha256(before.bytes);
  }
  const backups=new Map(),journals=new Map(),stages=new Map();
  const calls={commits:[],restores:[],intents:[],health:[],backup_count:0};
  let locked=false;
  let restoreFailed=false,writeFailed=false;
  const adapter={
    async lock(transaction){assert.equal(transaction,id);if(locked)throw Error('busy');locked=true;},
    async unlock(transaction){assert.equal(transaction,id);assert.equal(locked,true);locked=false;},
    async ensureNoUnresolved(transaction){
      const prev=journals.get(transaction);
      if(prev&&!['ROLLED_BACK','COMMITTED'].includes(prev.state))throw Error('pending');
    },
    async readOwner(key){return copy(owners[key]);},
    async writeBackupDurable(transaction,key,snapshot){
      calls.backup_count++;
      backups.set(key,copy(snapshot));
      return {durable:!options.nonDurableBackup};
    },
    async readBackup(transaction,key){return copy(backups.get(key));},
    async writeJournalDurable(j){
      if(options.failWriteJournalOnce && j.state==='APPLYING' && !writeFailed &&
         j.completed.length===options.failWriteJournalAtCompleted){
        writeFailed=true;throw Error('journal_write_error');
      }
      journals.set(j.id,deep(j));
      calls.intents.push({state:j.state,inflight:j.inflight,completed:j.completed.slice()});
      return {durable:!options.nonDurableJournal};
    },
    async loadJournal(transaction){return deep(journals.get(transaction));},
    async stageCandidate(transaction,key,bytes,metadata){
      if(options.failStageAt===key)throw Error('simulated_stage_fail_'+key);
      stages.set(key,{bytes:Buffer.from(bytes),
        uid:metadata.uid,gid:metadata.gid,mode:metadata.mode});
      return key;
    },
    async commitCandidate(transaction,key,handle){
      if(options.failBeforeCommitAt===key)throw Error('simulated_precommit_fail_'+key);
      const state=stages.get(handle);
      owners[key]=copy(state);
      calls.commits.push(key);
      if(options.changeMetadataAt===key)owners[key].uid++;
      if(options.externalDriftAt===key)owners[key].bytes=Buffer.from('outside-unknown-owner');
      if(options.failAfterCommitAt===key)throw Error('simulated_after_rename_crash_'+key);
    },
    async restoreBackup(transaction,key,snapshot){
      if(options.failRestoreOnceAt===key&&!restoreFailed){
        restoreFailed=true;throw Error('simulated_restore_disk_error_'+key);
      }
      owners[key]=copy(snapshot);
      calls.restores.push(key);
    },
    async verifyRuntime(phase){
      calls.health.push(phase);
      if(options.failHealthOn===phase)return {ok:false};
      return {ok:true};
    },
    async cleanupStages(){if(options.failCleanup)throw Error('cleanup_failed');stages.clear();}
  };
  return {adapter,owners,original,candidates,expected,backups,journals,calls,stages};
}
function params(f){return {mode:'isolated-fixture',id,adapter:f.adapter,
  candidates:f.candidates,expected:f.expected};}
function assertRestored(f){
  for(const k of ORDER){
    assert.equal(sha256(f.owners[k].bytes),f.expected[k],k);
    assert.equal(f.owners[k].uid,f.original[k].uid,k+' uid');
    assert.equal(f.owners[k].gid,f.original[k].gid,k+' gid');
    assert.equal(f.owners[k].mode,f.original[k].mode,k+' mode');
  }
}

test('four-owner healthy fixture transaction: all SHA and metadata verified',async()=>{
  const f=fixture();
  const r=await execute(params(f));
  assert.equal(r.ok,true);assert.equal(r.fixture_only,true);
  assert.equal(r.signed_install_authorized,false);
  assert.deepEqual(f.calls.commits,ORDER);
  assert.equal(f.journals.get(id).state,'COMMITTED');
  for(const k of ORDER)assert.equal(sha256(f.owners[k].bytes),sha256(f.candidates[k]));
  assert.equal(f.calls.backup_count,4);
  assert.ok(f.calls.intents.some(j=>j.inflight==='mcp'));
  assert.ok(f.calls.health.includes('after-apply'));
});

for(const key of ORDER){
  test('rollback when rename fails BEFORE '+key,async()=>{
    const f=fixture({failBeforeCommitAt:key});
    await assert.rejects(execute(params(f)),/installer_tx_failed_and_rolled_back/);
    assertRestored(f);
    assert.equal(f.journals.get(id).state,'ROLLED_BACK');
    assert.deepEqual(f.calls.restores,[...ORDER.slice(0,ORDER.indexOf(key))].reverse());
  });
  test('rollback when rename succeeded but returned error AFTER '+key,async()=>{
    const f=fixture({failAfterCommitAt:key});
    await assert.rejects(execute(params(f)),/installer_tx_failed_and_rolled_back/);
    assertRestored(f);
    assert.equal(f.journals.get(id).state,'ROLLED_BACK');
    assert.deepEqual(f.calls.restores,[...ORDER.slice(0,ORDER.indexOf(key)+1)].reverse());
  });
}

test('rollback if staged candidate creation fails before modifying next owner',async()=>{
  const f=fixture({failStageAt:'policy'});
  await assert.rejects(execute(params(f)),/installer_tx_failed_and_rolled_back/);
  assertRestored(f);
  assert.deepEqual(f.calls.restores,['exec','base']);
});

test('rollback on metadata drift even with correct candidate content',async()=>{
  const f=fixture({changeMetadataAt:'base'});
  await assert.rejects(execute(params(f)),/installer_tx_failed_and_rolled_back/);
  assertRestored(f);
  assert.deepEqual(f.calls.restores,['base']);
});

test('rollback on runtime health failure after all four changes',async()=>{
  const f=fixture({failHealthOn:'after-apply'});
  await assert.rejects(execute(params(f)),/installer_tx_failed_and_rolled_back/);
  assertRestored(f);
  assert.deepEqual(f.calls.restores,[...ORDER].reverse());
  assert.equal(f.calls.health.at(-1),'rollback');
});

test('reject fake backup durability BEFORE any mutation',async()=>{
  const f=fixture({nonDurableBackup:true});
  await assert.rejects(execute(params(f)),/durability_not_attested_backup_base/);
  assertRestored(f);
  assert.deepEqual(f.calls.commits,[]);
  assert.equal(f.journals.size,0);
});

test('reject fake journal durability BEFORE any mutation',async()=>{
  const f=fixture({nonDurableJournal:true});
  await assert.rejects(execute(params(f)),/durability_not_attested_journal/);
  assertRestored(f);
  assert.deepEqual(f.calls.commits,[]);
});

test('journal failure AFTER earlier renames triggers scan-and-restore',async()=>{
  const f=fixture({failWriteJournalOnce:true,failWriteJournalAtCompleted:1});
  await assert.rejects(execute(params(f)),/installer_tx_failed_and_rolled_back/);
  assertRestored(f);
  assert.deepEqual(f.calls.restores,['base']);
});

test('simulated process kill after second rename: recover from durable intent',async()=>{
  const f=fixture();
  const owners=Object.fromEntries(ORDER.map(k=>[k,{before:f.expected[k],
    after:sha256(f.candidates[k]),uid:20,gid:50,mode:f.original[k].mode}]));
  for(const k of ORDER)f.backups.set(k,copy(f.original[k]));
  f.journals.set(id,{schema:SCHEMA,id,state:'APPLYING',owners,
    completed:['base'],inflight:'exec',recovery_attempts:0});
  for(const k of ['base','exec'])f.owners[k].bytes=Buffer.from(f.candidates[k]);
  const r=await recover({mode:'isolated-fixture',id,adapter:f.adapter,expected:f.expected});
  assert.equal(r.ok,true);assertRestored(f);
  assert.deepEqual(f.calls.restores,['exec','base']);
  assert.equal(f.journals.get(id).state,'ROLLED_BACK');
  const again=await recover({mode:'isolated-fixture',id,adapter:f.adapter,expected:f.expected});
  assert.equal(again.already,true);
});

test('recovery is fail-closed on a third-party unexpected owner hash',async()=>{
  const f=fixture({externalDriftAt:'exec'});
  await assert.rejects(execute(params(f)),/installer_tx_recovery_required:.*unrecognized_live_drift/);
  assert.equal(f.journals.get(id).state,'RECOVERY_BLOCKED');
  assert.deepEqual(f.calls.restores,[]);
  assert.notEqual(sha256(f.owners.exec.bytes),f.expected.exec);
});

test('failed recovery leaves journal for retry, then successfully recovers',async()=>{
  const f=fixture({failAfterCommitAt:'policy',failRestoreOnceAt:'policy'});
  await assert.rejects(execute(params(f)),/installer_tx_recovery_required:.*simulated_restore_disk_error_policy/);
  assert.equal(f.journals.get(id).state,'APPLYING');
  const r=await recover({mode:'isolated-fixture',id,adapter:f.adapter,expected:f.expected});
  assert.equal(r.ok,true);assertRestored(f);
  assert.equal(f.journals.get(id).state,'ROLLED_BACK');
});

test('fixture-only hard block on use for Production',async()=>{
  const f=fixture();
  await assert.rejects(execute({...params(f),mode:'production'}),/production_execution_unavailable/);
  await assert.rejects(recover({mode:'production',id,adapter:f.adapter,expected:f.expected}),/production_execution_unavailable/);
  assert.equal(f.calls.commits.length,0);
});

test('wrong live SHA before first write aborts without changing anything',async()=>{
  const f=fixture();
  f.owners.policy.bytes=Buffer.from('modified externally');
  await assert.rejects(execute(params(f)),/source_preimage_mismatch_policy/);
  assert.deepEqual(f.calls.commits,[]);
  assert.equal(f.journals.size,0);
});

test('unsupported candidate mapping aborts before lock',async()=>{
  const f=fixture();
  delete f.candidates.mcp;
  await assert.rejects(execute(params(f)),/candidate_keys_invalid/);
  assert.deepEqual(f.calls.commits,[]);
});

test('transaction module does not read server paths or perform filesystem writes',()=>{
  const fs=require('node:fs');
  const source=fs.readFileSync(require.resolve('./honartik-iticket-root-installer-transaction-engine-v1.cjs'),'utf8');
  assert.deepEqual(Object.keys(engine).sort(),['SCHEMA','ORDER','EXPECTED','sha256','execute','recover'].sort());
  for(const x of ["require('fs')","require('node:fs')","child_process","process.argv","process.env",
    "fs.writeFileSync(","fs.renameSync(","systemctl","systemd-run","sudo "])
    assert.equal(source.includes(x),false,'dangerous primitive '+x);
});

test('post-commit stage cleanup failure reports warning but leaves valid COMMITTED receipt',async()=>{
  const f=fixture({failCleanup:true});
  const r=await execute(params(f));
  assert.equal(r.ok,true);
  assert.equal(r.cleanupComplete,false);
  assert.equal(f.journals.get(id).state,'COMMITTED');
  assert.deepEqual(f.calls.commits,ORDER);
});

test('post-rollback stage cleanup failure cannot disguise verified rollback',async()=>{
  const f=fixture({failCleanup:true,failAfterCommitAt:'exec'});
  await assert.rejects(execute(params(f)),/installer_tx_failed_and_rolled_back/);
  assert.equal(f.journals.get(id).state,'ROLLED_BACK');
  assertRestored(f);
});
