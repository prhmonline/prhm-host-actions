'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const {
 PINS,verifyState,verifyApproval,verifyTests,createReleaseCoordinator
}=require('./honartik-iticket-sha-bound-release-v1.cjs');
function state(){
  const item=role=>({
    root:PINS[role].root,head:PINS[role].previous,
    dirtyTracked:[],untracked:[...PINS.permittedUntracked[role]],
    pinnedSourceObjectVerified:true,pinnedSourceTreeVerified:true
  });
  return {backend:item('backend'),frontend:item('frontend'),
    currentFinancialReleaseFlagsOff:true,databaseEngine:'MariaDB',
    databaseVersion:'10.6.21-MariaDB',databaseSchemaName:'honartik_db',
    mariadb106ConnectionVerified:true,
    releaseOperatorRegistered:true};
}
function mock(options={}){
  const trace=[],audits=[];
  let durablePhase='new';
  const approval=(operation)=>({
    consumedByTrustedControlPlane:true,oneTime:true,operation,
    backendSha:PINS.backend.target,frontendSha:PINS.frontend.target,
    receiptId:'signedreceipt-1234'
  });
  const ops={
    readState:async()=>{trace.push('read_state');return {
      phase:durablePhase,backendSha:PINS.backend.target,frontendSha:PINS.frontend.target
    };},
    writeState:async(record)=>{
      trace.push('state:'+record.expectedPhase+'->'+record.nextPhase);
      if(options.stateCasFails || durablePhase!==record.expectedPhase ||
        record.backendSha!==PINS.backend.target ||
        record.frontendSha!==PINS.frontend.target) return {casCommitted:false};
      durablePhase=record.nextPhase;
      return {casCommitted:true};
    },
    inspect:async()=>{trace.push('inspect');return options.state||state();},
    testIsolated:async()=>{trace.push('tests');return {
      backendTarget:PINS.backend.target,frontendTarget:PINS.frontend.target,
      backendContractExit:0,backendPassMarkers:83,frontendContractPassed:true,
      mariadb106Yii2IntegrationPassed:true,
      iticketMigrationOnRestoredMariaDb106Passed:true,
      concurrentCallbackIdempotencyPassed:true,
      seatPaymentReconciliationPassed:true,...(options.tests||{})
    };},
    consumeApproval:async(operation)=>{
      trace.push('approval:'+operation);
      return options.badApproval?{consumedByTrustedControlPlane:false}:approval(operation);
    },
    backupAndVerify:async()=>{trace.push('backup');return {ok:true,id:'backup-safe-000001'};},
    applyMigrations:async(names)=>{
      trace.push('migrations');if(options.migrationThrows)throw new Error('ddl_failed');
      return {applied:names.slice(),destructive:false};
    },
    promoteCode:async()=>{trace.push('promote');if(options.promoteThrows)throw new Error('promote_failed');},
    healthCheck:async()=>{trace.push('health');return {
      ok:!options.healthFails,backendSha:PINS.backend.target,frontendSha:PINS.frontend.target
    };},
    verifyDark:async()=>{trace.push('dark');return options.darkFails!==true;},
    rollbackApplication:async()=>{trace.push('rollback');if(options.rollbackThrows)throw Error('rollback_failed');},
    verifyRollback:async()=>{trace.push('rollback_verification');return !options.rollbackInvalid;},
    armPilot:async()=>{trace.push('pilot');if(options.pilotThrows)throw new Error('pilot_partial');return {
      scopedSingleBuyerSeat:!options.pilotInvalid,publicCheckoutDisabled:true
    };},
    verifyPilotFinancialEvidence:async()=>{trace.push('financial_proof');return {
      bankSepVerified:true,sellerWalletDebitedOnce:true,samfaTicketValid:true,
      clearingJournalBalanced:true,refundReconciliationTested:!options.refundUnproven
    };},
    armPublic:async()=>{trace.push('public');if(options.activationThrows)throw new Error('public_failed');return {publicCheckoutEnabled:true};},
    disarmPurchases:async()=>{trace.push('disarm');if(options.disarmThrows)throw new Error('disarm_failed');},
    writeAudit:async(record)=>{trace.push('audit:'+record.status);if(options.auditFailsOn===record.status)throw new Error('audit_failed');audits.push(record);}
  };
  return {ops,trace,audits};
}
test('pinned production roots, base and release SHAs never diverge',()=>{
  assert.equal(PINS.backend.target,'da84941ec7048ced20c5c2d6d2bd01e058e66d64');
  assert.equal(PINS.frontend.target,'faa9762cdca0ff189989f06da7a0c20ca9d7fa68');
  assert.equal(PINS.backend.previous,'502376d0360a338f9522e4a2be5f9dccc91408d7');
  assert.equal(PINS.frontend.previous,'87580ce105eff53d7142d0ca1d5267d0f4097bb2');
  assert.equal(PINS.migrations.length,3);
});
test('default CLI cannot mutate production, request authorization or accept paths',()=>{
  const result=cp.spawnSync(process.execPath,
    [path.join(__dirname,'honartik-iticket-sha-bound-release-v1.cjs')],
    {encoding:'utf8'});
  assert.equal(result.status,2);
  assert.equal(JSON.parse(result.stdout).productionChanged,false);
  assert.equal(JSON.parse(result.stdout).state,'registration_required');
});
test('pinned server inventory must be exact and known customer files preserved',()=>{
  assert.doesNotThrow(()=>verifyState(state()));
  const cases=[
    x=>x.backend.head='a'.repeat(40),
    x=>x.frontend.pinnedSourceObjectVerified=false,
    x=>x.backend.pinnedSourceTreeVerified=false,
    x=>x.frontend.dirtyTracked.push('src/app/page.tsx'),
    x=>x.frontend.untracked=[],
    x=>x.currentFinancialReleaseFlagsOff=false,
    x=>x.mariadb106ConnectionVerified=false,
    x=>x.databaseEngine='MySQL',
    x=>x.databaseVersion='8.0.44',
    x=>x.databaseVersion='10.5.28-MariaDB',
    x=>x.databaseVersion='10.11.9-MariaDB',
    x=>x.databaseSchemaName='another_database',
    x=>x.releaseOperatorRegistered=false,
    x=>x.backend.root='/tmp/lookalike'
  ];
  for(const change of cases){const x=state();change(x);assert.throws(()=>verifyState(x));}
});
test('no unsigned, wrong-SHA or non-consumed production approvals',()=>{
  const base={consumedByTrustedControlPlane:true,oneTime:true,
    operation:'host_action.honartik_iticket_dark_deploy_v1',
    backendSha:PINS.backend.target,frontendSha:PINS.frontend.target,receiptId:'receipt-1234567'};
  assert.doesNotThrow(()=>verifyApproval(base,base.operation));
  for(const patch of [
    {consumedByTrustedControlPlane:false},{oneTime:false},
    {backendSha:'f'.repeat(40)},{frontendSha:'f'.repeat(40)},
    {operation:'other'},{receiptId:'x'}]){
    assert.throws(()=>verifyApproval({...base,...patch},base.operation));
  }
});
test('test markers cannot substitute for real MariaDB 10.6/Yii2 and restored-schema E2E',()=>{
  const x={backendTarget:PINS.backend.target,frontendTarget:PINS.frontend.target,
    backendContractExit:0,backendPassMarkers:83,frontendContractPassed:true,
    mariadb106Yii2IntegrationPassed:true,
    iticketMigrationOnRestoredMariaDb106Passed:true,
    concurrentCallbackIdempotencyPassed:true,
    seatPaymentReconciliationPassed:true};
  assert.equal(verifyTests(x),true);
  for(const k of ['mariadb106Yii2IntegrationPassed','iticketMigrationOnRestoredMariaDb106Passed',
    'concurrentCallbackIdempotencyPassed',
    'seatPaymentReconciliationPassed','frontendContractPassed']){
    assert.throws(()=>verifyTests({...x,[k]:false}));
  }
});
test('successful dark release orders tests approval backup migration and health',async()=>{
  const x=mock(),c=createReleaseCoordinator(x.ops);
  await c.preflight();const done=await c.darkDeploy();
  assert.equal(done.publicCheckoutEnabled,false);
  assert.equal(c.getPhase(),'dark');
  const ops=x.trace;
  const order=['inspect','tests','approval:host_action.honartik_iticket_dark_deploy_v1',
    'backup','migrations','promote','health','dark','audit:dark_deployed'];
  assert.deepEqual(ops.filter(k=>order.includes(k)),order);
  assert.equal(x.audits.at(-1).backendSha,PINS.backend.target);
});
test('preflight rejects missing source without requesting money, DDL or approval',async()=>{
  const s=state();s.backend.pinnedSourceObjectVerified=false;
  const x=mock({state:s}),c=createReleaseCoordinator(x.ops);
  await assert.rejects(c.preflight(),/backend_pinned_source_unavailable/);
  assert.deepEqual(x.trace,['read_state','inspect']);
});
test('incomplete real MySQL integration blocks before approval or mutation',async()=>{
  const x=mock({tests:{mariadb106Yii2IntegrationPassed:false}}),c=createReleaseCoordinator(x.ops);
  await c.preflight();
  await assert.rejects(c.darkDeploy(),/isolated_release_tests_incomplete/);
  assert.ok(!x.trace.includes('backup'));
  assert.ok(!x.trace.some(k=>k.startsWith('approval:')));
});
test('unsigned approval blocks ahead of backup and database changes',async()=>{
  const x=mock({badApproval:true}),c=createReleaseCoordinator(x.ops);
  await c.preflight();
  await assert.rejects(c.darkDeploy(),/signed_bound_approval_missing/);
  assert.ok(!x.trace.includes('backup'));
});
test('schema migration failure rolls back app, but never deletes receipt tables',async()=>{
  const x=mock({migrationThrows:true}),c=createReleaseCoordinator(x.ops);
  await c.preflight();await assert.rejects(c.darkDeploy(),/ddl_failed/);
  assert.equal(c.getPhase(),'rolled_back');
  assert.ok(x.trace.includes('rollback'));
  assert.equal(x.audits.at(-1).dbSchemaKept,true);
  assert.ok(!x.trace.includes('promote'));
});
test('bad production health rolls back after cutover and verifies backup',async()=>{
  const x=mock({healthFails:true}),c=createReleaseCoordinator(x.ops);
  await c.preflight();await assert.rejects(c.darkDeploy(),/cutover_health_failed/);
  assert.equal(c.getPhase(),'rolled_back');
  assert.ok(x.trace.includes('rollback_verification'));
});
test('failed rollback is never declared success',async()=>{
  const x=mock({healthFails:true,rollbackThrows:true}),c=createReleaseCoordinator(x.ops);
  await c.preflight();await assert.rejects(c.darkDeploy(),/rollback_unverified_manual_intervention_required/);
  assert.equal(c.getPhase(),'rollback_unverified');
});
test('pilot cannot start before dark deploy',async()=>{
  const x=mock(),c=createReleaseCoordinator(x.ops);
  await c.preflight();await assert.rejects(c.pilot(),/dark_deploy_required/);
});
test('public launch requires real financial reconciliation proof',async()=>{
  const x=mock({refundUnproven:true}),c=createReleaseCoordinator(x.ops);
  await c.preflight();await c.darkDeploy();await c.pilot();
  await assert.rejects(c.publicLaunch(),/real_payment_to_admission_evidence_missing/);
  assert.equal(c.getPhase(),'pilot');
  assert.ok(!x.trace.includes('public'));
});
test('only fully attested signed pilot permits public launch',async()=>{
  const x=mock(),c=createReleaseCoordinator(x.ops);
  await c.preflight();await c.darkDeploy();await c.pilot();
  const done=await c.publicLaunch();
  assert.equal(done.publicCheckoutEnabled,true);
  assert.equal(c.getPhase(),'public');
  assert.ok(x.trace.includes('approval:host_action.honartik_iticket_public_enable_v1'));
});
test('activation failure disarms rather than leaving partial public checkout',async()=>{
  const x=mock({activationThrows:true}),c=createReleaseCoordinator(x.ops);
  await c.preflight();await c.darkDeploy();await c.pilot();
  await assert.rejects(c.publicLaunch(),/public_failed/);
  assert.equal(c.getPhase(),'pilot');
  assert.ok(x.trace.includes('disarm'));
});

