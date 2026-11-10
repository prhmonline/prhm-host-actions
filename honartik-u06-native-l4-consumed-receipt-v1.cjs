'use strict';
/**
 * U06-specific Ed25519 Level-4 Host Actions v2 consumed approval verifier.
 *
 * This is a cryptographic verifier, NOT a token issuer, Root installer or
 * callable production executor. Live trust is intentionally NOT pinned:
 * the exact reviewed U06 Level-4 policy postimage does not yet exist.
 * Therefore no live approval can be accepted by this code.
 *
 * Future Root-only host integration must independently read the trusted
 * Approval Center Ed25519 key + policy + consumed ledger, verify file ancestry,
 * source SHA and exact reviewed policy hash, and persist the one-use fence.
 * A GitHub OIDC identity proof alone is NOT an L4 approval.
 */
const crypto=require('node:crypto');
const {decodeJws}=require('./honartik-universal-installer-l4-approval-verify-v1.cjs');
const ACTION='honartik_u06_native_backup_register_v1';
const OPERATION='host_action.'+ACTION;
const TRUSTED_LIVE_POLICY_POSTIMAGE_SHA256=null; // no installed U06 L4 operation today
const HASH=x=>crypto.createHash('sha256').update(x).digest('hex');
const HEX=/^[a-f0-9]{64}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=m=>{throw Error('prhm_u06_l4_'+m)};
const need=(v,m)=>{if(!v)fail(m)};
const jsonEq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const argDigest=()=>HASH(Buffer.from(JSON.stringify({action:ACTION})));
const EXPECTED=Object.freeze({
 rollback:'host-action-v2:honartik-u06-native-backup:durable-verified-root-rollback',
 level:4,risk:'critical',
 principal:'mohammad',role:'mcp-operator',
 project:'control_plane',environment:'production',
 tool:'host_action_v2_apply',
 max_age_seconds:180
});
function verifyPolicyAndOperation(bytes,pinnedSha){
 need(Buffer.isBuffer(bytes)&&bytes.length>=100&&bytes.length<=200000&&
  HEX.test(pinnedSha||'')&&HASH(bytes)===pinnedSha,'exact_reviewed_policy_sha_missing');
 let p;try{p=JSON.parse(bytes.toString('utf8'))}catch{fail('policy_json_invalid')}
 need(p&&p.schema_version==='prhm.approval-policy.v1'&&
  p.default_deny===true&&p.one_time_use===true&&p.scope_freeze===true&&
  p.issuer==='prhm-company-approval'&&p.levels?.['4']?.human_approval===true&&
  p.levels?.['4']?.second_confirmation_required===true&&
  p.levels?.['4']?.max_ttl_seconds===180&&
  typeof p.version==='string'&&p.version.length>=8,'policy_root_invariants_missing');
 const op=p.operations?.[OPERATION];
 need(op&&op.level===4&&op.risk===EXPECTED.risk&&
  op.requires_second_confirmation===true&&op.one_time_use===true&&
  op.expires_seconds===180&&op.policy_version===p.version&&
  op.requested_approver===EXPECTED.principal&&
  op.rollback_reference===EXPECTED.rollback,
  'u06_l4_operation_unregistered_or_downgraded');
 const matches=(p.typed_scopes||[]).filter(x=>
  x.action===ACTION||x.operation===OPERATION);
 need(matches.length===1,'u06_typed_scope_count');
 const s=matches[0];
 need(s.action===ACTION&&s.operation===OPERATION&&
  s.tool===EXPECTED.tool&&s.project===EXPECTED.project&&
  s.environment===EXPECTED.environment&&s.risk===EXPECTED.risk&&
  jsonEq(s.principals,[{principal_id:EXPECTED.principal,roles:[EXPECTED.role]}]),
  'u06_typed_scope_drift');
 return Object.freeze({version:p.version,sha256:pinnedSha,
  action:ACTION,operation:OPERATION,level:4});
}
function verifySignedConsumedL4({
 token,issuerPublicKey,consumedLedger,policyBytes,
 reviewedPolicySha256,nowSec
}={}){
 need(Number.isSafeInteger(nowSec)&&nowSec>0,'clock_invalid');
 const policy=verifyPolicyAndOperation(policyBytes,reviewedPolicySha256);
 const c=decodeJws(token,issuerPublicKey);
 const requestHash=argDigest();
 need(UUID.test(c.approval_id||'')&&UUID.test(c.request_id||'')&&
  c.jti===c.approval_id&&c.iss==='prhm-company-approval'&&
  c.action===ACTION&&c.operation===OPERATION&&
  c.project===EXPECTED.project&&c.environment===EXPECTED.environment&&
  c.tool===EXPECTED.tool&&c.principal_id===EXPECTED.principal&&
  c.role===EXPECTED.role&&c.level===4&&c.risk==='critical'&&
  c.decision==='accept'&&c.one_time_use===true&&
  c.policy_version===policy.version&&c.policy_hash===policy.sha256&&
  c.arguments_sha256===requestHash&&c.request_hash===requestHash&&
  Number.isSafeInteger(c.iat)&&Number.isSafeInteger(c.nbf)&&
  Number.isSafeInteger(c.exp)&&c.iat<=nowSec&&c.nbf<=nowSec&&
  c.exp>nowSec&&c.exp>c.iat&&c.exp-c.iat<=180&&
  nowSec-c.iat<=180,'signed_scope_or_freshness_mismatch');
 const keys=['schema_version','approval_id','request_id','work_order_id',
  'project_id','operation','request_hash','consumed_at','consumer','consumption_hash'];
 need(consumedLedger&&typeof consumedLedger==='object'&&
  !Array.isArray(consumedLedger)&&
  Object.keys(consumedLedger).sort().join('|')===keys.sort().join('|'),
  'consumed_ledger_shape');
 const l=consumedLedger,consumptionHash=HASH(Buffer.from(JSON.stringify({
  ...l,consumption_hash:null
 })));
 need(l.schema_version==='prhm.approval-consumption.v1'&&
  l.approval_id===c.approval_id&&l.request_id===c.request_id&&
  l.project_id===EXPECTED.project&&l.operation===OPERATION&&
  l.request_hash===requestHash&&
  l.consumer==='prhm-agent-selfmaint-exec-host-actions-v2'&&
  typeof l.consumed_at==='string'&&Number.isFinite(Date.parse(l.consumed_at))&&
  Date.parse(l.consumed_at)/1000<=nowSec&&
  l.consumption_hash===consumptionHash,
  'signed_receipt_not_authoritatively_consumed');
 return Object.freeze({
  schema:'prhm.u06.host-action.signed-l4-consumed-review.v1',
  action:ACTION,operation:OPERATION,
  approval_id:c.approval_id,request_id:c.request_id,
  reviewed_policy_sha256:policy.sha256,arguments_sha256:requestHash,
  signature_verified:true,consumed_ledger_verified:true,
  level4_scope_exact:true,receipt_fresh:true,
  root_owned_sources_attested:false,
  native_root_binding_installed:false,
  replay_fence_reserved:false,
  production_backup_authorized:false
 });
}
function verifyLiveRootU06(){
 // No U06 operation exists in installed policy or root dispatcher. Never
 // promote a synthetic/pure verifier result into privileged authorization.
 need(HEX.test(TRUSTED_LIVE_POLICY_POSTIMAGE_SHA256||''),
  'reviewed_live_policy_not_installed');
 fail('native_root_bound_entrypoint_not_installed');
}
module.exports=Object.freeze({
 ACTION,OPERATION,EXPECTED,TRUSTED_LIVE_POLICY_POSTIMAGE_SHA256,
 argDigest,verifyPolicyAndOperation,verifySignedConsumedL4,
 verifyLiveRootU06,ROOT_INSTALL_ALLOWED:false,PRODUCTION_MUTATION_ALLOWED:false
});
