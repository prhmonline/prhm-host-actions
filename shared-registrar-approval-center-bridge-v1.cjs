'use strict';

/**
 * Source candidate: fixed Registrar request -> decision -> validate -> consume.
 *
 * NOT an HTTP server, signer, root bootstrap, credential handler, CLI,
 * policy installer or route registrar. Only the EXISTING root-owned Host
 * Actions executor may bind these callbacks to the existing authenticated
 * Approval Center transports after independently reviewed installation.
 *
 * Authenticated transports are owned by the host (existing env/token
 * handling). Never accept URL, headers, bearer token, path, or callbacks
 * from an MCP/HTTP request. No JWS or credentials are stored or logged.
 */
const g=require('./prhm-action-registry-gateway-v1.cjs');
const typed=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const ACTION=g.ACTION;
const OPERATION=g.OPERATION;
const SECOND='CONFIRM_LEVEL_4_CRITICAL';
const CONSUMER='prhm-agent-selfmaint-exec-host-actions-v2';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
function fail(c){throw Error('registrar_approval_bridge_'+c)}
function exact(o,keys){
 if(!o||typeof o!=='object'||Array.isArray(o)||
    Object.keys(o).sort().join('|')!==keys.slice().sort().join('|'))
  fail('request_schema');
}
const CONFIRM_FIELDS=Object.freeze(['request_id','second_confirmation',
 'arguments','arguments_sha256','policy_hash']);
function assertBoundCommand(command){
 exact(command,CONFIRM_FIELDS);
 if(!UUID.test(command.request_id||'')||command.second_confirmation!==SECOND)
  fail('critical_request_invalid');
 const digest=g.approvalBindingSha(command.arguments);
 if(digest!==command.arguments_sha256||!HASH.test(command.policy_hash||''))
  fail('five_field_binding_invalid');
 return Object.freeze({
  request_id:command.request_id,
  args:Object.freeze({...command.arguments}),
  hash:digest,policy_hash:command.policy_hash
 });
}
function requestPayload(payload){
 // Only the reviewed fixed typed payload can be submitted to the issuer.
 const req=typed.typedApprovalRequest(payload?.arguments);
 exact(payload,Object.keys(req));
 for(const key of Object.keys(req)){
  if(key==='arguments')continue;
  if(payload[key]!==req[key])fail('typed_request_drift');
 }
 if(g.approvalBindingSha(payload.arguments)!==payload.arguments_sha256)
  fail('typed_request_hash_invalid');
 return req;
}
function decisionPayload(command){
 assertBoundCommand(command);
 return Object.freeze({
  decision:'accept',
  second_confirmation:SECOND,
  rollback_reference:typed.typedApprovalRequest(command.arguments).rollback_reference,
  note:'Reviewed fixed registrar transaction; critical L4'
 });
}
function consumptionBinding(command,token){
 const b=assertBoundCommand(command);
 if(typeof token!=='string'||token.length<120||token.length>16384)
  fail('signed_l4_missing');
 return Object.freeze({
  approval_token:token,
  principal_id:'mohammad',role:'mcp-operator',
  tool:'host_action_v2_apply',project:'control_plane',
  environment:'production',action:ACTION,risk:'critical',
  operation:OPERATION,arguments_sha256:b.hash
 });
}
function assertIssuedResponse(command,result){
 const b=assertBoundCommand(command);
 const issued=result?.approval;
 if(!issued||issued.request_id!==b.request_id||
  issued.policy_hash!==b.policy_hash||
  issued.policy_version!==g.POLICY_VERSION)
  fail('issued_policy_or_request_mismatch');
 typed.validateReceipt(b.args,SECOND,issued);
 const token=result?.approval_token;
 if(typeof token!=='string'||token.length<120||token.length>16384)
  fail('issued_token_absent');
 return token;
}
function assertConsumedResponse(command,response){
 const b=assertBoundCommand(command),c=response?.consumption;
 if(response?.consumed!==true||!c||
  c.schema_version!=='prhm.approval-consumption.v1'||
  c.request_id!==b.request_id||c.operation!==OPERATION||
  c.request_hash!==b.hash||c.consumer!==CONSUMER||
  !UUID.test(c.approval_id||'')||!HASH.test(c.consumption_hash||''))
  fail('consumption_proof_mismatch');
 return true;
}
function rootOnly(){
 if(typeof process.getuid!=='function'||process.getuid()!==0)
  fail('root_required');
}
function createForExistingTrustedHost(h){
 rootOnly();
 const keys=['postTypedRequest','postDecision','postValidate','postConsume'];
 if(!h||keys.some(k=>typeof h[k]!=='function'))
  fail('trusted_host_transport_missing');
 return Object.freeze({
  async requestTypedApproval(payload){
   rootOnly();
   const body=requestPayload(payload);
   const result=await h.postTypedRequest(body);
   // The dispatcher independently verifies and durably binds pending record.
   if(!result||!result.request||result.request.action!==ACTION||
      result.request.arguments_sha256!==body.arguments_sha256)
    fail('pending_issuer_result_invalid');
   return result;
  },
  async confirmAndConsumeBoundApproval(command){
   rootOnly();
   const b=assertBoundCommand(command);
   const decision=decisionPayload(command);
   // Only this exact request ID; never accept an issuer token from a caller.
   const result=await h.postDecision(b.request_id,decision);
   const token=assertIssuedResponse(command,result);
   const binding=consumptionBinding(command,token);
   const validated=await h.postValidate(binding);
   if(validated?.valid!==true)
    fail('issuer_validation_denied');
   const consumed=await h.postConsume({...binding,consumer:CONSUMER});
   assertConsumedResponse(command,consumed);
   // The root dispatcher MUST independently verify the signed JWS, live
   // policy hash, persisted consumed ledger and same pending request ID.
   return Object.freeze({approval_token:token});
  }
 });
}
module.exports=Object.freeze({
 ACTION,OPERATION,CONSUMER,SECOND,
 requestPayload,assertBoundCommand,decisionPayload,consumptionBinding,
 assertIssuedResponse,assertConsumedResponse,createForExistingTrustedHost
});
if(require.main===module){
 process.stderr.write('No standalone Approval Center bridge. Trusted root executor required.\n');
 process.exitCode=64;
}
