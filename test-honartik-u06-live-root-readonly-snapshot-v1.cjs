'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const S=require('./honartik-u06-live-root-readonly-snapshot-v1.cjs');
const BASE=S.EXPECTED;
const observed='2026-11-15T12:28:38Z';
const NOW=Date.parse(observed)+30*1000;
function actualReadOnlyVector(){
 // Recreated from a read-only 2026-11-15 UTC Remote Desktop Commander
 // report on prhm-production.prhm.ir. Test is OFFLINE; it never connects.
 return {
  host:BASE.host,observed_at_utc:observed,
  sha256:{...BASE.owner_sha256,root_bridge:BASE.root_bridge_sha256},
  approval_fs:{
   private_dir_uid:65039,private_dir_mode:700,
   consumed_dir_uid:65039,consumed_dir_mode:700,
   issuer_uid:65039,issuer_mode:600,
   native_dir_uid:0,native_dir_mode:700,
   oidc_dir_uid:0,oidc_dir_mode:700
  },
  runtime:{
   root_service_active:true,
   native_policy_registered:true,native_typed_scope:true,
   reconcile_policy_registered:false,reconcile_typed_scope:false,
   root_source_contains_native:true,root_source_contains_reconcile:false,
   agent3_source_contains_native:true,agent3_source_contains_reconcile:false,
   sealed_evidence_present:false,recovery_journal_present:false,
   native_lease_present:false,native_journal_present:false
  },
  challenge:{
   present:true,issued_at_ms:1794650135085,
   expires_at_ms:1794650615085
  }
 };
}
const check=(s,nowMs=NOW)=>S.checkSnapshot(s,{nowMs});
test('read-only installed production preimage exactly matches all five observed SHA256 values but authorizes NOTHING',()=>{
 const snapshot=actualReadOnlyVector();
 const v=check(snapshot);
 assert.equal(v.exact_live_source_preimage_matched,true);
 assert.equal(v.old_challenge_expired,true);
 assert.equal(v.native_action_installed,true);
 assert.equal(v.recovery_action_installed,false);
 assert.equal(v.independent_security_review_verified,false);
 assert.equal(v.production_release_authorized,false);
 assert.equal(S.PRODUCTION_RELEASE_AUTHORIZED,false);
 assert.equal(S.PRIVILEGED_ENTRYPOINT,false);
 assert.equal(S.APPROVAL_ISSUER,false);
});
test('each of four canonical owner source SHA drift and Root bridge SHA drift fail closed',()=>{
 for(const name of Object.keys(actualReadOnlyVector().sha256)){
  const s=actualReadOnlyVector();s.sha256[name]='a'.repeat(64);
  assert.throws(()=>check(s),/source_sha_drift_|installed_bridge_sha_drift/,name);
 }
});
test('unspecified files, unexpected source owner and unsupported host denied',()=>{
 const s=actualReadOnlyVector();s.sha256.extra='a'.repeat(64);
 assert.throws(()=>check(s),/sha_shape/);
 const wrong=actualReadOnlyVector();wrong.host='other-host';
 assert.throws(()=>check(wrong),/host_mismatch/);
 const parent=actualReadOnlyVector();parent.hiddenRootKey='not-allowed';
 assert.throws(()=>check(parent),/shape_drift/);
});
test('Root-owned and systemd private approval UID/mode drift denied',()=>{
 const variants=[
  ['private_dir_uid',0],['private_dir_mode',755],
  ['consumed_dir_uid',0],['consumed_dir_mode',755],
  ['issuer_uid',0],['issuer_mode',644],
  ['native_dir_uid',65039],['native_dir_mode',755],
  ['oidc_dir_uid',65039],['oidc_dir_mode',755]
 ];
 for(const [key,value] of variants){
  const s=actualReadOnlyVector();s.approval_fs[key]=value;
  assert.throws(()=>check(s),/approval_filesystem_trust_drift/,key);
 }
});
test('any unexpected recovery registration or unguarded path changed from preimage requires new independent review',()=>{
 for(const key of [
  'reconcile_policy_registered','reconcile_typed_scope',
  'root_source_contains_reconcile','agent3_source_contains_reconcile'
 ]){
  const s=actualReadOnlyVector();s.runtime[key]=true;
  assert.throws(()=>check(s),/reconciliation_registration_changed/,key);
 }
 for(const key of [
  'native_policy_registered','native_typed_scope',
  'root_source_contains_native','agent3_source_contains_native','root_service_active'
 ]){
  const s=actualReadOnlyVector();s.runtime[key]=false;
  assert.throws(()=>check(s),/native_approval_baseline_drift/,key);
 }
});
test('any active, partially prepared or recovery file denies preflight',()=>{
 for(const key of [
  'sealed_evidence_present','recovery_journal_present',
  'native_lease_present','native_journal_present'
 ]){
  const s=actualReadOnlyVector();s.runtime[key]=true;
  assert.throws(()=>check(s),/unexpected_active_or_recovery_state/,key);
 }
});
test('old challenge not expired, absent or malformed denies preflight',()=>{
 const missing=actualReadOnlyVector();missing.challenge.present=false;
 assert.throws(()=>check(missing),/challenge_missing_or_not_expired/);
 const fresh=actualReadOnlyVector();fresh.challenge.expires_at_ms=NOW+5000;
 assert.throws(()=>check(fresh),/challenge_missing_or_not_expired/);
 const malformed=actualReadOnlyVector();malformed.challenge.expires_at_ms='2026-11-14';
 assert.throws(()=>check(malformed),/challenge_missing_or_not_expired/);
});
test('stale/future live observation denied; source vector cannot authorize release tomorrow',()=>{
 assert.throws(()=>check(actualReadOnlyVector(),NOW+16*60*1000),/stale_snapshot/);
 assert.throws(()=>check(actualReadOnlyVector(),NOW-90*1000),/stale_snapshot/);
 const s=actualReadOnlyVector();s.observed_at_utc='invalid';
 assert.throws(()=>check(s),/clock_invalid/);
});
test('source checker does not read actual Root, mutate Production or expose CLI/installer',()=>{
 const file=path.join(__dirname,'honartik-u06-live-root-readonly-snapshot-v1.cjs');
 const c=spawnSync(process.execPath,[file],{encoding:'utf8'});
 assert.equal(c.status,64);assert.match(c.stderr,/no root release/);
 assert.equal(c.stdout,'');
 assert.equal(S.liveRootApply,undefined);
 assert.equal(S.issueApproval,undefined);
 assert.equal(S.registerHostAction,undefined);
});