test('Host Action restart resumes persisted stage without replaying migration',async()=>{
  const x=mock();
  const first=createReleaseCoordinator(x.ops);
  await first.preflight();
  await first.darkDeploy();
  const afterRestart=createReleaseCoordinator(x.ops);
  await afterRestart.pilot();
  assert.equal(afterRestart.getPhase(),'pilot');
  assert.equal(x.trace.filter(k=>k==='migrations').length,1);
  const launchWorker=createReleaseCoordinator(x.ops);
  const result=await launchWorker.publicLaunch();
  assert.equal(result.publicCheckoutEnabled,true);
  assert.equal(launchWorker.getPhase(),'public');
});
test('CAS conflict refuses to record a false preflight',async()=>{
  const x=mock({stateCasFails:true});
  const c=createReleaseCoordinator(x.ops);
  await assert.rejects(c.preflight(),/durable_release_state_conflict/);
  assert.equal(c.getPhase(),'new');
});

test('partial pilot exception disarms payment and retains dark state',async()=>{
  const x=mock({pilotThrows:true});
  const c=createReleaseCoordinator(x.ops);
  await c.preflight();await c.darkDeploy();
  await assert.rejects(c.pilot(),/pilot_partial/);
  assert.equal(c.getPhase(),'dark');
  assert.ok(x.trace.includes('disarm'));
  assert.equal(x.audits.at(-1).publicCheckoutEnabled,false);
});
test('invalid pilot scope disarms before public availability',async()=>{
  const x=mock({pilotInvalid:true});
  const c=createReleaseCoordinator(x.ops);
  await c.preflight();await c.darkDeploy();
  await assert.rejects(c.pilot(),/pilot_scope_not_verified/);
  assert.ok(x.trace.includes('disarm'));
  assert.ok(!x.trace.includes('public'));
});
test('failed disarm leaves a deliberate critical manual-intervention error',async()=>{
  const x=mock({pilotThrows:true,disarmThrows:true});
  const c=createReleaseCoordinator(x.ops);
  await c.preflight();await c.darkDeploy();
  await assert.rejects(c.pilot(),/pilot_disarm_unverified_manual_intervention_required/);
});

