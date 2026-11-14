'use strict';
/**
 * Direct real-source no-lock regression tests. This is NOT a mock callback
 * suite: it invokes actual exported OIDC bridge, Native Root adapter, Native
 * lease, one-use Root owner fence and fixed sealed staging functions.
 * CI must run unprivileged, with no Root access and no Production side effects.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Shared=require('./honartik-u06-shared-exclusive-lock-v1.cjs');
const Bridge=require('./honartik-u06-root-owner-proof-bridge-v1.cjs');
const Staging=require('./honartik-u06-root-sealed-evidence-staging-v1.cjs');
const Lease=require('./honartik-u06-native-root-lease-v1.cjs');
const Native=require('./honartik-u06-real-root-callback-adapter-v1.cjs');
const Fence=require('./honartik-u06-owner-oidc-once-fence-v1.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const fixture=()=>{const root='/tmp/u06-owner-shared-test-'+crypto.randomBytes(6).toString('hex');
 fs.mkdirSync(root,{mode:0o700});
 return {root,gate:Shared.createUnprivilegedFixtureSharedGate(root),
 clean:()=>fs.rmSync(root,{recursive:true,force:true})}};
const fail=/u06_shared_lock_(untrusted_binding|live_root_gate_not_installed)/;

test('real owner challenge issuing function cannot run without shared lease',async()=>{
 await assert.rejects(()=>Bridge.prepareOwnerChallenge(),fail);
 await assert.rejects(()=>Bridge.prepareOwnerChallenge({assertHeld(){return true}}),fail);
});
test('real Root owner OIDC verifier rejects lock-less and counterfeit callers',async()=>{
 await assert.rejects(()=>Bridge.consumeStagedOwnerProof(),fail);
 await assert.rejects(()=>Bridge.consumeStagedOwnerProof({kind:'owner_evidence_consumption',assertHeld:()=>true}),fail);
});
test('real fixed Root encrypted-envelope staging refuses missing or forged lock',()=>{
 assert.throws(()=>Staging.stageSealedEvidence(null,'{}'),fail);
 assert.throws(()=>Staging.stageSealedEvidence({gate:{assertHeld(){return true}},lease:{kind:'owner_evidence_staging'}},'{}'),fail);
 assert.equal(Staging.PRODUCTION_AUTHORIZED,false);
});
test('real Root Native adapter and direct callback constructor fail before Root operations',async()=>{
 assert.throws(()=>Native.makeRootCallbacks({}),fail);
 await assert.rejects(()=>Native.runOnlyFromTrustedRootBridge({
  requestId:'x',sealedToken:'y',authoritativeConsumed:{valid:true,consumed:true},
  ownerProof:null,sharedBinding:null
 }),fail);
});
test('real Native live lease cannot be constructed without owned common gate',()=>{
 assert.throws(()=>Lease.createLiveRootLease(),fail);
});
test('real durable owner OIDC replay fence refuses Root-owned ledger without gate',()=>{
 assert.throws(()=>Fence.consumeVerifiedOwnerEvidence({},{
  trustedUid:0,sharedBinding:null
 }),fail);
});
test('genuine fixture lock ownership is kind-scoped and forged token is rejected',()=>{
 const f=fixture();
 try{
  const lease=f.gate.begin('owner_evidence_staging');
  const owner={gate:f.gate,lease};
  assert.equal(Shared.assertSourceBoundLease(owner,'owner_evidence_staging'),true);
  assert.throws(()=>Shared.assertSourceBoundLease(owner,'owner_challenge_issuance'),
   /u06_shared_lock_wrong_operation_kind/);
  assert.throws(()=>Shared.assertSourceBoundLease({gate:f.gate,lease:{...lease,token:'f'.repeat(64)}},'owner_evidence_staging'),
   /u06_shared_lock_wrong_lease_owner/);
  assert.throws(()=>Shared.assertSourceBoundLease({gate:{assertHeld:()=>true},lease},'owner_evidence_staging'),fail);
  f.gate.finish(lease,lease.kind,{terminalProof:true});
  assert.throws(()=>Shared.assertSourceBoundLease(owner,'owner_evidence_staging'),{code:'ENOENT'});
 } finally {f.clean()}
});
test('source-only guard explicitly blocks root and has no privilege issuers',()=>{
 const sharedSource=fs.readFileSync(path.join(__dirname,'honartik-u06-shared-exclusive-lock-v1.cjs'),'utf8');
 assert.match(sharedSource,/process\.getuid\(\)!==0/);
 assert.match(sharedSource,/live_root_gate_not_installed/);
 assert.equal(Shared.ROOT_ENTRYPOINT,false);
 assert.equal(Shared.PRODUCTION_AUTHORIZED,false);
 assert.equal(Shared.LEVEL4_ISSUER,false);
 assert.equal(Native.DIRECT_CLI_EXPORTED,false);
 assert.equal(Staging.ROOT_HANDLER_REGISTERED,false);
});
