'use strict';
/**
 * U06 expired owner OIDC recovery: exact-scope ED25519 Level-4 + consumed
 * ledger CRYPTOGRAPHIC REVIEW, independent of the Native U06 approval.
 *
 * Pure verification only. The Production Root adapter, after exact SHA
 * attestation, must acquire the common exclusive lock and INDEPENDENTLY read
 * the immutable root-owned policy, issuer key and consumed ledger. Values
 * passed into this pure function do not themselves establish provenance.
 *
 * No policy editor, no Root handler, no credential, no approval issuer,
 * no exported live key-retirement operation, and no replay-fence writer.
 */
const crypto=require('node:crypto');
const {decodeJws}=require('./honartik-universal-installer-l4-approval-verify-v1.cjs');
const REVIEW=require('./honartik-u06-expired-owner-reconcile-registration-review-v1.cjs');
const ACTION='honartik_u06_expired_owner_oidc_reconcile_v1';
const OPERATION='host_action.'+ACTION;
const NATIVE_OPERATION='host_action.honartik_u06_native_backup_register_v1';
const ROLLBACK='host-action-v2:honartik-u06-expired-oidc-reconcile:durable-tombstone';
const HASH=b=>crypto.createHash('sha256').update(b).digest('hex');
const HEX=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=x=>{throw Error('u06_expired_reconcile_l4_'+x)};
const need=(v,x)=>{if(!v)fail(x)};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join('|')===keys.slice().sort().join('|');
const argDigest=()=>HASH(Buffer.from(JSON.stringify({action:ACTION})));
function verifyFixedPolicy(bytes,reviewedSha256){
 need(Buffer.isBuffer(bytes)&&bytes.length>100&&bytes.length<200000&&
   HEX.test(reviewedSha256||'')&&HASH(bytes)===reviewedSha256,'pinned_policy_sha_missing');
 let p;try{p=JSON.parse(bytes.toString('utf8'))}catch{fail('policy_json_invalid')}
 need(p&&p.schema_version==='prhm.approval-policy.v1'&&
   p.issuer==='prhm-company-approval'&&
   p.default_deny===true&&p.one_time_use===true&&
   p.scope_freeze===true&&p.levels?.['4']?.human_approval===true&&
   p.levels?.['4']?.second_confirmation_required===true&&
   p.levels?.['4']?.max_ttl_seconds===180&&
   typeof p.version==='string'&&p.version.length>=8,
   'critical_policy_guard_drift');
 const op=p.operations?.[OPERATION];
 need(op&&op.level===4&&op.risk==='critical'&&
   op.requires_second_confirmation===true&&op.one_time_use===true&&
   op.expires_seconds===180&&op.policy_version===p.version&&
   op.requested_approver==='mohammad'&&op.rollback_reference===ROLLBACK,
   'reconciliation_operation_not_registered_or_downgraded');
 const matches=(p.typed_scopes||[]).filter(s=>
   s.action===ACTION||s.operation===OPERATION);
 need(matches.length===1,'scope_cardinality');
 const s=matches[0];
 need(s.action===ACTION&&s.operation===OPERATION&&
   s.tool==='host_action_v2_apply'&&s.project==='control_plane'&&
   s.environment==='production'&&s.risk==='critical'&&
   JSON.stringify(s.principals)===
    JSON.stringify([{principal_id:'mohammad',roles:['mcp-operator']}]),
   'typed_reconciliation_scope_drift');
 need(p.operations?.[NATIVE_OPERATION]&&
   (p.typed_scopes||[]).some(t=>t.operation===NATIVE_OPERATION&&
     t.action==='honartik_u06_native_backup_register_v1'),
   'native_scope_unexpectedly_missing');
 // The Approval Center signs a compact JSON policy hash. The Root release
 // separately pins the pretty-printed on-disk bytes SHA256.
 return Object.freeze({version:p.version,
   source_sha256:reviewedSha256,
   signed_policy_hash:HASH(Buffer.from(JSON.stringify(p))),
   operation:OPERATION,action:ACTION,level:4});
}
function verifySignedConsumedReconciliation({
 token,issuerPublicKey,consumedLedger,policyBytes,
 reviewedPolicySha256,nowSec
}={}){
 need(Number.isSafeInteger(nowSec)&&nowSec>0,'clock_invalid');
 const policy=verifyFixedPolicy(policyBytes,reviewedPolicySha256);
 const c=decodeJws(token,issuerPublicKey);
 const args=argDigest();
 need(UUID.test(c.approval_id||'')&&UUID.test(c.request_id||'')&&
   c.jti===c.approval_id&&c.iss==='prhm-company-approval'&&
   c.action===ACTION&&c.operation===OPERATION&&
   c.project==='control_plane'&&c.environment==='production'&&
   c.tool==='host_action_v2_apply'&&
   c.principal_id==='mohammad'&&c.role==='mcp-operator'&&
   c.level===4&&c.risk==='critical'&&c.decision==='accept'&&
   c.one_time_use===true&&c.policy_version===policy.version&&
   c.policy_hash===policy.signed_policy_hash&&
   c.arguments_sha256===args&&c.request_hash===args&&
   Number.isSafeInteger(c.iat)&&Number.isSafeInteger(c.nbf)&&
   Number.isSafeInteger(c.exp)&&c.iat<=nowSec&&c.nbf<=nowSec&&
   c.exp>nowSec&&c.exp>c.iat&&c.exp-c.iat<=180&&
   nowSec-c.iat<=180,'signed_scope_policy_or_expiry_drift');
 const fields=['schema_version','approval_id','request_id','work_order_id',
   'project_id','operation','request_hash','consumed_at','consumer','consumption_hash'];
 need(exact(consumedLedger,fields),'consumed_ledger_shape');
 const l=consumedLedger;
 const h=HASH(Buffer.from(JSON.stringify({...l,consumption_hash:null})));
 need(l.schema_version==='prhm.approval-consumption.v1'&&
   l.approval_id===c.approval_id&&l.request_id===c.request_id&&
   l.project_id==='control_plane'&&l.operation===OPERATION&&
   l.request_hash===args&&
   l.consumer==='prhm-agent-selfmaint-exec-host-actions-v2'&&
   typeof l.consumed_at==='string'&&
   Number.isFinite(Date.parse(l.consumed_at))&&
   Date.parse(l.consumed_at)/1000<=nowSec&&
   Date.parse(l.consumed_at)/1000>=c.iat&&
   l.consumption_hash===h,'authoritative_consumption_mismatch');
 return Object.freeze({
  schema:'prhm.u06.expired-owner-oidc.signed-reconcile-review.v1',
  operation:OPERATION,action:ACTION,
  approval_id:c.approval_id,request_id:c.request_id,
  policy_sha256:policy.source_sha256,
  signature_verified:true,consumed_ledger_verified:true,
  exact_critical_scope:true,one_use_claim_verified:true,
  independent_root_ledger_attested:false,
  root_lock_acquired:false,root_action_registered:false,
  challenge_retired:false,owner_oidc_verified:false,
  native_backup_authorized:false,production_mutation_authorized:false
 });
}
module.exports=Object.freeze({
 ACTION,OPERATION,NATIVE_OPERATION,ROLLBACK,argDigest,
 verifyFixedPolicy,verifySignedConsumedReconciliation,
 ROOT_REGISTRATION:false,ROOT_APPLY:false,LEVEL4_ISSUER:false,
 LIVE_PINNED_POLICY_SHA256:null
});
if(require.main===module){
 process.stderr.write('U06 Root reconciliation L4 source verifier only; no apply or approval issuer.\n');
 process.exitCode=64;
}
