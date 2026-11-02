'use strict';
/*
 * SOURCE-ONLY: independent Provider Root-of-Trust signed-receipt verifier.
 * No CLI, no signer, no key generation, no production installer or dispatcher.
 * The Provider must provision/pin the REAL public key independently.
 *
 * This module never grants root privilege itself. An authorized Provider-only
 * adapter must call verifyReceipt and consumeReceipt before any write, then
 * attach the exact registered operation to the approved 6-file transaction.
 */
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const tx=require('./solo-company-runtime-signed-registration-transaction-v1.js');
const ACTION='solo_company_runtime_registration_v1';
const OPERATION='host_action.'+ACTION;
const TYPE='PRHM-SOLO-ROOT-REGISTRATION';
const ISSUER='prhm-provider-root-of-trust';
const AUDIENCE='prhm-agent-selfmaint-exec';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const FAIL=c=>{throw Error('solo_provider_receipt_'+c)};
function keysExact(obj,fields){
  return !!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
    Object.keys(obj).sort().join('|')===fields.slice().sort().join('|');
}
function decodeStrict(part){
  if(typeof part!=='string'||!/^[A-Za-z0-9_-]+$/.test(part)||part.length>24000)
    FAIL('encoding');
  const buffer=Buffer.from(part,'base64url');
  if(buffer.length===0||buffer.toString('base64url')!==part)FAIL('noncanonical_encoding');
  return buffer;
}
function parseCanonical(part){
  const bytes=decodeStrict(part);
  let value;
  try{value=JSON.parse(bytes.toString('utf8'))}catch{FAIL('json_invalid')}
  if(!Buffer.from(JSON.stringify(value)).equals(bytes))FAIL('json_noncanonical');
  return value;
}
function bindPlan(plan){
  tx.verifyPlan(plan);
  return {
    action:ACTION,
    operation:OPERATION,
    release_sha:plan.release_sha,
    source_commits:plan.source_commits,
    files:plan.steps.map(s=>({
      kind:s.kind,path:s.path,
      before_sha256:s.before_sha256,after_sha256:s.after_sha256
    }))
  };
}
function hashPlan(plan){
  return tx.hash(Buffer.from(JSON.stringify(bindPlan(plan))));
}
function verifyReceipt({token,publicKeyPem,pinnedPublicKeySha256,plan,requestId,nowSeconds}={}){
  if(!SHA.test(pinnedPublicKeySha256||''))FAIL('provider_key_pin_required');
  if(typeof token!=='string'||token.length<110||token.length>32000)FAIL('token_invalid');
  if(!UUID.test(requestId||''))FAIL('request_id_invalid');
  if(!Number.isSafeInteger(nowSeconds)||nowSeconds<1)FAIL('time_invalid');
  const parts=token.split('.');
  if(parts.length!==3)FAIL('token_structure');
  const header=parseCanonical(parts[0]),payload=parseCanonical(parts[1]),signature=decodeStrict(parts[2]);
  let key;
  try{key=crypto.createPublicKey(publicKeyPem)}catch{FAIL('public_key_invalid')}
  if(key.asymmetricKeyType!=='ed25519')FAIL('ed25519_required');
  const keyDer=key.export({format:'der',type:'spki'});
  const keySha=tx.hash(keyDer);
  if(keySha!==pinnedPublicKeySha256)FAIL('provider_key_pin_mismatch');
  if(!keysExact(header,['alg','typ','kid'])||header.alg!=='EdDSA'||header.typ!==TYPE||
    header.kid!==keySha.slice(0,16))FAIL('header_invalid');
  if(signature.length!==64||!crypto.verify(null,Buffer.from(parts[0]+'.'+parts[1]),key,signature))
    FAIL('signature_invalid');
  if(!keysExact(payload,['iss','aud','env','operation','action','release_sha','plan_sha256',
    'request_id','jti','level','risk','one_time_use','iat','exp','source_commits']))
    FAIL('claims_invalid');
  if(payload.iss!==ISSUER||payload.aud!==AUDIENCE||payload.env!=='production'||
     payload.action!==ACTION||payload.operation!==OPERATION||payload.release_sha!==tx.PINS?.release_sha &&
     payload.release_sha!=='0eb43d72aab3f10db22172c8be4c0411cf22d074')
     FAIL('scope_invalid');
  if(payload.release_sha!=='0eb43d72aab3f10db22172c8be4c0411cf22d074'||
     payload.plan_sha256!==hashPlan(plan)||
     JSON.stringify(payload.source_commits)!==JSON.stringify(tx.SOURCE_COMMITS))
     FAIL('plan_binding_invalid');
  if(payload.request_id!==requestId||!UUID.test(payload.jti||'')||
     payload.level!==4||payload.risk!=='critical'||payload.one_time_use!==true)
    FAIL('approval_binding_invalid');
  if(!Number.isSafeInteger(payload.iat)||!Number.isSafeInteger(payload.exp)||
     payload.exp-payload.iat<1||payload.exp-payload.iat>180||
     payload.iat>nowSeconds+30||nowSeconds>=payload.exp||
     nowSeconds<payload.iat-30)FAIL('receipt_expired_or_invalid');
  return Object.freeze({
    verified:true,consumed:false,operation:OPERATION,level:4,risk:'critical',
    request_id:requestId,jti:payload.jti,expiry:payload.exp,
    plan_sha256:payload.plan_sha256,
    provider_public_key_sha256:keySha
  });
}
function consumeReceipt(receipt,ledgerDir,nowSeconds){
  if(!receipt||receipt.verified!==true||receipt.consumed!==false||
     receipt.operation!==OPERATION||receipt.level!==4||receipt.risk!=='critical'||
     !UUID.test(receipt.request_id||'')||!UUID.test(receipt.jti||'')||
     !Number.isSafeInteger(nowSeconds)||nowSeconds>=receipt.expiry)
    FAIL('consumption_binding_invalid');
  if(typeof ledgerDir!=='string'||!path.isAbsolute(ledgerDir))FAIL('ledger_path_invalid');
  const stat=fs.lstatSync(ledgerDir);
  if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(ledgerDir)!==ledgerDir||
     (stat.mode&0o077)!==0||stat.uid!==process.getuid())FAIL('ledger_directory_unsafe');
  // Retain the marker after failed installer/rollback; no path to reset it.
  const marker=path.join(ledgerDir,receipt.jti+'.json');
  let fd;
  try{fd=fs.openSync(marker,'wx',0o600)}
  catch(error){if(error.code==='EEXIST')FAIL('receipt_replay');throw error}
  try{
    fs.writeFileSync(fd,JSON.stringify({jti:receipt.jti,operation:OPERATION,
      request_id:receipt.request_id,plan_sha256:receipt.plan_sha256})+'\n');
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd)}
  const dfd=fs.openSync(ledgerDir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
  try{fs.fsyncSync(dfd)}finally{fs.closeSync(dfd)}
  return Object.freeze({...receipt,consumed:true});
}
module.exports=Object.freeze({ACTION,OPERATION,TYPE,ISSUER,AUDIENCE,UUID,SHA,
  bindPlan,hashPlan,verifyReceipt,consumeReceipt});
if(require.main===module){
  process.stderr.write('NO_CLI: real Provider signing key + authenticated dispatcher required\n');
  process.exitCode=64;
}