test('pilot audit failure disarms and reverts durable state',async()=>{
  const x=mock({auditFailsOn:'pilot_only'});
  const c=createReleaseCoordinator(x.ops);
  await c.preflight();await c.darkDeploy();
  await assert.rejects(c.pilot(),/audit_failed/);
  assert.equal(c.getPhase(),'dark');
  assert.ok(x.trace.includes('disarm'));
  assert.ok(x.trace.includes('state:pilot->dark'));
});
test('public audit failure disarms and reverts durable state',async()=>{
  const x=mock({auditFailsOn:'public_enabled'});
  const c=createReleaseCoordinator(x.ops);
  await c.preflight();await c.darkDeploy();await c.pilot();
  await assert.rejects(c.publicLaunch(),/audit_failed/);
  assert.equal(c.getPhase(),'pilot');
  assert.ok(x.trace.includes('state:public->pilot'));
  assert.ok(x.trace.includes('disarm'));
});
test('public failure plus failed disarm blocks all further automated transitions',async()=>{
  const x=mock({activationThrows:true,disarmThrows:true});
  const c=createReleaseCoordinator(x.ops);
  await c.preflight();await c.darkDeploy();await c.pilot();
  await assert.rejects(c.publicLaunch(),/public_disarm_or_phase_rollback_unverified_manual_intervention_required/);
  assert.equal(c.getPhase(),'pilot');
});
