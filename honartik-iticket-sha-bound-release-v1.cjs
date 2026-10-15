'use strict';
/**
 * Honartik iTicket release coordinator. Git-first, fixed SHA, no caller paths.
 * Execution adapter MUST be a registered Host Actions v2 action whose
 * one-time Ed25519 authorization is consumed by the trusted Control Plane.
 * Importing this module / calling the CLI never touches Production.
 */
const PINS = Object.freeze({
  action: 'honartik_iticket_sha_bound_release_v1',
  schema: 'prhm.honartik-iticket-release.v1',
  backend: Object.freeze({
    repo: 'prhmonline/honar-back-new',
    root: '/home/honartik/domains/dashboard.honartik.ir/public_html',
    previous: '502376d0360a338f9522e4a2be5f9dccc91408d7',
    target: '91f11681d1689ca0a042ecca32fd82c93a0da88b'
  }),
  frontend: Object.freeze({
    repo: 'prhmonline/Honar-front-new',
    root: '/home/honartik/domains/honartik.ir/public_html',
    previous: '87580ce105eff53d7142d0ca1d5267d0f4097bb2',
    target: 'faa9762cdca0ff189989f06da7a0c20ca9d7fa68'
  }),
  migrations: Object.freeze([
    'm261014_123000_create_iticket_checkout_intent',
    'm261014_193000_create_iticket_bank_receipt',
    'm261014_201000_create_iticket_clearing_entry'
  ]),
  permittedUntracked: Object.freeze({
    backend: Object.freeze(['honartik-28000-refresh-905d3af8f914b0e4.xlsx']),
    frontend: Object.freeze(['public/chat-transfer-28000-905d3af8.xlsx'])
  }),
  health: Object.freeze([
    'https://honartik.ir/api/health',
    'http://127.0.0.1:6006/api/health'
  ])
});
const SHA = /^[a-f0-9]{40}$/;
class ReleaseGateError extends Error {
  constructor(code) { super(code); this.name = 'ReleaseGateError'; this.code = code; }
}
function deny(code) { throw new ReleaseGateError(code); }
function verifyContract() {
  for (const role of ['backend','frontend']) {
    if (!SHA.test(PINS[role].previous) || !SHA.test(PINS[role].target)
      || PINS[role].previous === PINS[role].target) deny('invalid_fixed_git_identity');
  }
  if (new Set(PINS.migrations).size !== 3) deny('migration_manifest_invalid');
  return true;
}
function exactList(value, expected) {
  if (!Array.isArray(value)) return false;
  return value.length === expected.length &&
    value.slice().sort().every((v,i)=>v === expected.slice().sort()[i]);
}
function boundedReceipt(r, name) {
  if (!r || r.ok !== true || typeof r.id !== 'string' ||
      !/^[a-zA-Z0-9._:-]{8,128}$/.test(r.id)) deny(name+'_evidence_missing');
  return {id:r.id};
}
function verifyState(s) {
  verifyContract();
  if (!s || typeof s !== 'object') deny('server_inventory_missing');
  for (const role of ['backend','frontend']) {
    const row=s[role];
    if (!row || row.root!==PINS[role].root) deny(role+'_root_mismatch');
    if (row.head!==PINS[role].previous) deny(role+'_base_sha_drift');
    if (!Array.isArray(row.dirtyTracked) || row.dirtyTracked.length!==0)
      deny(role+'_tracked_worktree_dirty');
    if (!exactList(row.untracked,PINS.permittedUntracked[role]))
      deny(role+'_untracked_preservation_unproven');
    if (row.pinnedSourceObjectVerified!==true || row.pinnedSourceTreeVerified!==true)
      deny(role+'_pinned_source_unavailable');
  }
  if (s.currentFinancialReleaseFlagsOff!==true)
    deny('financial_switches_not_closed');
  if (s.mysql8ConnectionVerified!==true)
    deny('mysql8_readiness_unproven');
  if (s.releaseOperatorRegistered!==true)
    deny('signed_host_action_not_registered');
  return true;
}
function verifyTests(result) {
  if (!result || result.backendTarget!==PINS.backend.target ||
      result.frontendTarget!==PINS.frontend.target ||
      result.backendContractExit!==0 || result.backendPassMarkers<83 ||
      result.frontendContractPassed!==true ||
      result.mysql8Yii2IntegrationPassed!==true ||
      result.concurrentCallbackIdempotencyPassed!==true ||
      result.seatPaymentReconciliationPassed!==true)
      deny('isolated_release_tests_incomplete');
  return true;
}
function verifyApproval(approval, operation) {
  // This must come from the trusted control plane's consumed-approval boundary,
  // NEVER from browser JSON or operator-supplied fields.
  if (!approval || approval.consumedByTrustedControlPlane!==true ||
      approval.oneTime!==true || approval.operation!==operation ||
      approval.backendSha!==PINS.backend.target ||
      approval.frontendSha!==PINS.frontend.target ||
      typeof approval.receiptId!=='string' || approval.receiptId.length<8)
    deny('signed_bound_approval_missing');
}
function createReleaseCoordinator(ops) {
  const required=[
    'inspect','consumeApproval','testIsolated','backupAndVerify',
    'applyMigrations','promoteCode','healthCheck','verifyDark',
    'rollbackApplication','verifyRollback','armPilot','verifyPilotFinancialEvidence',
    'armPublic','disarmPurchases','writeAudit'
  ];
  for (const name of required) if (typeof ops?.[name]!=='function') deny('trusted_adapter_missing_'+name);
  let phase='new';
  const audit=async(status, extra={})=>{
    const record=Object.assign({action:PINS.action,status,
      backendSha:PINS.backend.target,frontendSha:PINS.frontend.target},extra);
    await ops.writeAudit(record);
    return record;
  };
  async function preflight() {
    if (phase!=='new') deny('phase_already_used');
    verifyState(await ops.inspect(PINS));
    await audit('preflight_passed');
    phase='preflight';
    return {ok:true,phase, pins:PINS};
  }
  async function darkDeploy() {
    if(phase!=='preflight')deny('preflight_required');
    // All tests and immutable source evidence must be verified BEFORE a live
    // backup, DDL, or service mutation.
    verifyTests(await ops.testIsolated(PINS));
    verifyApproval(await ops.consumeApproval('host_action.honartik_iticket_dark_deploy_v1',PINS),
      'host_action.honartik_iticket_dark_deploy_v1');
    const snap=boundedReceipt(await ops.backupAndVerify(PINS),'production_backup');
    let mutated=false;
    try {
      // Migration is additive. NEVER run down() on financial tables during
      // application rollback; keep receipts and clearing journal intact.
      mutated=true;
      const migration=await ops.applyMigrations(PINS.migrations);
      if (!migration || !exactList(migration.applied,PINS.migrations) ||
          migration.destructive===true) deny('migration_verification_failed');
      await ops.promoteCode(PINS);
      const health=await ops.healthCheck(PINS.health,PINS);
      if (!health || health.ok!==true || health.backendSha!==PINS.backend.target ||
          health.frontendSha!==PINS.frontend.target) deny('cutover_health_failed');
      if (await ops.verifyDark(PINS)!==true)
        deny('dark_gates_not_closed');
      phase='dark';
      return await audit('dark_deployed',{backupId:snap.id,
        migrations:PINS.migrations.slice(),publicCheckoutEnabled:false});
    } catch(e) {
      if(mutated) {
        let rollbackOk=false;
        try {
          await ops.rollbackApplication(PINS,snap.id);
          rollbackOk=await ops.verifyRollback(PINS)===true;
        } catch {}
        phase=rollbackOk?'rolled_back':'rollback_unverified';
        await audit(phase,{backupId:snap.id,issue:e.code||'release_failure',
          dbSchemaKept:true,customerFundsUntouchedByRunner:true});
        if(!rollbackOk)deny('rollback_unverified_manual_intervention_required');
      }
      throw e;
    }
  }
  async function pilot() {
    if(phase!=='dark') deny('dark_deploy_required');
    verifyApproval(await ops.consumeApproval('host_action.honartik_iticket_pilot_enable_v1',PINS),
      'host_action.honartik_iticket_pilot_enable_v1');
    const evidence=await ops.armPilot(PINS);
    if (!evidence || evidence.scopedSingleBuyerSeat!==true ||
        evidence.publicCheckoutDisabled!==true) {
      await ops.disarmPurchases();
      deny('pilot_scope_not_verified');
    }
    phase='pilot';
    return await audit('pilot_only',{publicCheckoutEnabled:false});
  }
  async function publicLaunch() {
    if(phase!=='pilot') deny('pilot_required');
    const financial=await ops.verifyPilotFinancialEvidence(PINS);
    if (!financial || financial.bankSepVerified!==true ||
        financial.sellerWalletDebitedOnce!==true ||
        financial.samfaTicketValid!==true ||
        financial.clearingJournalBalanced!==true ||
        financial.refundReconciliationTested!==true)
      deny('real_payment_to_admission_evidence_missing');
    verifyApproval(await ops.consumeApproval('host_action.honartik_iticket_public_enable_v1',PINS),
      'host_action.honartik_iticket_public_enable_v1');
    try {
      const launched=await ops.armPublic(PINS);
      if(!launched || launched.publicCheckoutEnabled!==true)
        deny('public_activation_not_verified');
      phase='public';
      return await audit('public_enabled',{publicCheckoutEnabled:true});
    }catch(e) {
      await ops.disarmPurchases();
      phase='pilot';
      await audit('public_activation_rolled_back',{issue:e.code||'activation_failure'});
      throw e;
    }
  }
  return Object.freeze({preflight,darkDeploy,pilot,publicLaunch,getPhase:()=>phase});
}
if (require.main===module) {
  // Direct shell invocation is NOT an approval or deploy surface.
  // The registered Host Actions adapter must import createReleaseCoordinator.
  process.stdout.write(JSON.stringify({ok:false,action:PINS.action,
    state:'registration_required',productionChanged:false})+'\n');
  process.exitCode=2;
}
module.exports={PINS,verifyContract,verifyState,verifyTests,
  verifyApproval,createReleaseCoordinator,ReleaseGateError};
