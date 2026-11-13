'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const cp=require('node:child_process');
const originalPath=path.join(__dirname,'solo-universal-v2-root-transaction-contract-v1.cjs');
const source=fs.readFileSync(originalPath,'utf8');
const actual=require('./solo-universal-v2-root-transaction-contract-v1.cjs');

function harness(){
  // Only the grant validator is stubbed here. Its REAL signature/expiry tests
  // are separately exercised by test-solo-universal-v2-owner-permit-v1.cjs.
  const dummy={
    verifyOwnerPermit:()=>({
      operation:actual.FIXED.operation,signature_verified:true,
      production_authorized:false,consumed:false,
      request_id:'390ad9ce-fd10-4118-9312-6173ee443bcd',
      jti:'966f2f58-3786-46a7-b453-cb1fc96c4f3e'
    })
  };
  const m=new Module(originalPath,module);
  m.filename=originalPath;
  m.paths=Module._nodeModulePaths(__dirname);
  const parentRequire=m.require.bind(m);
  m.require=id=>id==='./solo-universal-v2-owner-permit-v1.cjs'?dummy:parentRequire(id);
  m._compile(source,originalPath);
  return m.exports;
}
function mockAdapter(tx,fault){
  const order=[];
  const driver={
    readPinnedOwnerPublicKey:async()=>{order.push('key');return 'fixture-only';},
    lockExclusive:async()=>{order.push('lock');return async()=>{order.push('unlock')}},
    capturePreflight:async()=>{
      order.push('preflight');
      if(fault==='before')return {...tx.EXPECT_BEFORE,solo_active:false};
      return {...tx.EXPECT_BEFORE};
    },
    durablyConsumePermit:async(_plan,grant)=>{
      order.push('consume');
      if(fault==='consume')throw Error('injected_consume');
      return {operation:grant.operation,request_id:grant.request_id,jti:grant.jti,
        consumed:true,persisted:true};
    },
    journalBeforeMutation:async()=>{
      order.push('journal');
      if(fault==='journal')throw Error('injected_journal');
      return {status:'PREPARED',operation:tx.FIXED.operation,durable:true};
    },
    stagePinnedBundle:async()=>{
      order.push('stage');
      if(fault==='stage')throw Error('injected_stage');
    },
    activateObserveOnly:async()=>{
      order.push('activate');
      if(fault==='activate')throw Error('injected_activate');
    },
    capturePostflight:async()=>{
      order.push('postflight');
      if(fault==='postflight')return {...tx.EXPECT_AFTER,no_solo_restart:false};
      return {...tx.EXPECT_AFTER};
    },
    commitJournal:async()=>{
      order.push('commit');
      if(fault==='commit')throw Error('injected_commit');
      return {status:'COMMITTED',durable:true};
    },
    rollbackFromJournal:async()=>{
      order.push('rollback');
      if(fault==='rollback')throw Error('injected_rollback');
      return {status:'ROLLED_BACK',durable:true,solo_state_unchanged:true};
    },
    recordFailClosed:async(_,code)=>{order.push('record:'+code);}
  };
  return {driver,order};
}
const options=driver=>({
  token:'FIXTURE_SYNTHETIC_NOT_REAL',requestId:'390ad9ce-fd10-4118-9312-6173ee443bcd',
  nowSeconds:1794449000,adapter:driver});
