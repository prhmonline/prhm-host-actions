'use strict';
/**
 * Cryptographic read-only receipt verifier for a *future* independently
 * registered, signed Level-4 Honartik registration bootstrap.
 *
 * Mirrors actual PRHM Approval Center Ed25519 JWS structure and on-disk
 * one-time consumption ledger. No signing, consuming, requesting, API calls,
 * secret reads or Production writes. A matching signed+consumed receipt alone
 * does not install anything or bypass the separate trusted bootstrap.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ACTION='honartik_config_center_registration_install_v1';
const EXPECTED_POLICY_VERSION='2026-10-13.2-honartik-config-center-registration-bootstrap-v1';
const PUBLIC_KEY='/var/lib/prhm-company-approval/ed25519-public.pem';
const CONSUMED_DIR='/var/lib/prhm-company-approval/consumed';
const OPERATION='host_action.'+ACTION;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function requireThat(ok,reason){if(!ok)throw new Error(reason)}
function expectedArgsSha256(manifestSha,commitSha){
 requireThat(HASH.test(manifestSha)&&/^[a-f0-9]{40}$/i.test(commitSha),'source_or_manifest_pin_invalid');
 // Must match the *actual* typed-request canonical argument hashing:
 // approved arguments object = {manifest_sha256,source_commit_sha}.
 return sha(Buffer.from(JSON.stringify({manifest_sha256:manifestSha,source_commit_sha:commitSha})));
}
function parseSignedApproval(token,publicKey){
 requireThat(typeof token==='string'&&token.length>=120&&token.length<=16384,'approval_token_format_invalid');
 const parts=token.split('.');
 requireThat(parts.length===3&&parts.every(x=>/^[A-Za-z0-9_-]+$/.test(x)),'approval_jws_format_invalid');
 let header,claims,signature;
 try{
  header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
  claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
  signature=Buffer.from(parts[2],'base64url');
 }catch{throw new Error('approval_jws_json_invalid')}
 requireThat(header&&claims&&typeof header==='object'&&typeof claims==='object'&&
   !Array.isArray(header)&&!Array.isArray(claims),'approval_jws_shape_invalid');
 const key=publicKey?.type==='public'?publicKey:crypto.createPublicKey(publicKey);
 const der=key.export({type:'spki',format:'der'});
 const kid=sha(der).slice(0,16);
 requireThat(key.asymmetricKeyType==='ed25519'&&header.alg==='EdDSA'&&
  header.typ==='PRHM-COMPANY-APPROVAL'&&header.kid===kid&&
  signature.length===64,'approval_header_or_key_invalid');
 requireThat(crypto.verify(null,Buffer.from(parts[0]+'.'+parts[1]),key,signature),
  'approval_signature_invalid');
 return claims;
}
function validateConsumedReceipt({token,publicKey,ledger,manifestSha,commitSha,nowSec,expectedPolicyVersion}){
 requireThat(Number.isSafeInteger(nowSec)&&nowSec>0,'trusted_clock_required');
 requireThat(typeof expectedPolicyVersion==='string'&&expectedPolicyVersion.length>10,
  'approval_policy_version_pin_required');
 const claims=parseSignedApproval(token,publicKey);
 const id=claims.approval_id,request=claims.request_id;
 requireThat(UUID.test(id||'')&&UUID.test(request||'')&&claims.jti===id,
  'approval_identifiers_invalid');
 requireThat(claims.iss==='prhm-company-approval'&&
  claims.action===ACTION&&claims.operation===OPERATION&&
  claims.project==='control_plane'&&claims.environment==='production'&&
  claims.tool==='host_action_v2_apply'&&claims.principal_id==='mohammad'&&
  claims.role==='mcp-operator'&&claims.level===4&&
  claims.risk==='critical'&&claims.decision==='accept'&&claims.one_time_use===true,
  'registration_approval_binding_mismatch');
 requireThat(claims.policy_version===expectedPolicyVersion&&
  HASH.test(claims.policy_hash||''),'approval_policy_identity_invalid');
 const argsHash=expectedArgsSha256(manifestSha,commitSha);
 requireThat(claims.arguments_sha256===argsHash&&claims.request_hash===argsHash,
  'approval_manifest_and_git_binding_mismatch');
 requireThat(Number.isSafeInteger(claims.nbf)&&Number.isSafeInteger(claims.iat)&&
  Number.isSafeInteger(claims.exp)&&claims.nbf<=nowSec&&claims.iat<=nowSec&&
  claims.exp>nowSec&&claims.exp>claims.iat,'approval_expired_or_future');
 requireThat(ledger&&ledger.schema_version==='prhm.approval-consumption.v1'&&
  ledger.approval_id===id&&ledger.request_id===request&&ledger.operation===OPERATION&&
  ledger.request_hash===argsHash&&typeof ledger.consumed_at==='string'&&
  Number.isFinite(Date.parse(ledger.consumed_at))&&
  Date.parse(ledger.consumed_at)/1000<=nowSec&&
  ledger.consumer==='typed-executor'&&HASH.test(ledger.consumption_hash||''),
  'approval_consumption_ledger_mismatch');
 const allowedLedger=['schema_version','approval_id','request_id','work_order_id',
  'project_id','operation','request_hash','consumed_at','consumer','consumption_hash'];
 requireThat(Object.keys(ledger).sort().join(',')===allowedLedger.sort().join(','),
  'approval_consumption_fields_unexpected');
 // Actual Approval Center writes consumption_hash = SHA256(JSON.stringify(
 // { ...consumed, consumption_hash: null })) before persisting the record.
 const canonical={...ledger,consumption_hash:null};
 requireThat(sha(Buffer.from(JSON.stringify(canonical)))===ledger.consumption_hash,
  'approval_consumption_integrity_mismatch');
 return Object.freeze({
  action:ACTION,risk:'critical',level:4,verified_by_trusted_mediator:true,
  one_time_token_consumed:true,second_confirmation_valid:true,
  request_id:request,manifest_sha256:manifestSha,source_commit_sha:commitSha
 });
}
function readPrivateBoundaryFile(filename,{maxBytes=32768,ownerUid=null}={}){
 const st=fs.lstatSync(filename);
 requireThat(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=maxBytes&&
  (st.mode&0o022)===0&&(ownerUid===null||st.uid===ownerUid),
  'approval_boundary_file_unsafe');
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const again=fs.fstatSync(fd);
  requireThat(again.isFile()&&again.dev===st.dev&&again.ino===st.ino&&
   again.size===st.size&&again.uid===st.uid,'approval_boundary_file_race');
  return fs.readFileSync(fd);
 }finally{fs.closeSync(fd)}
}
function verifyAlreadyConsumedFromLive({token,manifestSha,commitSha,nowSec}){
 // Root-owned, separately provisioned trusted bootstrap ONLY. No caller paths.
 requireThat(process.getuid?.()===0,'trusted_root_mediator_required');
 const parent=fs.lstatSync(CONSUMED_DIR);
 requireThat(parent.isDirectory()&&!parent.isSymbolicLink()&&
  fs.realpathSync(CONSUMED_DIR)===CONSUMED_DIR&&
  (parent.mode&0o022)===0,'approval_ledger_directory_unsafe');
 const publicKey=readPrivateBoundaryFile(PUBLIC_KEY,{maxBytes:8192});
 const claims=parseSignedApproval(token,publicKey);
 requireThat(UUID.test(claims.approval_id||''),'approval_identifier_invalid');
 const ledgerBytes=readPrivateBoundaryFile(
  path.join(CONSUMED_DIR,claims.approval_id+'.json'),{maxBytes:16384}
 );
 let ledger;
 try{ledger=JSON.parse(ledgerBytes.toString('utf8'))}
 catch{throw new Error('approval_consumption_json_invalid')}
 return validateConsumedReceipt({
  token,publicKey,ledger,manifestSha,commitSha,nowSec,expectedPolicyVersion:EXPECTED_POLICY_VERSION
 });
}
module.exports=Object.freeze({
 ACTION,OPERATION,EXPECTED_POLICY_VERSION,PUBLIC_KEY,CONSUMED_DIR,expectedArgsSha256,
 parseSignedApproval,validateConsumedReceipt,verifyAlreadyConsumedFromLive
});
