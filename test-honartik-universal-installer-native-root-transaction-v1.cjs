'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const T=require('./honartik-universal-installer-native-root-transaction-v1.cjs');
const Gate=require('./honartik-universal-installer-native-approval-gate-v1.cjs');
const Receipt=require('./honartik-universal-installer-native-root-receipt-v1.cjs');
const Pack=require('./honartik-universal-installer-registration-review-pack-v1.cjs');
const UUID='11111111-2222-4333-8444-555555555555';
test('transaction wiring gates are source-only, never self-authorized',()=>{
 assert.equal(T.ROOT_ACTION_REGISTERED,false);
 assert.equal(T.TRUSTED_SEALED_LOADER_INSTALLED,false);
 assert.equal(T.INDEPENDENT_SECURITY_APPROVAL_COMPLETE,false);
 assert.equal(T.SIGNED_LINUX_E2E_ATTESTED,false);
 assert.equal(T.PRODUCTION_EXECUTION_AUTHORIZED,false);
 for(const name of ['issueApproval','consumeApproval','register','applyProduction',
  'installFromUrl','executeShell','releaseLease','purgeJournal'])
  assert.equal(T[name],undefined,name);
});
test('both native cryptographic proof readers match the operator live-derived policy',()=>{
 assert.equal(Gate.PINNED_POLICY_SHA,
  '981967b4ce770cd3aa89d27ae98552bbeb3ab31ed116d4e51aef91c0abf68358');
 assert.equal(Receipt.POLICY_SHA,Gate.PINNED_POLICY_SHA);
 assert.equal(Pack.RECONCILED_CANDIDATE_POLICY_SHA,Gate.PINNED_POLICY_SHA);
});
test('ambiguous, terminal and prepared journal states have a deterministic rollback gate',()=>{
 for(const [state,expected] of [
 ['PREPARED','ROLLBACK_EXACT_PREIMAGE'],
 ['COMMITTED','RETAIN_COMMIT_AND_LEASE'],
 ['ROLLED_BACK','RETAIN_ROLLBACK_AND_LEASE'],
 [null,'REQUIRE_MANUAL_ROOT_RECOVERY'],
 [undefined,'REQUIRE_MANUAL_ROOT_RECOVERY'],
 ['UNKNOWN','REQUIRE_MANUAL_ROOT_RECOVERY'],
 ['CANCELLED','REQUIRE_MANUAL_ROOT_RECOVERY']
 ])assert.equal(T.recoveryDecision(state),expected);
});
test('nonroot cannot invoke a root transaction or supply a mocked approval',()=>{
 if(process.getuid?.()===0)return;
 for(const [id,loader] of [[UUID,()=>({signed:true})],[UUID,null],
 ['bogus',()=>({signed:true})]])assert.throws(
  ()=>T.runFixedRootSignedInstaller(id,loader),
  /honartik217_fixed_root_transaction_trusted_root_required/
 );
});
test('source-only runtime export does not register a CLI or start Python on import',()=>{
 const keys=Object.keys(T);
 assert.deepEqual(keys.sort(),[
 'recoveryDecision','runFixedRootSignedInstaller','ROOT_ACTION_REGISTERED',
 'TRUSTED_SEALED_LOADER_INSTALLED','INDEPENDENT_SECURITY_APPROVAL_COMPLETE',
 'SIGNED_LINUX_E2E_ATTESTED','PRODUCTION_EXECUTION_AUTHORIZED'
 ].sort());
});
