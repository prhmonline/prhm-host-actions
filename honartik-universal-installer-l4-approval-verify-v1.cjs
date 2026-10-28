'use strict';
/**
 * Issue #217 — cryptographic verifier for a consumed, exact-scope
 * Approval Center L4 receipt. Source-only. NO token issuer, file read,
 * HTTP endpoint, root action registration or production execution.
 *
 * The future trusted native root adapter must obtain publicKey directly
 * from its root-owned issuer trust anchor, obtain a SEALED token and a
 * previously CONSUMED private ledger entry, and compare policy+argument
 * binding against independently attested immutable live policy and source.
 * Untrusted caller-provided values never confer authority.
 */
const crypto=require('node:crypto');
const {ACTION,CONTRACT}=require('./honartik-universal-installer-l4-v1.cjs');
const FAIL=x=>{throw Error('honartik_l4_receipt_'+x)};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const HASH=x=>crypto.createHash('sha256').update(x).digest('hex');
const EXACT=(v,fields)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join('|')===fields.slice().sort().join('|');
function decodeJws(token,keyBytes){
 if(typeof token!=='string'||token.length<120||token.length>16384)FAIL('missing_token');
 const parts=token.split('.');
 if(parts.length!==3||parts.some(x=>!/^[a-zA-Z0-9_-]+$/.test(x)))FAIL('token_shape');
 let head,payload,signature,key;
 try{
   head=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
   payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
   signature=Buffer.from(parts[2],'base64url');
   key=crypto.createPublicKey(keyBytes);
 }catch{FAIL('token_decode')}
 // Check canonical compact serialization outside the decode try/catch so a
 // malformed signature is explicitly rejected as token_shape.
 if(parts.some(encoded=>Buffer.from(encoded,'base64url')
      .toString('base64url')!==encoded))FAIL('token_shape');
 const kid=HASH(key.export({format:'der',type:'spki'})).slice(0,16);
 if(!EXACT(head,['alg','typ','kid'])||
  head.alg!=='EdDSA'||head.typ!=='PRHM-COMPANY-APPROVAL'||head.kid!==kid||
  key.asymmetricKeyType!=='ed25519'||signature.length!==64||
  !crypto.verify(null,Buffer.from(parts[0]+'.'+parts[1]),key,signature))
   FAIL('signature_invalid');
 if(!payload||typeof payload!=='object'||Array.isArray(payload))FAIL('claims_invalid');
 return payload;
}
function verifyConsumedExactL4({token,issuerPublicKey,ledger,nowSec,
  trustedPolicyVersion,trustedPolicyHash,trustedArgumentsSha256}={}){
 // Policy/arguments/publicKey must be sourced and verified by ROOT-owned
 // native adapter. This pure helper cannot attest their provenance.
 if(typeof trustedPolicyVersion!=='string'||trustedPolicyVersion.length<8||
  !SHA.test(trustedPolicyHash||'')||!SHA.test(trustedArgumentsSha256||'')||
  !Number.isSafeInteger(nowSec)||nowSec<=0)FAIL('trusted_context_missing');
 const c=decodeJws(token,issuerPublicKey);
 if(!UUID.test(c.approval_id||'')||!UUID.test(c.request_id||'')||
  c.jti!==c.approval_id||c.iss!=='prhm-company-approval'||
  c.action!==ACTION||c.operation!==CONTRACT.operation||
  c.project!=='control_plane'||c.environment!=='production'||
  c.tool!=='host_action_v2_apply'||c.principal_id!=='mohammad'||
  c.role!=='mcp-operator'||c.level!==4||c.risk!=='critical'||
  c.decision!=='accept'||c.one_time_use!==true||
  c.policy_version!==trustedPolicyVersion||c.policy_hash!==trustedPolicyHash||
  c.arguments_sha256!==trustedArgumentsSha256||
  c.request_hash!==trustedArgumentsSha256||
  !Number.isSafeInteger(c.iat)||!Number.isSafeInteger(c.nbf)||
  !Number.isSafeInteger(c.exp)||c.iat>nowSec||c.nbf>nowSec||
  c.exp<=nowSec||c.exp<=c.iat||
  c.exp-c.iat>CONTRACT.max_approval_age_seconds)
   FAIL('scope_policy_expiry_mismatch');
 const ks=['schema_version','approval_id','request_id','work_order_id',
   'project_id','operation','request_hash','consumed_at','consumer','consumption_hash'];
 if(!EXACT(ledger,ks))FAIL('consumed_ledger_schema');
 const consumption=HASH(Buffer.from(JSON.stringify({...ledger,consumption_hash:null})));
 if(ledger.schema_version!=='prhm.approval-consumption.v1'||
  ledger.approval_id!==c.approval_id||ledger.request_id!==c.request_id||
  ledger.project_id!=='control_plane'||ledger.operation!==CONTRACT.operation||
  ledger.request_hash!==trustedArgumentsSha256||
  ledger.consumer!=='prhm-agent-selfmaint-exec-host-actions-v2'||
  typeof ledger.consumed_at!=='string'||!Number.isFinite(Date.parse(ledger.consumed_at))||
  Date.parse(ledger.consumed_at)/1000>nowSec||
  ledger.consumption_hash!==consumption)
   FAIL('consumed_ledger_untrusted');
 // Read-only verification: the independently trusted host performs the
 // one-time journal/lock fence before the installer transaction.
 return Object.freeze({ok:true,approval_id:c.approval_id,request_id:c.request_id,
   operation:CONTRACT.operation,action:ACTION,
   arguments_sha256:trustedArgumentsSha256,signature_verified:true,
   consumed_ledger_verified:true,issuer_verified:true});
}
module.exports=Object.freeze({decodeJws,verifyConsumedExactL4});
