'use strict';
/**
 * Dedicated Root Bootstrap V2 Approval Center Ed25519+consumed-ledger
 * verifier. This is an executable *cryptographic verification function*, not
 * an Approval Center consumer or a privileged Production installer.
 *
 * It intentionally accepts no generic project/action/manifest/consumer.
 * Enrollment's approval cannot be used as a root-stage authorization.
 * A future independently reviewed Root-of-Trust installation adapter must:
 *  - PIN the live approved policy bytes and this verifier by immutable SHA;
 *  - invoke Approval Center's real one-time consume API (this only READS proof);
 *  - create a separate durable O_EXCL execution claim before any mutation;
 *  - invoke a 36-file WAL/root installer under a signed root-only service.
 *
 * No production code path is exported: productionProof() FAILS CLOSED until
 * an independently reviewed bootstrap-specific installed-policy hash exists.
 */
const crypto=require('node:crypto');
const admission=require('./prhm-registry-v2-bootstrap-authorization-boundary-v1.cjs');
const {canonicalJson}=require('./prhm-action-registry-gateway-v1.cjs');
const OPERATION='host_action.'+admission.ACTION;
const TOOL='prhm_root_bootstrap_apply_v2';
const CONSUMER='prhm-agent-selfmaint-exec-root-bootstrap-v2';
const ISSUER='prhm-company-approval';
const POLICY_VERSION='2026-10-27.1-prhm-shared-registry-root-bootstrap-v2';
const PINNED_SOURCE_COMMIT='aa527f23bb2e316d28003ae4d73157e3349400ab';
const PINNED_MANIFEST_COMMIT='aa527f23bb2e316d28003ae4d73157e3349400ab';
const APPROVAL_FIELDS=Object.freeze([
 'action','project','source_commit','manifest_commit','manifest_sha256'
]);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
function fail(code){throw Error('registry_root_l4_'+code)}
function need(ok,code){if(!ok)fail(code)}
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex')}
function exact(o,keys,code){
 need(o&&typeof o==='object'&&!Array.isArray(o)&&
   Object.keys(o).sort().join('|')===keys.slice().sort().join('|'),code);
}
function bootstrapArguments(){
 const b=admission.immutableCandidate();
 return Object.freeze({
  action:admission.ACTION,
  project:admission.PROJECT,
  source_commit:PINNED_SOURCE_COMMIT,
  manifest_commit:PINNED_MANIFEST_COMMIT,
  manifest_sha256:b.manifest_sha256
 });
}
function digestArguments(args){
 exact(args,APPROVAL_FIELDS,'argument_schema');
 const pinned=bootstrapArguments();
 for(const key of APPROVAL_FIELDS)
  need(args[key]===pinned[key],'argument_pin_drift_'+key);
 return sha(Buffer.from(canonicalJson(args)));
}
function decodeSigned(token,keyBytes){
 need(typeof token==='string'&&token.length>=120&&token.length<=16384,
  'token_size_invalid');
 const segments=token.split('.');
 need(segments.length===3&&segments.every(s=>/^[A-Za-z0-9_-]+$/.test(s)),
  'token_format_invalid');
 let header,claims,signature;
 try{
  header=JSON.parse(Buffer.from(segments[0],'base64url').toString('utf8'));
  claims=JSON.parse(Buffer.from(segments[1],'base64url').toString('utf8'));
  signature=Buffer.from(segments[2],'base64url');
 }catch{fail('token_json_invalid')}
 exact(header,['alg','typ','kid'],'signed_header_untrusted');
 need(header.alg==='EdDSA'&&header.typ==='PRHM-COMPANY-APPROVAL'&&
  claims&&typeof claims==='object'&&!Array.isArray(claims)&&
  Buffer.isBuffer(keyBytes)&&keyBytes.length>=80&&keyBytes.length<=8192,
  'signed_envelope_untrusted');
 let key;
 try{key=crypto.createPublicKey(keyBytes)}catch{fail('public_key_invalid')}
 const fingerprint=sha(key.export({type:'spki',format:'der'})).slice(0,16);
 need(key.asymmetricKeyType==='ed25519'&&header.kid===fingerprint&&
   signature.length===64&&
   crypto.verify(null,Buffer.from(segments[0]+'.'+segments[1]),key,signature),
   'invalid_ed25519_signature');
 return claims;
}
function verifyConsumed({token,publicKey,ledger,nowSec,policyHash,policyVersion}={}){
 need(Number.isSafeInteger(nowSec)&&nowSec>0,'trusted_clock_missing');
 // policyHash must come from the *separately pinned and installed*
 // bootstrap policy file, never an API body or caller-selected live path.
 need(HASH.test(policyHash||'')&&policyVersion===POLICY_VERSION,
  'reviewed_policy_pin_required');
 const c=decodeSigned(token,publicKey);
 const digest=digestArguments(bootstrapArguments());
 need(UUID.test(c.approval_id||'')&&UUID.test(c.request_id||'')&&
  c.jti===c.approval_id&&c.iss===ISSUER&&
  c.action===admission.ACTION&&c.operation===OPERATION&&
  c.project==='control_plane'&&c.environment==='production'&&
  c.tool===TOOL&&c.principal_id==='mohammad'&&
  c.role==='mcp-operator'&&c.level===4&&c.risk==='critical'&&
  c.decision==='accept'&&c.approver==='mohammad'&&
  c.one_time_use===true&&c.arguments_sha256===digest&&
  c.request_hash===digest&&c.policy_id==='operation:'+OPERATION&&
  c.policy_version===POLICY_VERSION&&c.policy_hash===policyHash&&
  Number.isSafeInteger(c.nbf)&&Number.isSafeInteger(c.iat)&&
  Number.isSafeInteger(c.exp)&&c.iat===c.nbf&&c.nbf<=nowSec&&
  c.exp>nowSec&&c.exp>c.iat&&c.exp-c.iat<=180,
  'signed_bootstrap_scope_expiry_or_policy_drift');
 exact(ledger,['schema_version','approval_id','request_id','work_order_id',
  'project_id','operation','request_hash','consumed_at','consumer',
  'consumption_hash'],'consumption_ledger_schema');
 const hash=sha(Buffer.from(JSON.stringify({...ledger,consumption_hash:null})));
 need(ledger.schema_version==='prhm.approval-consumption.v1'&&
  ledger.approval_id===c.approval_id&&ledger.request_id===c.request_id&&
  ledger.operation===OPERATION&&ledger.request_hash===digest&&
  ledger.project_id==='control_plane'&&ledger.consumer===CONSUMER&&
  typeof ledger.consumed_at==='string'&&
  Number.isFinite(Date.parse(ledger.consumed_at))&&
  Date.parse(ledger.consumed_at)/1000<=nowSec&&
  Date.parse(ledger.consumed_at)/1000>=c.iat-5&&
  ledger.consumption_hash===hash,
  'approval_not_consumed_or_receipt_mismatch');
 return Object.freeze({
  crypto_verified:true,consumed_ledger_verified:true,
  request_id:c.request_id,approval_id:c.approval_id,
  action:admission.ACTION,operation:OPERATION,
  arguments_sha256:digest,manifest_sha256:bootstrapArguments().manifest_sha256,
  // Verification of consumed evidence is not a claim of unique *execution*.
  execution_claim_verified:false,bootstrap_installed:false
 });
}
// No fixed approved policy hash exists yet. This method MUST NOT accept one
// from user input. Consequently, until source-pinned policy deployment and a
// trusted root reader are reviewed, production authorization is denied.
function productionProof(){
 fail('reviewed_bootstrap_policy_and_root_adapter_not_installed');
}
module.exports=Object.freeze({
 OPERATION,TOOL,CONSUMER,ISSUER,POLICY_VERSION,
 APPROVAL_FIELDS,bootstrapArguments,digestArguments,
 decodeSigned,verifyConsumed,productionProof
});
