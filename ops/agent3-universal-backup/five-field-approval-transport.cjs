'use strict';
/**
 * Exact five-field Approval Center transport frames for the dedicated Agent3
 * registry. SOURCE ONLY. Not a server, issuer, signer, approval consumer,
 * signed-token verifier, runtime installer, or root privilege escalator.
 *
 * These pure functions are the independently reviewed native Base/Executor
 * integration contract. The current action-only /v2/host-actions/* handlers
 * MUST remain unchanged; never use them for this registration.
 *
 * The real Base must use its existing private Approval Center HTTP client
 * and bearer credentials. The real root Executor must persist the issued
 * request in its fixed O_EXCL pending store, confirm against that record,
 * consume once, verify Ed25519 JWS + consumed ledger locally, then dispatch
 * with the independently reviewed fixed root installer / rollback adapters.
 */
const gateway=require('../../prhm-action-registry-gateway-v1.cjs');
const route=require('./five-field-native-route-contract.cjs');
const registration=require('./registration-contract.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST=/^[a-f0-9]{64}$/;
const ROLLBACK='host-action-v2:prhm-action-registry-install-v1:verified-four-owner-restore';
function deny(reason){throw Error('agent3_five_field_transport_denied:'+reason);}
function exact(obj,keys){
 return !!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join('|')===keys.slice().sort().join('|');
}
function pendingRecord(rec){
 if(!exact(rec,['request_id','status','expires_at','arguments','arguments_sha256','request_hash'])||
    !UUID.test(rec.request_id||'')||rec.status!=='pending'||
    !DIGEST.test(rec.arguments_sha256||'')||
    rec.arguments_sha256!==rec.request_hash||
    rec.arguments_sha256!==gateway.approvalBindingSha(rec.arguments))
   deny('persisted_pending_record_invalid');
 const deadline=Date.parse(rec.expires_at);
 if(!Number.isFinite(deadline)||deadline<=Date.now()||
    deadline>Date.now()+180000)deny('pending_record_expired');
 return rec;
}
/** Only the five fields, never a caller-selected tool/path/role/operation. */
function requestFrame(fields){
 const prepared=route.prepareRequest(fields);
 const proposal=prepared.native_approval_proposal;
 if(proposal.rollback_reference!==ROLLBACK||
    proposal.arguments_sha256!==gateway.approvalBindingSha(fields)||
    !exact(proposal,['principal_id','role','tool','project','environment',
      'action','risk','operation','arguments','arguments_sha256',
      'ttl_seconds','rollback_reference']))
   deny('approval_request_frame_invalid');
 return Object.freeze({
  path:'/v1/requests',method:'POST',
  payload:Object.freeze({...proposal})
 });
}
/**
 * Check the real trusted Approval Center response before root persists.
 * Root entrypoint must independently reject fake metadata and use its own
 * canonical record; this is only an extra fail-closed transport check.
 */
function issuedResponse(fields,response){
 const f=requestFrame(fields);
 if(!response||typeof response!=='object'||Array.isArray(response)||
    !response.request||typeof response.request!=='object')
   deny('trusted_request_response_missing');
 const r=response.request,deadline=Date.parse(r.expires_at);
 const now=Date.now();
 if(!UUID.test(r.request_id||'')||r.action!==gateway.ACTION||
    r.arguments_sha256!==f.payload.arguments_sha256||
    Number(r.level)!==4||r.risk!=='critical'||
    !Number.isFinite(deadline)||deadline<=now||deadline>now+180000)
   deny('issued_request_binding_invalid');
 return Object.freeze({
  request_id:r.request_id,expires_at:r.expires_at,
  action:gateway.ACTION,arguments_sha256:f.payload.arguments_sha256,
  level:4,risk:'critical'
 });
}
/** A separate route must accept exactly request_id + confirmation + 5 fields. */
function decisionFrame(body,persistedRequest){
 const record=pendingRecord(persistedRequest);
 const prepared=route.prepareApply({body,persistedRequest:record});
 if(prepared.request_id!==record.request_id||
    prepared.arguments_sha256!==record.arguments_sha256)
  deny('decision_request_mismatch');
 return Object.freeze({
  path:'/v1/requests/'+encodeURIComponent(record.request_id)+'/decision',
  method:'POST',
  payload:Object.freeze({
   decision:'accept',rollback_reference:ROLLBACK,
   second_confirmation:route.CRITICAL_CONFIRM,
   note:'Approved fixed five-field PRHM action registry enrollment'
  }),
  request_id:record.request_id,
  arguments_sha256:record.arguments_sha256
 });
}
/** The decision result is not a substitute for Ed25519 + consumed ledger. */
function decisionResponse(body,persistedRequest,response){
 const frame=decisionFrame(body,persistedRequest);
 if(!response||typeof response!=='object'||Array.isArray(response))
  deny('decision_response_missing');
 const approval=response.approval;
 const token=String(response.approval_token||response.token||approval?.token||'');
 if(!approval||typeof approval!=='object'||Array.isArray(approval)||
    approval.execution_authorized!==true||
    (approval.request_id!==undefined&&approval.request_id!==frame.request_id)||
    (approval.action!==undefined&&approval.action!==gateway.ACTION)||
    (approval.arguments_sha256!==undefined&&
     approval.arguments_sha256!==frame.arguments_sha256)||
    (approval.request_hash!==undefined&&
     approval.request_hash!==frame.arguments_sha256)||
    token.length<120||token.length>16384)
   deny('unbound_decision_or_missing_signed_token');
 // Does not return token via HTTP; trusted Executor-to-Base UNIX transport
 // must keep it entirely server side.
 return Object.freeze({
  request_id:frame.request_id,arguments_sha256:frame.arguments_sha256,
  signed_approval_token:token,execution_authorized_claimed:true,
  signed_receipt_verified:false,consumed:false
 });
}
function consumptionFrame(body,persistedRequest,signedToken){
 const frame=decisionFrame(body,persistedRequest);
 if(typeof signedToken!=='string'||signedToken.length<120||
    signedToken.length>16384)
   deny('signed_approval_token_required');
 const b=registration.boundArgs(Object.fromEntries(
    route.REQUEST_FIELDS.map(key=>[key,body[key]])));
 if(gateway.approvalBindingSha(b)!==frame.arguments_sha256)
   deny('typed_binding_invalid');
 // Never send a token into the public HTTP response or an untrusted MCP input.
 const binding=Object.freeze({
  approval_token:signedToken,
  principal_id:'mohammad',role:'mcp-operator',tool:'host_action_v2_apply',
  project:'control_plane',environment:'production',
  action:gateway.ACTION,risk:'critical',operation:gateway.OPERATION,
  arguments_sha256:frame.arguments_sha256
 });
 return Object.freeze({
  request_id:frame.request_id,
  validation:Object.freeze({path:'/v1/validate',method:'POST',payload:binding}),
  consumption:Object.freeze({
   path:'/v1/consume',method:'POST',
   payload:Object.freeze({...binding,
    consumer:'prhm-agent-selfmaint-exec-host-actions-v2'})
  }),
  signed_receipt_verified:false,ledger_verified:false,
  ready_to_dispatch:false
 });
}
if(require.main===module){
 process.stderr.write('typed transport source only; no HTTP, request, consume or apply CLI\n');
 process.exitCode=78;
}
module.exports=Object.freeze({ROLLBACK,requestFrame,issuedResponse,
 decisionFrame,decisionResponse,consumptionFrame});
