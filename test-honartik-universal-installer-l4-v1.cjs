'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('./honartik-universal-installer-l4-v1.cjs');
const C=m.CONTRACT;
const hex='a'.repeat(64);
function harness({fault='',mutatePre=null,mutateCandidate=null,mutateTests=null,
  mutateReceipt=null,mutatePost=null}={}){
  const calls=[];
  const state={installed:C.existing_digest,dbWrites:0,apacheWrites:0,appDeploys:0,
    audits:[],rollbacks:0,releases:0,consumes:0,locked:false,journalReady:false,
    journalState:'ABSENT'};
  let backup=null;
  function crash(where){if(fault===where)throw new Error('INJECTED_'+where)}
  const pre=()=>({
    installed_digest:state.installed,actual_bundle_digest:state.installed,
    manifest_digest:state.installed,manifest_previous:hex,
    manifest_entrypoint:C.installer_prefix+'/deploy-project',
    registered_config_digest:C.registry_digest,
    http_sha256:'b'.repeat(64),https_sha256:'c'.repeat(64),
    root_ownership_verified:true,no_symlinks:true,
    other_registry_projects_valid:true,...(mutatePre||{})
  });
  const candidate=()=>({bundle_digest:C.candidate_digest,
    root_owned_read_only:true,no_symlinks:true,
    python_ast_syntax_ok:true,source_closure_attested:true,
    ...(mutateCandidate||{})});
  const linux=()=>({candidate_digest:C.candidate_digest,
    trusted_linux_attestation:true,tests_total:14,tests_passed:14,
    interrupted_rollback_verified:true,negative_tests_verified:true,
    attestation_digest:'d'.repeat(64),production_mutated:false,
    ...(mutateTests||{})});
  const receipt=()=>({
    action:m.ACTION,operation:C.operation,level:4,risk:'critical',
    candidate_digest:C.candidate_digest,existing_digest:C.existing_digest,
    backend_sha:C.target_backend_sha,
    approval_id:'approval-fixture-01',
    issuer_verified:true,signature_verified:true,consumed_once:true,
    age_seconds:23,...(mutateReceipt||{})});
  const adapter={
    acquireRootOwnedInstallerLock:async contract=>{
      calls.push('lock');assert.equal(contract,C);crash('lock');state.locked=true;
      return {id:'locked-fixture-01'};},
    attestInstalledPreimage:async()=>{calls.push('pre');crash('pre');return pre()},
    attestImmutableCandidate:async()=>{calls.push('candidate');crash('candidate');return candidate()},
    attestIndependentLinuxTests:async()=>{calls.push('linux');crash('linux');return linux()},
    createDurableRecoveryJournal:async()=>{
      calls.push('journal');crash('journal');backup=state.installed;state.journalReady=true;state.journalState='PREPARED';
      return {id:'journal-fixture-01'};},
    attestJournalRecoverable:async()=>{calls.push('recoverable');crash('recoverable');return true},
    consumeSignedOneTimeL4Approval:async()=>{calls.push('approval');crash('approval');state.consumes++;return receipt()},
    installFixedBundleTransaction:async()=>{
      calls.push('install');crash('install');state.installed=C.candidate_digest;return true;},
    attestInstalledPostimage:async()=>{
      calls.push('post');crash('post');
      if(fault==='restore'||fault==='verifyRollback')throw Error('INJECTED_rollback_entry');
      return {installed_digest:state.installed,actual_bundle_digest:state.installed,
        previous_digest:C.existing_digest,manifest_digest:state.installed,
        registry_digest:C.registry_digest,cli_validation:true,
        other_registry_projects_valid:true,
        http_sha256:'b'.repeat(64),https_sha256:'c'.repeat(64),
        live_database_untouched:true,yii_migrations_executed:false,
        application_deployed:false,journal_durable:true,...(mutatePost||{})};
    },
    commitJournal:async()=>{
      calls.push('commit');
      // Faults injected AFTER the durable COMMITTED marker are ambiguous to
      // the coordinator. It must not undo an actually committed cutover.
      if(['commitAfterDurable','commitFalseAfterDurable','commitUnknown',
        'commitInspectThrows'].includes(fault)){
        state.journalState=fault==='commitUnknown'?'UNKNOWN':
          fault==='commitInspectThrows'?'PREPARED':'COMMITTED';
        if(fault==='commitFalseAfterDurable')return false;
        throw Error('INJECTED_'+fault);
      }
      crash('commit');
      state.journalState='COMMITTED';return true;
    },
    inspectDurableJournalState:async()=>{
      calls.push('inspect-commit');
      if(fault==='commitInspectThrows')throw Error('INJECTED_inspection_failed');
      return state.journalState;
    },
    restoreExactJournal:async()=>{
      calls.push('restore');state.rollbacks++;
      if(fault==='restore')return false;
      state.installed=backup;state.journalState='ROLLED_BACK';return true;},
    attestExactRollback:async()=>{
      calls.push('verifyRollback');
      return fault!=='verifyRollback'&&state.installed===C.existing_digest;},
    durableAudit:async data=>{
      calls.push('audit:'+data.event);crash('audit:'+data.event);
      state.audits.push(data.event);return true;},
    releaseInstallerLock:async()=>{calls.push('unlock');state.releases++;state.locked=false;return true;}
  };
  return {adapter,state,calls};
}
test('fixed constants and no CLI, dynamic project, SHA or path parameters',()=>{
 assert.equal(m.ACTION,'honartik_universal_installer_upgrade_v1');
 assert.equal(C.existing_digest.length,64);assert.equal(C.candidate_digest.length,64);
 assert.equal(C.no_yii_migrations,true);assert.equal(C.installer_only,true);
 assert.deepEqual(m.noRuntimeArguments([]),{
   action:m.ACTION,source_only:true,registered:false,may_install:false});
 assert.throws(()=>m.noRuntimeArguments(['--command','rm']),/runtime_arguments_forbidden/);
 assert.equal(m.cli,undefined);assert.equal(m.register,undefined);
});
test('missing trusted root capabilities fail closed',async()=>{
 const h=harness();
 delete h.adapter.consumeSignedOneTimeL4Approval;
 await assert.rejects(m.applyFixedInstallerUpgrade(h.adapter),/trusted_host_adapter_missing/);
 assert.deepEqual(h.calls,[]);
});
test('happy-path exact installer upgrade: lock, preimages, tests, journal, signed L4, install, postimage',async()=>{
 const h=harness(),out=await m.applyFixedInstallerUpgrade(h.adapter);
 assert.equal(out.ok,true);assert.equal(out.installer_upgraded,true);
 assert.equal(out.backend_deployed,false);assert.equal(out.yii_migrations_executed,false);
 assert.equal(h.state.installed,C.candidate_digest);assert.equal(h.state.consumes,1);
 assert.equal(h.state.releases,1);assert.equal(h.state.rollbacks,0);
 assert.equal(h.state.dbWrites,0);assert.equal(h.state.apacheWrites,0);
 assert.ok(h.calls.indexOf('journal')<h.calls.indexOf('approval'));
 assert.ok(h.calls.indexOf('approval')<h.calls.indexOf('install'));
 assert.ok(h.calls.indexOf('post')<h.calls.indexOf('commit'));
 assert.deepEqual(h.state.audits,['authorized','precommit_verified']);
});
test('wrong installed digest, owner and registry drift reject before approval and installation',async()=>{
 for(const p of [
 {installed_digest:'0'.repeat(64)},
 {root_ownership_verified:false},
 {no_symlinks:false},
 {registered_config_digest:'0'.repeat(64)},
 {http_sha256:'bad'}
 ]){
   const h=harness({mutatePre:p});
   await assert.rejects(m.applyFixedInstallerUpgrade(h.adapter),/denied_or_rolled_back/);
   assert.equal(h.state.consumes,0);
   assert.equal(h.calls.includes('install'),false);
   assert.equal(h.state.releases,1);
 }
});
test('source closure, AST, immutable bundle digest must be independently attested',async()=>{
 for(const p of [{bundle_digest:'0'.repeat(64)},{python_ast_syntax_ok:false},
 {source_closure_attested:false},{root_owned_read_only:false}]){
  const h=harness({mutateCandidate:p});
  await assert.rejects(m.applyFixedInstallerUpgrade(h.adapter),/denied_or_rolled_back/);
  assert.equal(h.state.consumes,0);assert.equal(h.calls.includes('install'),false);
 }
});
test('Linux tests must independently attest real success and negative rollback cases',async()=>{
 for(const p of [{trusted_linux_attestation:false},{tests_total:14,tests_passed:13},
 {interrupted_rollback_verified:false},{negative_tests_verified:false},
 {attestation_digest:'not-a-sha'},{production_mutated:true}]){
  const h=harness({mutateTests:p});
  await assert.rejects(m.applyFixedInstallerUpgrade(h.adapter),/denied_or_rolled_back/);
  assert.equal(h.state.consumes,0);assert.equal(h.calls.includes('journal'),false);
 }
});
test('unverified, replayed, expired and wrong-SHA approvals fail without installing',async()=>{
 for(const p of [
 {signature_verified:false},{consumed_once:false},
 {issuer_verified:false},{level:3},{age_seconds:181},
 {age_seconds:-1},{candidate_digest:'0'.repeat(64)},
 {existing_digest:'0'.repeat(64)},{backend_sha:'0'.repeat(40)},
 {action:'other_action'}
 ]){
  const h=harness({mutateReceipt:p});
  await assert.rejects(m.applyFixedInstallerUpgrade(h.adapter),/denied_or_rolled_back/);
  assert.equal(h.calls.includes('install'),false);
  assert.equal(h.state.installed,C.existing_digest);
  assert.ok(h.state.rollbacks===1);
 }
});
test('mutation and postinstall failures restore exact preimage after journal',async()=>{
 for(const f of ['install','post','commit','audit:precommit_verified']){
  const h=harness({fault:f});
  await assert.rejects(m.applyFixedInstallerUpgrade(h.adapter),/denied_or_rolled_back/,f);
  assert.equal(h.state.installed,C.existing_digest,f);
  assert.equal(h.state.rollbacks,1,f);assert.equal(h.state.releases,1,f);
  assert.ok(h.state.audits.includes('rollback_verified'),f);
 }
});
test('candidate runtime does not silently modify Apache, DB, Yii or the backend release',async()=>{
 for(const p of [
  {http_sha256:'e'.repeat(64)},
  {https_sha256:'e'.repeat(64)},
  {live_database_untouched:false},
  {yii_migrations_executed:true},
  {application_deployed:true},
  {registry_digest:'e'.repeat(64)},
  {other_registry_projects_valid:false},
  {journal_durable:false}
 ]){
  const h=harness({mutatePost:p});
  await assert.rejects(m.applyFixedInstallerUpgrade(h.adapter),/denied_or_rolled_back/);
  assert.equal(h.state.installed,C.existing_digest);assert.equal(h.state.rollbacks,1);
 }
});
test('rollback failure is hard-stopped and retains recovery lock',async()=>{
 for(const f of ['restore','verifyRollback']){
  const h=harness({fault:f});
  await assert.rejects(m.applyFixedInstallerUpgrade(h.adapter),/ROLLBACK_UNVERIFIED_manual_recovery_required/);
  assert.equal(h.state.releases,0);assert.equal(h.state.locked,true);
 }
});
test('preflight errors before journal require no rollback or approval',async()=>{
 for(const f of ['pre','candidate','linux','journal']){
  const h=harness({fault:f});
  await assert.rejects(m.applyFixedInstallerUpgrade(h.adapter),/denied_or_rolled_back/);
  assert.equal(h.state.consumes,0);assert.equal(h.state.rollbacks,0);
  assert.equal(h.state.releases,1);
 }
});
test('approval receiver cannot add unreviewed capabilities or token/paths',async()=>{
 const h=harness({mutateReceipt:{untrusted_cli:'echo bypass'}});
 await assert.rejects(m.applyFixedInstallerUpgrade(h.adapter),/denied_or_rolled_back/);
 assert.equal(h.calls.includes('install'),false);
});

