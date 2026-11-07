'use strict';
/**
 * Five-field Base v3 Approval Center request / decision / consume protocol.
 *
 * Integrates with the REAL Base's observed Approval Center API envelopes:
 *   POST /v1/requests, POST /v1/requests/<uuid>/decision,
 *   /v1/validate and /v1/consume.
 *
 * This source is not the live Base handler. It contains no network calls,
 * disk writes, key loading, credential reading, signatures, root capabilities
 * or arbitrary callbacks. Its output is an argument/receipt contract that
 * can be used ONLY by a reviewed trusted native server integration.
 *
 * Ed25519 signature, fresh request ID and persisted consumed ledger MUST be
 * independently verified by the fixed trusted root gateway after consumption.
 * No validity/authority flags from the caller may waive these checks.
 */
const route=require('./five-field-native-route-contract.cjs');
const bridge=require('../../prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const gateway=require('../../prhm-action-registry-gateway-v1.cjs');
const registration=require('./registration-contract.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNED=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const CREATE_PATH='/v1/requests';
const VALIDATE_PATH='/v1/validate';
const CONSUME_PATH='/v1/consume';
const TOOL='host_action_v2_apply';
const CONSUMER='prhm-agent-selfmaint-exec-host-actions-v2';
const ROLLBACK='host-action-v2:prhm-action-registry-install-v1:verified-four-owner-restore';
function deny(message){throw Error('agent3_v3_approval_protocol_denied:'+message);}
function exact(o,keys){return !!o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join('|')===keys.slice().sort().join('|');}
function issueEnvelope(args){
 const prepared=route.prepareRequest(args);
 const proposal=bridge.typedApprovalRequest(args);
 if(proposal.rollback_reference!==ROLLBACK||proposal.tool!==TOOL||
    proposal.ttl_seconds!==180||
    proposal.arguments_sha256!==prepared.arguments_sha256||
    proposal.risk!=='critical'||proposal.operation!==gateway.OPERATION)
   deny('untrusted_request_contract');
 return Object.freeze({path:CREATE_PATH,request:proposal,
   arguments_sha256:prepared.arguments_sha256,
   approved:false,signed:false,consumed:false});
}
function verifyIssued({args,response,nowMs=Date.now()}={}){
 const offer=issueEnvelope(args);
 const issued=response?.request;
 if(!issued||typeof issued!=='object'||Array.isArray(issued)||
    !UUID.test(issued.request_id||'')||
    issued.action!==gateway.ACTION||
    issued.arguments_sha256!==offer.arguments_sha256||
    Number(issued.level)!==4||issued.risk!=='critical')
   deny('issuer_request_binding');
 if(!Number.isSafeInteger(nowMs)||nowMs<=0||
    typeof issued.expires_at!=='string')deny('issuer_timestamp');
 const deadline=Date.parse(issued.expires_at);
 if(!Number.isFinite(deadline)||deadline<=nowMs||deadline>nowMs+180000)
   deny('issuer_expiry_not_bound_to_short_ttl');
 return Object.freeze({
   request_id:issued.request_id,expires_at:issued.expires_at,
   action:gateway.ACTION,arguments_sha256:offer.arguments_sha256,
   level:4,risk:'critical',signed_approval_issued:false,
   production_mutation:false
 });
}
function decisionEnvelope({body,persistedRequest}={}){
 const precheck=route.prepareApply({body,persistedRequest});
 if(body.action!==gateway.ACTION||
    precheck.arguments_sha256!==persistedRequest.request_hash)
   deny('decision_binding_drift');
 return Object.freeze({
  path:'/v1/requests/'+precheck.request_id+'/decision',
  request_id:precheck.request_id,
  payload:Object.freeze({decision:'accept',rollback_reference:ROLLBACK,
    note:'Fixed SHA-bound Agent 3 shared action registry enrollment',
    second_confirmation:route.CRITICAL_CONFIRM}),
  arguments_sha256:precheck.arguments_sha256,
  approval_verified:false,
  approval_consumed:false
 });
}
function verifyDecision({body,persistedRequest,decisionResponse}={}){
 const d=decisionEnvelope({body,persistedRequest});
 const approval=decisionResponse?.approval;
 const token=decisionResponse?.approval_token??decisionResponse?.token??approval?.token;
 if(!approval||typeof approval!=='object'||Array.isArray(approval)||
    approval.request_id!==d.request_id||
    approval.action!==gateway.ACTION||
    approval.arguments_sha256!==d.arguments_sha256||
    Number(approval.level)!==4||approval.risk!=='critical'||
    approval.execution_authorized!==true||approval.one_time_use!==true||
    typeof token!=='string'||token.length<120||token.length>16384||
    !SIGNED.test(token))
   deny('untrusted_unbound_decision');
 // A correctly SHAPED JWS is not a verified JWS. Never return a true trust
 // claim until root verifies Ed25519 against its fixed public key and ledger.
 return Object.freeze({
  request_id:d.request_id,arguments_sha256:d.arguments_sha256,
  approval_token:token,token_shape_valid:true,
  signature_verified:false,ledger_consumed:false,
  install_authorized:false
 });
}
function consumeEnvelope({body,persistedRequest,decisionResponse}={}){
 const d=verifyDecision({body,persistedRequest,decisionResponse});
 const approval_token=d.approval_token;
 const args=registration.boundArgs(Object.fromEntries(
   route.REQUEST_FIELDS.map(k=>[k,body[k]])));
 const arguments_sha256=gateway.approvalBindingSha(args);
 if(d.arguments_sha256!==arguments_sha256)
  deny('decision_hash_mismatch');
 const binding=Object.freeze({
  approval_token,principal_id:'mohammad',role:'mcp-operator',
  tool:TOOL,project:'control_plane',environment:'production',
  action:gateway.ACTION,risk:'critical',operation:gateway.OPERATION,
  arguments_sha256
 });
 return Object.freeze({
  validate_path:VALIDATE_PATH,consume_path:CONSUME_PATH,
  validate_binding:binding,
  consume_binding:Object.freeze({...binding,consumer:CONSUMER}),
  request_id:d.request_id,
  arguments_sha256,
  root_signature_verified:false,root_consumed_ledger_verified:false
 });
}
function assertCenterConsumption({validated,consumed}={}){
 if(validated?.valid!==true||consumed?.consumed!==true)
  deny('approval_center_consumption_unconfirmed');
 // Center responses are not a substitute for verifying the JWS and durable
 // consumed ledger inside trusted root before touching any owner file.
 return Object.freeze({center_responded_valid:true,
  center_responded_consumed:true,
  independently_authenticated:false,production_mutation:false});
}
if(require.main===module){
 process.stderr.write('source-only native Approval Center contract; no request, decision, consume or apply\n');
 process.exitCode=78;
}
module.exports=Object.freeze({
 TOOL,CONSUMER,ROLLBACK,CREATE_PATH,VALIDATE_PATH,CONSUME_PATH,
 issueEnvelope,verifyIssued,decisionEnvelope,verifyDecision,
 consumeEnvelope,assertCenterConsumption
});
