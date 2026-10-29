'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const api=require('./universal-installer-backup-only-native-contract-v1.cjs');
const F=api.FIXED;
const hash='a'.repeat(64);
const before=()=>({
 installed_bundle:F.installed_bundle,manifest_digest:F.installed_bundle,
 backup_sha256:F.installed_backup_sha256,
 current_pointer_verified:true,root_ownership_verified:true,
 registered_profiles_valid:true,manifest_preimage_sha256:hash});
const candidate=()=>({
 bundle_digest:F.candidate_bundle,archive_sha256:F.archive_sha256,
 backup_sha256:F.candidate_backup_sha256,source_count:28,
 changed_files:['universal/backup.py'],
 changed_functions:['tree_fingerprint','create_backup','verify_restore'],
 root_owned_immutable_staging:true,linux_restore_proven:true});
const approval=()=>({
 action:F.action,installed_bundle:F.installed_bundle,
 candidate_bundle:F.candidate_bundle,approval_id:'approved-unique-test',
 level:4,risk:'critical',signature_verified_by_native_root:true,
 consumed_ledger_verified_by_native_root:true,
 one_use_replay_fence_written:true,
 request_id_bound_to_original:true,age_seconds:1});
const after=()=>({
 installed_bundle:F.candidate_bundle,manifest_digest:F.candidate_bundle,
 previous_digest:F.installed_bundle,registered_profiles_valid:true,
 backup_sha256:F.candidate_backup_sha256,other_project_runtime_unchanged:true,
 database_unchanged:true,application_release_unchanged:true,
 journal_durable:true});
function fake(){
 let state='PREPARED',rollback=0,installs=0;
 const native={
 async exclusiveLock(){return true},
 async readExactInstalledPreimage(){return before()},
 async attestTrustedStagedSource(){return candidate()},
 async attestSignedLinuxRestore(){return true},
 async prepareDurableRollbackJournal(){return {id:'test-journal-id'}},
 async inspectDurableJournal(){return state},
 async consumeNativeSignedLevel4(){return approval()},
 async durableAudit(){},
 async installThroughExistingUniversal(){installs++;return true},
 async readExactPostimage(){return after()},
 async commitDurableJournal(){state='COMMITTED';return true},
 async restoreExactPreimage(){rollback++;state='ROLLED_BACK';return true},
 async verifyExactRollback(){return true},
 };
 return {native,get state(){return state},get rollback(){return rollback},
  get installs(){return installs}};
}
test('fixed SHA and scope admitted',()=>{assert.equal(api.attestBefore(before()).installed_bundle,F.installed_bundle);
 assert.equal(api.attestSource(candidate()).bundle_digest,F.candidate_bundle);
 assert.equal(api.attestReceipt(approval()).level,4);
 assert.equal(api.attestAfter(after(),hash).installed_bundle,F.candidate_bundle)});
test('old broader candidate rejected',()=>{const c=candidate();c.bundle_digest='28f163ecca4d985064c2eb4794be6ab62d8151b065d2fb25a7fa6fbb9aab8316';
 assert.throws(()=>api.attestSource(c),/not_admitted/)});
test('backend first-managed candidate rejected',()=>{const c=candidate();c.bundle_digest='8680011e11ad8eae89707b74492e60354c4b7e56799b205d3da581e92806a552';
 assert.throws(()=>api.attestSource(c),/not_admitted/)});
test('extra changed code rejected',()=>{const c=candidate();c.changed_files.push('universal/engine.py');
 assert.throws(()=>api.attestSource(c),/not_admitted/)});
test('wrong installed preimage rejected',()=>{const p=before();p.installed_bundle=hash;
 assert.throws(()=>api.attestBefore(p),/preimage_drift/)});
test('untrusted L4 denied',()=>{const p=approval();p.signature_verified_by_native_root=false;
 assert.throws(()=>api.attestReceipt(p),/receipt_missing/)});
test('expired L4 denied',()=>{const p=approval();p.age_seconds=181;
 assert.throws(()=>api.attestReceipt(p),/receipt_missing/)});
test('runtime args cannot replace trusted adapter',async()=>{
 await assert.rejects(api.executeTrustedFixedAction({}),/adapter_missing/)});
test('native fixture normal succeeds',async()=>{const f=fake();const r=await api.executeTrustedFixedAction(f.native);
 assert.equal(r.installer_upgraded,true);assert.equal(f.installs,1);assert.equal(f.rollback,0)});
test('native fixture source mismatch never installs',async()=>{const f=fake();
 f.native.attestTrustedStagedSource=async()=>({...candidate(),source_count:30});
 await assert.rejects(api.executeTrustedFixedAction(f.native),/not_admitted/);
 assert.equal(f.installs,0);assert.equal(f.rollback,0)});
test('native fixture invalid approval rolls back prepared journal',async()=>{const f=fake();
 f.native.consumeNativeSignedLevel4=async()=>({...approval(),age_seconds:181});
 await assert.rejects(api.executeTrustedFixedAction(f.native),/rollback_verified/);
 assert.equal(f.installs,0);assert.equal(f.rollback,1)});
test('native fixture postimage mismatch rolls back',async()=>{const f=fake();
 f.native.readExactPostimage=async()=>({...after(),backup_sha256:hash});
 await assert.rejects(api.executeTrustedFixedAction(f.native),/rollback_verified/);
 assert.equal(f.installs,1);assert.equal(f.rollback,1)});
test('commit ACK uncertain but committed MUST NOT roll back',async()=>{const f=fake();
 f.native.commitDurableJournal=async()=>{throw Error('lost ACK after durable commit')};
 f.native.inspectDurableJournal=async()=> 'COMMITTED';
 await assert.rejects(api.executeTrustedFixedAction(f.native),/committed_outcome_preserve_lock/);
 assert.equal(f.rollback,0)});
test('journal creation lost ACK retains lock',async()=>{const f=fake();
 f.native.prepareDurableRollbackJournal=async()=>{throw Error('lost ACK')};
 await assert.rejects(api.executeTrustedFixedAction(f.native),/journal_creation_uncertain/);
 assert.equal(f.rollback,0)});
