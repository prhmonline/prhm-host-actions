'use strict';
/**
 * Source-derived protocol contract for prhmonline/prhm-company-control-plane
 * approval/server.js (Git source, not attested to be the running binary).
 * Read-only, pure, test-key only: this module cannot authorize an install.
 *
 * Live issuer:
 *  EdDSA JWT-like header.payload.signature;
 *  header {alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',kid:SHA256(SPKI-DER).slice(0,16)};
 *  claims contain arguments_sha256, action/operation, policy_version/hash,
 *  nonce, nbf/iat/exp, approval_id/jti, rollback_reference_hash.
 *  Replays are rejected ONLY by issuer /v1/consume with exclusive persisted
 *  consumed receipt. A standalone signature check never proves consumption,
 *  approved human decision or policy provenance.
 */
const crypto=require('node:crypto');
const PRE=Object.freeze({
  base:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
  exec:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
  policy:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',
  mcp:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'
});
const POST=Object.freeze({
  base:'629212ae3052eab380ea1b3fc7c0b15395dfb23a251331762ebb781e1bbf1b2f',
  exec:'9dade5d2a9a9722c1dd1283a3a1002325da02e134804aca1ea6d673cf2de3e87',
  policy:'9a2c47db59211a638976ee181e8a5b246c79f082371d82a7396c6a07f646faa7',
  mcp:'52d3c0c04cd3bb26815403e2c089f9a408047bd9d376536ae570df669a7fd2a3'
});
const ACTION='honartik_git_worktree_fixed_v1';
const OPERATION='host_action.'+ACTION;
const ROLLBACK='host-action-v2:honartik-git-worktree-fixed-v1:worktree-remove';
const POLICY_VERSION='2026-10-18.1-honartik-worktree-level4-v1';
const TOOL='host_action_v2_apply';
const PROJECT='control_plane';
const ENVIRONMENT='production';
const ROLE='mcp-operator';
const PRINCIPAL='mohammad';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[a-f0-9]{64}$/;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(s){throw Error('real_issuer_jws_contract_'+s);}
function canon(v){
  // Implements the issuer's canonicalJson for JSON-compatible arguments.
  if(v===null||typeof v!=='object')return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(canon).join(',')+']';
  return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';
}
function fixedArgs(){
  return {
    owner_pre_sha256:{...PRE},
    owner_post_sha256:{...POST},
    rollback_reference:ROLLBACK
  };
}
function boundArgumentsHash(){
  return sha(Buffer.from(canon(fixedArgs()),'utf8'));
}
function requestShape(){
  return {
    principal_id:PRINCIPAL,role:ROLE,tool:TOOL,
    project:PROJECT,environment:ENVIRONMENT,
    action:ACTION,risk:'critical',operation:OPERATION,
    arguments:fixedArgs(),arguments_sha256:boundArgumentsHash(),
    rollback_reference:ROLLBACK,ttl_seconds:180
  };
}
function canonicalSegment(s){
  if(typeof s!=='string'||s.length===0||s.length>15000||!/^[A-Za-z0-9_-]+$/.test(s))
    fail('segment_invalid');
  const b=Buffer.from(s,'base64url');
  if(b.toString('base64url')!==s)fail('segment_noncanonical');
  return b;
}
function parseToken(token){
  if(typeof token!=='string'||token.length>16384)fail('token_invalid');
  const segments=token.split('.');
  if(segments.length!==3)fail('token_segment_count');
  const h=canonicalSegment(segments[0]),c=canonicalSegment(segments[1]),s=canonicalSegment(segments[2]);
  if(s.length!==64)fail('ed25519_signature_length');
  let header,claims;
  try{header=JSON.parse(h.toString('utf8'));claims=JSON.parse(c.toString('utf8'));}
  catch{fail('jwt_json_invalid');}
  if(!header||typeof header!=='object'||Array.isArray(header)||
     !claims||typeof claims!=='object'||Array.isArray(claims))
    fail('jwt_shape_invalid');
  if(Object.keys(header).sort().join(',')!=='alg,kid,typ')
    fail('header_keys');
  if(header.alg!=='EdDSA'||header.typ!=='PRHM-COMPANY-APPROVAL'||
     typeof header.kid!=='string'||!HEX.test(header.kid.padEnd(64,'0'))||
     header.kid.length!==16)fail('header_invalid');
  return {segments,signature:s,header,claims};
}
function checkClaims(claims,context){
  if(!context||typeof context!=='object'||!HEX.test(context.expected_policy_hash||''))
    fail('expected_policy_hash_required');
  const required={
    iss:'prhm-company-approval',
    operation:OPERATION,action:ACTION,tool:TOOL,project:PROJECT,
    environment:ENVIRONMENT,principal_id:PRINCIPAL,role:ROLE,
    level:4,risk:'critical',approver:'mohammad',decision:'accept',
    one_time_use:true,policy_version:POLICY_VERSION,
    arguments_sha256:boundArgumentsHash(),
    rollback_reference_hash:sha(Buffer.from(ROLLBACK,'utf8')),
    policy_hash:context.expected_policy_hash
  };
  for(const [field,value] of Object.entries(required))
    if(claims[field]!==value)fail('claims_binding_'+field);
  if(!UUID.test(claims.approval_id||'')||
     claims.jti!==claims.approval_id||
     !UUID.test(claims.request_id||'')||
     !UUID.test(claims.nonce||''))fail('claims_identifiers');
  if(claims.policy_id!=='operation:'+OPERATION)fail('policy_id');
  if(typeof claims.iat!=='number'||typeof claims.nbf!=='number'||typeof claims.exp!=='number'||
     ![claims.iat,claims.nbf,claims.exp].every(Number.isSafeInteger))
    fail('claims_time_format');
  if(claims.iat<0||claims.nbf<claims.iat||claims.exp<=claims.iat||
     claims.exp-claims.iat>180)fail('claims_time_window');
  const now=context.now;
  if(!Number.isSafeInteger(now)||now<claims.nbf||now>=claims.exp)
    fail('claims_expired_or_not_yet_valid');
  if(claims.arguments_sha256!==claims.request_hash&&claims.request_hash!==null)
    fail('claim_request_hash_mismatch');
  return true;
}
function verifyOffline(token,context){
  const {header,claims,signature,segments}=parseToken(token);
  if(!context||!(context.issuerPublicKey instanceof crypto.KeyObject)||
      context.issuerPublicKey.type!=='public'||
      context.issuerPublicKey.asymmetricKeyType!=='ed25519')
    fail('ed25519_public_key_required');
  const fingerprint=sha(context.issuerPublicKey.export({type:'spki',format:'der'}));
  if(header.kid!==fingerprint.slice(0,16))fail('key_fingerprint_mismatch');
  if(typeof context.expected_key_fingerprint!=='string'||
     context.expected_key_fingerprint!==fingerprint)fail('independent_key_pin_required');
  const message=Buffer.from(segments[0]+'.'+segments[1],'utf8');
  if(!crypto.verify(null,message,context.issuerPublicKey,signature))
    fail('signature_invalid');
  checkClaims(claims,context);
  return Object.freeze({
    schema:'prhm.iticket.source-derived-real-issuer-ed25519-jws.v1',
    source_protocol_shape_attested:true,
    signed_under_supplied_key:true,
    independently_pinned_key_in_fixture:true,
    action_hashes_scope_and_expiry_valid:true,
    issuer_runtime_version_attested:false,
    real_issuer_trust_anchor_attested:false,
    issuer_record_verified:false,
    second_confirmation_verified:false,
    one_time_use_consumption_verified:false,
    live_registration_authorized:false,
    production_mutation:false
  });
}
module.exports=Object.freeze({PRE,POST,ACTION,OPERATION,ROLLBACK,POLICY_VERSION,
  boundArgumentsHash,fixedArgs,requestShape,canon,parseToken,checkClaims,verifyOffline});
