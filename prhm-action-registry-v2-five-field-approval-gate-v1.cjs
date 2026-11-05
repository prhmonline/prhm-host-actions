'use strict';
/**
 * Fixed Honartik V2 FIVE-FIELD Approval Center route contract.
 * SOURCE ONLY. No HTTP listener, signer, network, secret, CLI, policy edit,
 * request issuance, decision, ledger consumption or Production side effect.
 * Existing one-field Host Actions v2 endpoint MUST NOT be reused.
 *
 * The root-owned base/Approval Center transport must use these envelopes
 * at the three separately reviewed request/confirm/consume boundaries.
 */
const g=require('./prhm-action-registry-gateway-v1.cjs');
const bridge=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const pinned=require('./manifests/honartik-shared-registry-pinned-release-v2.json');
const RELEASE_PATH='manifests/honartik-config-center-registry-release-v2.json';
const CONFIRM='CONFIRM_LEVEL_4_CRITICAL';
const CONSUMER='prhm-agent-selfmaint-exec-host-actions-v2';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS=Object.freeze(['action','project','source_commit','manifest_commit','manifest_sha256']);
const REQUEST=Object.freeze({
 action:g.ACTION,project:'honartik',
 source_commit:'aa267202d11784f0ac0a957e0d8ba911a6b07734',
 manifest_commit:'d1a8b26da238d1a86b7a5d96f69185e7d25f1430',
 manifest_sha256:'9ff881e0d470da91aa26923b950589645613244d4b34d30b9e240d5277128f3b'
});
const ARGUMENTS_SHA='d1f29c8f517ca787f88f61d218a5dde03ecee2be096a7aefd91c6c2865d394c3';
function reject(reason){throw Error('registry_v2_five_field_'+reason)}
function assert(ok,reason){if(!ok)reject(reason)}
function exact(obj,keys,reason){
 assert(obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join('|')===keys.slice().sort().join('|'),reason);
}
function assertPinned(input){
 exact(input,KEYS,'request_schema');
 for(const k of KEYS)assert(input[k]===REQUEST[k],'release_pin_mismatch_'+k);
 assert(pinned.source_commit===REQUEST.source_commit&&
  pinned.manifest_commit===REQUEST.manifest_commit&&
  pinned.release_manifest_sha256===REQUEST.manifest_sha256&&
  pinned.release_manifest_path===RELEASE_PATH&&
  pinned.approval_arguments_sha256===ARGUMENTS_SHA,
  'compiled_release_pin_drift');
 bridge.assertHonartikReleaseIdentity(input,RELEASE_PATH);
 assert(g.approvalBindingSha(input)===ARGUMENTS_SHA,'canonical_hash_drift');
 return Object.freeze({...REQUEST});
}
function requestEnvelope(input){
 assertPinned(input);
 const body=bridge.typedApprovalRequest(input);
 assert(body.arguments_sha256===ARGUMENTS_SHA&&
  body.action===g.ACTION&&body.operation===g.OPERATION&&
  body.risk==='critical'&&body.ttl_seconds===180&&
  body.tool==='host_action_v2_apply','request_envelope_invalid');
 return body;
}
function checkRequestRecord(record,requestId){
 assert(UUID.test(requestId||''),'request_id_invalid');
 assert(record&&typeof record==='object'&&!Array.isArray(record),
  'trusted_request_missing');
 assert(record.request_id===requestId&&record.action===g.ACTION&&
  record.arguments_sha256===ARGUMENTS_SHA&&
  Number(record.level)===4&&
  record.project==='control_plane'&&
  record.operation===g.OPERATION&&
  record.environment==='production','trusted_request_binding_mismatch');
 // A verified Approval Center lookup must supply the actual request state.
 assert(record.status==='pending'&&typeof record.expires_at==='string'&&
  Number.isFinite(Date.parse(record.expires_at))&&
  Date.parse(record.expires_at)>Date.now(),'request_consumed_or_expired');
 return true;
}
function confirmEnvelope(input,record){
 exact(input,[...KEYS,'request_id','second_confirmation'],'confirmation_schema');
 assertPinned(Object.fromEntries(KEYS.map(k=>[k,input[k]])));
 assert(input.second_confirmation===CONFIRM,'explicit_second_confirmation_required');
 checkRequestRecord(record,input.request_id);
 return Object.freeze({
  request_id:input.request_id,
  action:g.ACTION,
  arguments_sha256:ARGUMENTS_SHA,
  decision:Object.freeze({
   decision:'accept',second_confirmation:CONFIRM,
   rollback_reference:'host-action-v2:prhm-action-registry-install-v1:verified-four-owner-restore',
   note:'Fixed SHA-bound PRHM registry V2 request'
  })
 });
}
function authorizeConsumeEnvelope(input){
 exact(input,[...KEYS,'approval_token'],'consume_schema');
 assertPinned(Object.fromEntries(KEYS.map(k=>[k,input[k]])));
 const token=input.approval_token;
 assert(typeof token==='string'&&token.length>=120&&token.length<=16384&&
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token),
  'signed_token_envelope_required');
 const base=Object.freeze({
  approval_token:token,principal_id:'mohammad',role:'mcp-operator',
  tool:'host_action_v2_apply',project:'control_plane',
  environment:'production',action:g.ACTION,risk:'critical',
  operation:g.OPERATION,arguments_sha256:ARGUMENTS_SHA
 });
 return Object.freeze({
  validation:base,
  consumption:Object.freeze({...base,consumer:CONSUMER}),
  args:Object.freeze({...REQUEST}),
  arguments_sha256:ARGUMENTS_SHA
 });
}
function verifyConsumedCryptographically({token,publicKey,ledger,nowSec}={}){
 const v=g.verifyConsumedRegistrationApproval({
  token,publicKey,ledger,args:REQUEST,nowSec
 });
 assert(v.action===g.ACTION&&v.level===4&&v.arguments_sha256===ARGUMENTS_SHA,
  'consumption_crypto_binding_invalid');
 // The real trusted root executor must separately establish the one-time
 // fence before any installer call, independently of this read-only verifier.
 return v;
}
module.exports=Object.freeze({
 REQUEST,ARGUMENTS_SHA,RELEASE_PATH,KEYS,CONSUMER,CONFIRM,
 assertPinned,requestEnvelope,checkRequestRecord,
 confirmEnvelope,authorizeConsumeEnvelope,verifyConsumedCryptographically
});