test('fixed operation is identity-locked and does not grant universal control',()=>{
  const x=actual.verifyPlan(actual.FIXED);
  assert.equal(x.production_authorized,false);
  assert.equal(actual.FIXED.runtime_restart,false);
  assert.equal(actual.FIXED.runtime_state_mutation,false);
  assert.equal(actual.FIXED.universal_controls_solo_deploy,false);
  assert.equal(actual.FIXED.expected_unmodified_v1_profiles,6);
  assert.equal(actual.FIXED.target_profile_sha.length,64);
  for(const [key,value] of [
    ['operation','host_action.solo_company_runtime_registration_v1'],
    ['source_universal_bundle_sha','0'.repeat(64)],
    ['target_profile_sha','a'.repeat(64)],
    ['runtime_restart',true],
    ['expected_unmodified_v1_profiles',5],
    ['universal_controls_solo_deploy',true]
  ])assert.throws(()=>actual.verifyPlan({...actual.FIXED,[key]:value}),
     /plan_not_pinned/,key);
  assert.throws(()=>actual.verifyPlan({...actual.FIXED,newField:1}),
    /plan_not_pinned/);
});
test('positive synthetic flow consumes once before any mutation and observes only',async()=>{
  const tx=harness(),{driver,order}=mockAdapter(tx);
  const result=await tx.applySignedOwnerTransaction(options(driver));
  assert.equal(result.status,'COMMITTED');
  assert.equal(result.solo_restart,false);
  assert.equal(result.managed_by_universal,false);
  assert.equal(result.owner_grant_consumed,true);
  assert.deepEqual(order,[
    'lock','preflight','key','consume','journal','stage','activate',
    'postflight','commit','unlock'
  ]);
});
test('preflight drift fails before key read, receipt consumption and mutation',async()=>{
  const tx=harness(),{driver,order}=mockAdapter(tx,'before');
  await assert.rejects(tx.applySignedOwnerTransaction(options(driver)),
    /evidence_not_pinned_before/);
  assert.deepEqual(order,['lock','preflight','unlock']);
});
test('missing adapter never requests root and cannot bypass authority',async()=>{
  const tx=harness();
  await assert.rejects(tx.applySignedOwnerTransaction({...options(null)}),
    /independent_signed_root_adapter_missing/);
});
test('errors before durable journal never initiate production writes',async()=>{
  for(const failAt of ['consume','journal']){
    const tx=harness(),{driver,order}=mockAdapter(tx,failAt);
    await assert.rejects(tx.applySignedOwnerTransaction(options(driver)),
      /injected_/);
    assert.equal(order.includes('stage'),false);
    assert.equal(order.includes('activate'),false);
    assert.equal(order.includes('rollback'),false);
    assert.equal(order.at(-1),'unlock');
    if(failAt==='journal')
      assert.equal(order.includes('record:GRANT_CONSUMED_NO_RETRY'),true);
  }
});
test('failures during stage, activate, postflight or commit require rollback',async()=>{
  for(const failAt of ['stage','activate','postflight','commit']){
    const tx=harness(),{driver,order}=mockAdapter(tx,failAt);
    await assert.rejects(tx.applySignedOwnerTransaction(options(driver)),
      /injected_|evidence_not_pinned/);
    assert.equal(order.includes('rollback'),true,failAt);
    assert.equal(order.includes('record:ROLLBACK_COMPLETE'),true,failAt);
    assert.equal(order.includes('record:GRANT_CONSUMED_NO_RETRY'),true,failAt);
    assert.equal(order.at(-1),'unlock');
    assert.ok(order.indexOf('consume')<order.indexOf('stage'));
  }
});
test('recovery failure becomes a hard incident and never treats it as success',async()=>{
  const tx=harness(),{driver,order}=mockAdapter(tx,'activate');
  driver.rollbackFromJournal=async()=>{
    order.push('rollback');
    throw Error('injected_rollback');
  };
  await assert.rejects(tx.applySignedOwnerTransaction(options(driver)),error=>{
    assert.equal(error instanceof AggregateError,true);
    assert.match(error.message,/ROOT_RECOVERY_REQUIRED/);
    return true;
  });
  assert.equal(order.at(-1),'unlock');
  assert.equal(order.includes('commit'),false);
});
test('no standalone root CLI, signer or live service controls',()=>{
  for(const method of ['issueOwnerGrant','startProduction','runAsRoot',
     'restartSolo','bypassPermit'])assert.equal(typeof actual[method],'undefined');
  for(const pattern of [/systemctl restart/,/execSync\(/,/spawnSync\(/,
     /generateKeyPair\(/,/createPrivateKey\(/,/fs\.writeFileSync\(/])
    assert.doesNotMatch(source,pattern);
  const result=cp.spawnSync(process.execPath,[originalPath],{encoding:'utf8'});
  assert.equal(result.status,64);
  assert.match(result.stderr,/SOURCE_ONLY_NO_ROOT_EXECUTOR/);
});