test('commit response lost after durable COMMITTED marker never causes rollback',async()=>{
 for(const fault of ['commitAfterDurable','commitFalseAfterDurable']){
  const h=harness({fault});
  await assert.rejects(m.applyFixedInstallerUpgrade(h.adapter),
   /COMMIT_OUTCOME_UNCERTAIN_manual_reconciliation_required/,fault);
  assert.equal(h.state.journalState,'COMMITTED',fault);
  assert.equal(h.state.installed,C.candidate_digest,fault);
  assert.equal(h.state.rollbacks,0,fault);
  assert.equal(h.state.releases,0,fault);
  assert.equal(h.state.locked,true,fault);
  assert.ok(h.calls.includes('inspect-commit'),fault);
  assert.equal(h.calls.includes('restore'),false,fault);
 }
});
test('unknown durable state or failed inspection hard-stop with lock retained',async()=>{
 for(const fault of ['commitUnknown','commitInspectThrows']){
  const h=harness({fault});
  await assert.rejects(m.applyFixedInstallerUpgrade(h.adapter),
   /COMMIT_OUTCOME_UNCERTAIN_manual_reconciliation_required/,fault);
  assert.equal(h.state.rollbacks,0,fault);
  assert.equal(h.state.releases,0,fault);
  assert.equal(h.state.locked,true,fault);
  assert.equal(h.calls.includes('restore'),false,fault);
 }
});
test('an evidenced PREPARED commit failure may restore exact preimage',async()=>{
 const h=harness({fault:'commit'});
 await assert.rejects(m.applyFixedInstallerUpgrade(h.adapter),
   /denied_or_rolled_back/);
 assert.equal(h.state.installed,C.existing_digest);
 assert.equal(h.state.rollbacks,1);
 assert.equal(h.state.releases,1);
 assert.equal(h.state.locked,false);
 assert.ok(h.calls.indexOf('inspect-commit')<h.calls.indexOf('restore'));
});
test('root contract requires a durable journal inspector',async()=>{
 const h=harness();delete h.adapter.inspectDurableJournalState;
 await assert.rejects(m.applyFixedInstallerUpgrade(h.adapter),
   /trusted_host_adapter_missing/);
 assert.deepEqual(h.calls,[]);
});
