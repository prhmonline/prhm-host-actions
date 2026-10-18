'use strict';
/**
 * Shared registrar / Host Actions v2 five-field argument continuity gate.
 *
 * SOURCE-ONLY. This module cannot request, mint, sign, consume or apply
 * approvals. The trusted executor must wire the actual request persistence,
 * Ed25519 verification + single-use consumed ledger and atomic installer.
 *
 * It only ensures that EXACTLY the same canonical five-field argument bytes
 * and digest survive each stage. Never accept an "approved" flag, action-only
 * requests, arbitrary code paths or caller-supplied clock/keys.
 */
const crypto=require('node:crypto');
const registration=require('./registration-contract.cjs');
const gateway=require('../../prhm-action-registry-gateway-v1.cjs');
const bridge=require('../../prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const FIELDS=Object.freeze([
 'action','project','source_commit','manifest_commit','manifest_sha256'
]);
const PERSISTED_FIELDS=Object.freeze(['arguments','arguments_sha256','request_hash']);
const SHA256=/^[a-f0-9]{64}$/;
function deny(reason){throw Error('agent3_five_field_continuity_denied:'+reason);}
function normalized(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).sort().join('|')!==FIELDS.slice().sort().join('|'))
   deny('exact_five_fields_required');
 return registration.boundArgs(input);
}
function bind(input){
 const args=normalized(input);
 const canonical=gateway.canonicalArgs(args);
 const digest=gateway.approvalBindingSha(args);
 if(typeof canonical!=='string'||canonical.length>360||!SHA256.test(digest)||
    crypto.createHash('sha256').update(Buffer.from(canonical)).digest('hex')!==digest)
   deny('canonical_digest_disagreement');
 const typed=bridge.strictRequest(args);
 if(typed.arguments_sha256!==digest)deny('typed_request_digest_disagreement');
 return Object.freeze({
  schema:'prhm.agent3.five-field-continuity.v1',
  action:gateway.ACTION,
  operation:gateway.OPERATION,
  arguments:Object.freeze({...args}),
  arguments_sha256:digest,
  canonical_json:canonical,
  approval_level:4,
  risk:'critical',
  ttl_max_seconds:180,
  signed_approval_issued:false,
  signed_approval_consumed:false,
  production_mutation:false
 });
}
function exactHash(value){
 if(typeof value!=='string'||!SHA256.test(value))deny('invalid_persisted_digest');
 return value;
}
/**
 * The existing executor must fetch the persisted pending request itself.
 * The caller cannot manufacture a trusted request by merely passing this
 * function an object. Return only byte/digest continuity, never authorization.
 */
function compareStoredRequest({storedArguments,storedArgumentsSha256,storedRequestHash,
  suppliedArguments}={}){
 const original=bind(storedArguments);
 const supplied=bind(suppliedArguments);
 const digest=original.arguments_sha256;
 for(const observed of [storedArgumentsSha256,storedRequestHash])
   if(exactHash(observed)!==digest)deny('stored_hash_mismatch');
 if(supplied.arguments_sha256!==digest||
    supplied.canonical_json!==original.canonical_json)
   deny('request_arguments_changed');
 return Object.freeze({
  ok:true,mode:'ARGUMENT_CONTINUITY_ONLY',
  action:gateway.ACTION,operation:gateway.OPERATION,
  arguments_sha256:digest,
  approval_authenticated:false,consumption_ledger_verified:false,
  authorization_granted:false,installer_executed:false
 });
}
function compareApplyBinding({persistedRequest,applyArguments,consumedArgumentsSha256}={}){
 if(!persistedRequest||typeof persistedRequest!=='object'||Array.isArray(persistedRequest))
   deny('persisted_request_required');
 // Require the exact trusted *continuity record* shape. In particular,
 // boolean "approved" flags, tokens and caller-generated receipts are never
 // valid persisted authority. The native root executor must separately
 // retrieve and authenticate its own pending request record.
 if(Object.keys(persistedRequest).sort().join('|')!==
    PERSISTED_FIELDS.slice().sort().join('|'))
   deny('persisted_continuity_record_schema');
 const base=compareStoredRequest({
  storedArguments:persistedRequest.arguments,
  storedArgumentsSha256:persistedRequest.arguments_sha256,
  storedRequestHash:persistedRequest.request_hash,
  suppliedArguments:applyArguments
 });
 if(exactHash(consumedArgumentsSha256)!==base.arguments_sha256)
   deny('consumed_hash_changed');
 return Object.freeze({
  ...base,stage:'APPLY_BINDING_ONLY',
  signed_approval_verified:false,
  consumed_approval_verified:false,
  approved_to_install:false
 });
}
if(require.main===module){
 process.stderr.write('source-only continuity library; no CLI approval or apply\n');
 process.exitCode=78;
}
module.exports=Object.freeze({FIELDS,PERSISTED_FIELDS,bind,compareStoredRequest,compareApplyBinding});
