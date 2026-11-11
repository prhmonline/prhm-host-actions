'use strict';
/*
 * SOURCE-ONLY owner Ed25519 grant verifier for Solo Universal v2 observation.
 * No signer, keys, production CLI, service control, registry write or permit
 * consumption. A separate root-owned journal/ledger executor is mandatory.
 * NEVER reuse the already-consumed six-file Solo registration receipt.
 */
const crypto=require('node:crypto');
const binding=require('./solo-universal-v2-host-action-binding-candidate-v1.cjs');
const PIN=binding.PIN;
const OWNER_KEY_PIN='d161f17f3d3446185e9b106b459b693eb3f453653d8221fc7d8e3f6b987f477b';
const ISSUER='prhm-owner-root-of-trust';
const AUDIENCE='prhm-agent-selfmaint-exec';
const TYPE='PRHM-UNIVERSAL-SOLO-V2-OBSERVE-ADOPTION';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bad=(s)=>{throw Error('solo_universal_v2_owner_permit_'+s)};
function exactKeys(obj,allowed){
  return obj && typeof obj==='object' && !Array.isArray(obj) &&
    Object.keys(obj).sort().join('|')===allowed.slice().sort().join('|');
}
function decode(part){
  if(typeof part!=='string'||part.length<1||part.length>20000||
     !/^[A-Za-z0-9_-]+$/.test(part))bad('encoding');
  const bytes=Buffer.from(part,'base64url');
  if(!bytes.length||bytes.toString('base64url')!==part)bad('noncanonical_base64');
  return bytes;
}
function parse(part){
  const buf=decode(part);
  let obj;
  try{obj=JSON.parse(buf.toString('utf8'))}catch{bad('json_invalid')}
  if(!Buffer.from(JSON.stringify(obj)).equals(buf))bad('json_noncanonical');
  return obj;
}
const PAYLOAD_KEYS=Object.freeze([
  'iss','aud','typ','operation','action','project','environment','host',
  'level','risk','one_time_use','request_id','jti','iat','exp',
  'deploy_control_source_commit','universal_v1_before',
  'universal_v2_candidate','profile_sha256','solo_release_sha'
]);
function verifyOwnerPermit({token,publicKeyPem,requestId,nowSeconds}={}){
  binding.verifyBinding(PIN);
  if(typeof token!=='string'||token.length<100||token.length>32000)
    bad('token_invalid');
  if(!UUID.test(requestId||'')||!Number.isSafeInteger(nowSeconds)||
     nowSeconds<1)bad('request_or_clock_invalid');
  const parts=token.split('.');
  if(parts.length!==3)bad('token_structure');
  const header=parse(parts[0]),payload=parse(parts[1]),signature=decode(parts[2]);
  if(!exactKeys(header,['alg','typ','kid'])||
     header.alg!=='EdDSA'||header.typ!==TYPE)bad('header_invalid');
  let key;
  try{key=crypto.createPublicKey(publicKeyPem)}catch{bad('public_key_invalid')}
  if(key.asymmetricKeyType!=='ed25519')bad('ed25519_required');
  const keyHash=crypto.createHash('sha256').update(
    key.export({format:'der',type:'spki'})).digest('hex');
  if(keyHash!==OWNER_KEY_PIN||header.kid!==OWNER_KEY_PIN.slice(0,16))
    bad('owner_key_pin_mismatch');
  if(signature.length!==64||!crypto.verify(null,
      Buffer.from(parts[0]+'.'+parts[1]),key,signature))
    bad('signature_invalid');
  if(!exactKeys(payload,PAYLOAD_KEYS))bad('claims_schema_invalid');
  const expected={
    iss:ISSUER,aud:AUDIENCE,typ:TYPE,
    operation:binding.OPERATION,action:binding.ACTION,
    project:PIN.project,environment:PIN.environment,host:PIN.host,
    level:4,risk:'critical',one_time_use:true,
    deploy_control_source_commit:PIN.deploy_control_source_commit,
    universal_v1_before:PIN.universal_v1_before,
    universal_v2_candidate:PIN.universal_v2_candidate,
    profile_sha256:PIN.profile_sha256,solo_release_sha:PIN.release_sha
  };
  for(const [field,value] of Object.entries(expected))
    if(typeof payload[field]!==typeof value||payload[field]!==value)
      bad('scope_or_digest_mismatch_'+field);
  if(payload.request_id!==requestId||!UUID.test(payload.jti||''))
    bad('request_id_mismatch');
  if(!Number.isSafeInteger(payload.iat)||!Number.isSafeInteger(payload.exp)||
     payload.exp-payload.iat<1||payload.exp-payload.iat>180||
     payload.iat>nowSeconds+30||nowSeconds>=payload.exp||
     nowSeconds<payload.iat-30)bad('expired_or_invalid');
  // Signature verification does not equal Root admission: replay ledger,
  // manifest and live preflight must be validated by a separate root adapter.
  return Object.freeze({signature_verified:true,issuer:ISSUER,
    operation:binding.OPERATION,request_id:requestId,jti:payload.jti,
    exp:payload.exp,owner_key_pin:OWNER_KEY_PIN,
    source_only:true,consumed:false,production_authorized:false,
    independent_root_executor_required:true});
}
module.exports=Object.freeze({OWNER_KEY_PIN,TYPE,ISSUER,AUDIENCE,
  verifyOwnerPermit});
if(require.main===module){
  process.stderr.write('SOURCE_ONLY: no root permit application or production CLI\n');
  process.exitCode=64;
}
