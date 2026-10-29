'use strict';
/**
 * Trusted-base HTTP route adapter for EXACT Honartik registry V2.
 *
 * This is a reviewed SOURCE MODULE, not a mounted HTTP endpoint or an
 * Approval Center client. It connects the already pinned five-field gate to
 * preexisting privileged request/decision/validate/consume transports.
 * Callbacks MUST come from a separately reviewed root-owned base/bootstrap:
 * no HTTP caller may supply callbacks, URLs, paths, actions or tokens.
 *
 * No token is ever returned from request, confirm or execute.
 * Never consumes an L4 request without fresh full-root-runner preflight.
 */
const F=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const RELEASE=require('./manifests/honartik-config-center-registry-release-v2.json');
const URL=Object.freeze({
 request:'/v2/registry/honartik/request',
 confirm:'/v2/registry/honartik/confirm',
 execute:'/v2/registry/honartik/execute'
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESPONSE_KEYS=Object.freeze(['request_id','action','arguments_sha256','project','operation','environment','level','status','expires_at']);
const CAPABILITIES=Object.freeze([
 'approvalHttp','approvalBridge','getTrustedRequest','getApprovalCredentials',
 'sealApprovedToken','loadSealedApprovedToken','verifyRootPreflight',
 'readConsumedEvidence','launchPinnedRootRunner'
]);
function stop(code){throw Error('registry_v2_http_'+code)}
function need(ok,why){if(!ok)stop(why)}
function exact(obj,fields,why){
 need(obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join('|')===fields.slice().sort().join('|'),why);
}
function validatePreflight(info){
 exact(info,['ready','owner_shas','runtime_git_pins_verified','root_runner_attested',
  'durable_recovery_verified','dual_worker_discovery_verified',
  'signed_route_published','at_ms'],'preflight_shape');
 need(info.ready===true&&info.runtime_git_pins_verified===true&&
  info.root_runner_attested===true&&info.durable_recovery_verified===true&&
  info.dual_worker_discovery_verified===true&&info.signed_route_published===true,
  'trusted_runtime_not_ready');
 need(Number.isSafeInteger(info.at_ms)&&
  info.at_ms<=Date.now()+1000&&info.at_ms>Date.now()-5000,
  'preflight_stale');
 exact(info.owner_shas,['base','executor','policy','mcp'],'owner_sha_shape');
 for(const [key,pin] of Object.entries(RELEASE.registry_owners))
  need(info.owner_shas[key]===pin.before_sha256,'live_owner_sha_drift_'+key);
 return true;
}
function createHandlers(cap){
 exact(cap,CAPABILITIES,'trusted_transport_surface');
 for(const key of CAPABILITIES)need(typeof cap[key]==='function','trusted_transport_missing_'+key);
 async function preflight(){
  validatePreflight(await cap.verifyRootPreflight());
 }
 async function request(body){
  F.assertPinned(body);
  await preflight();
  const cred=await cap.getApprovalCredentials();
  need(cred&&typeof cred.request==='string'&&cred.request.length>10,
    'request_credential_unavailable');
  const envelope=F.requestEnvelope(body);
  const result=await cap.approvalHttp('POST','/v1/requests',cred.request,envelope);
  const info=result?.request;
  need(info&&UUID.test(info.request_id||''),'approval_request_not_created');
  // Verify from separately authenticated, authoritative request lookup,
  // never trust a response echoed by an untrusted HTTP client.
  const trusted=await cap.getTrustedRequest(info.request_id);
  F.checkRequestRecord(trusted,info.request_id);
  need(info.arguments_sha256===F.ARGUMENTS_SHA &&
   info.action===F.REQUEST.action &&
   Number(info.level)===4,'approval_request_response_unbound');
  return Object.freeze({ok:true,request_id:info.request_id,
   action:F.REQUEST.action,arguments_sha256:F.ARGUMENTS_SHA,
   status:'pending',secret_exposed:false});
 }
 async function confirm(body){
  exact(body,[...F.KEYS,'request_id','second_confirmation'],'confirm_schema');
  need(UUID.test(body.request_id||''),'request_id_invalid');
  const trusted=await cap.getTrustedRequest(body.request_id);
  const envelope=F.confirmEnvelope(body,trusted);
  const cred=await cap.getApprovalCredentials();
  need(cred&&typeof cred.decision==='string'&&cred.decision.length>10,
   'decision_credential_unavailable');
  const result=await cap.approvalHttp('POST',
   '/v1/requests/'+body.request_id+'/decision',cred.decision,envelope.decision);
  const approval=result?.approval;
  const token=result?.approval_token||result?.token||approval?.token;
  need(approval?.execution_authorized===true&&
   approval.action===F.REQUEST.action&&
   approval.arguments_sha256===F.ARGUMENTS_SHA&&
   approval.request_id===body.request_id&&
   approval.level===4,'approval_decision_binding_failed');
  need(typeof token==='string'&&token.length>=120&&token.length<=16384&&
   /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token),
   'signed_approval_token_missing');
  // Fixed root-vault key is the already authenticated request ID, never
  // a caller-controlled path. 0600 storage and fsync are executor duties.
  need(await cap.sealApprovedToken(body.request_id,token)===true,
   'sealed_token_write_unverified');
  return Object.freeze({ok:true,request_id:body.request_id,
   action:F.REQUEST.action,arguments_sha256:F.ARGUMENTS_SHA,
   status:'approved',secret_exposed:false});
 }
 async function execute(body){
  exact(body,[...F.KEYS,'request_id'],'execute_schema');
  F.assertPinned(Object.fromEntries(F.KEYS.map(k=>[k,body[k]])));
  need(UUID.test(body.request_id||''),'request_id_invalid');
  // Most important ordering: DO NOT consume a valid L4 token before
  // immutable binaries, service recovery, exact owner pins and both MCP
  // workers are attested by the root preflight.
  await preflight();
  const token=await cap.loadSealedApprovedToken(body.request_id);
  const binding=F.authorizeConsumeEnvelope({...F.REQUEST,approval_token:token});
  const check=await cap.approvalBridge('/v1/validate',binding.validation);
  need(check?.valid===true,'signed_approval_validation_failed');
  const consumed=await cap.approvalBridge('/v1/consume',binding.consumption);
  need(consumed?.consumed===true,'signed_approval_not_consumed');
  // Once consumed, this approval is NEVER re-issued or retried. A failed
  // launcher must use the durable recovery journal, not a replay.
  const proof=await cap.readConsumedEvidence(body.request_id);
  need(proof&&proof.ledger&&proof.publicKey&&
   Number.isSafeInteger(proof.nowSec),'consumed_ledger_unavailable');
  const verified=F.verifyConsumedCryptographically({
   token,publicKey:proof.publicKey,ledger:proof.ledger,nowSec:proof.nowSec
  });
  need(verified.request_id===body.request_id,'consumed_request_id_mismatch');
  const installed=await cap.launchPinnedRootRunner(Object.freeze({
   input:binding.args,approvalToken:token,request_id:body.request_id
  }));
  need(installed?.ok===true&&installed?.registry_visible===true&&
   installed?.rollback==='not_needed'&&
   installed?.source_commit===F.REQUEST.source_commit&&
   installed?.manifest_commit===F.REQUEST.manifest_commit,
   'root_runner_postcondition_unverified');
  return Object.freeze({ok:true,request_id:body.request_id,
   action:F.REQUEST.action,arguments_sha256:F.ARGUMENTS_SHA,
   status:'registered',registry_visible:true,secret_exposed:false});
 }
 async function dispatch(method,url,body){
  need(method==='POST','method_not_allowlisted');
  if(url===URL.request)return request(body);
  if(url===URL.confirm)return confirm(body);
  if(url===URL.execute)return execute(body);
  stop('endpoint_not_allowlisted');
 }
 return Object.freeze({dispatch});
}
module.exports=Object.freeze({URL,CAPABILITIES,createHandlers,validatePreflight});
