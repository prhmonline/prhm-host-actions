'use strict';
/**
 * Dedicated Agent 3 five-field *route integration contract*.
 *
 * Source-only: this is NOT an HTTP server, approval signer, root bootstrap,
 * producer of trusted root capabilities, or existing live endpoint.
 *
 * To integrate, the reviewed native Executor must:
 *  - persist the actual, server-issued pending request with the exact five
 *    arguments and canonical digest; never derive it from the apply body;
 *  - issue approval through its existing authenticated Approval Center;
 *  - read that persisted record from its own allowlisted request store;
 *  - consume the Ed25519 Level-4 approval in the trusted native mediator;
 *  - hand the *actual signed JWS* and root-owned nine capabilities to
 *    dispatch() (which independently authenticates signature and ledger).
 *
 * The Base legacy action-only approve/consume endpoint is NOT a dependency.
 * A caller cannot select a path, runner, code, service, command or claim.
 */
const continuity=require('./five-field-request-continuity.cjs');
const registration=require('./registration-contract.cjs');
const dispatcher=require('./trusted-shared-registrar-dispatch.cjs');
const gateway=require('../../prhm-action-registry-gateway-v1.cjs');
const bridge=require('../../prhm-action-registry-host-actions-v2-bridge-v1.cjs');

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TOOL='prhm_action_registry_request_v1';
const APPLY_TOOL='prhm_action_registry_apply_v1';
const CRITICAL_CONFIRM='CONFIRM_LEVEL_4_CRITICAL';
const REQUEST_FIELDS=continuity.FIELDS;
const APPLY_FIELDS=Object.freeze(['request_id','second_confirmation',
  'action','project','source_commit','manifest_commit','manifest_sha256']);
function deny(reason){throw Error('agent3_native_route_denied:'+reason);}
function exact(value,keys) {
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join('|')===keys.slice().sort().join('|');
}
function prepareRequest(body){
 if(!exact(body,REQUEST_FIELDS))deny('exact_request_fields_required');
 const binding=continuity.bind(body);
 const proposal=bridge.typedApprovalRequest(body);
 if(proposal.action!==gateway.ACTION||proposal.operation!==gateway.OPERATION||
    proposal.project!=='control_plane'||proposal.environment!=='production'||
    proposal.risk!=='critical'||proposal.ttl_seconds!==180||
    proposal.arguments_sha256!==binding.arguments_sha256)
   deny('approval_proposal_binding_drift');
 return Object.freeze({
  schema:'prhm.agent3.native-enrollment-request.v1',
  route:REQUEST_TOOL,
  arguments:binding.arguments,
  arguments_sha256:binding.arguments_sha256,
  native_approval_proposal:proposal,
  storage_shape:Object.freeze({
    arguments:binding.arguments,
    arguments_sha256:binding.arguments_sha256,
    request_hash:binding.arguments_sha256
  }),
  request_created:false,approval_issued:false,approval_consumed:false,
  production_mutation:false
 });
}
function prepareApply({body,persistedRequest}={}){
 if(!exact(body,APPLY_FIELDS))deny('exact_apply_fields_required');
 if(!UUID.test(body.request_id||''))deny('request_id_invalid');
 if(body.second_confirmation!==CRITICAL_CONFIRM)
   deny('level4_confirmation_required');
 if(!persistedRequest||typeof persistedRequest!=='object'||Array.isArray(persistedRequest)||
    !exact(persistedRequest,['request_id','status','expires_at',
      'arguments','arguments_sha256','request_hash']))
   deny('native_persisted_record_required');
 if(persistedRequest.request_id!==body.request_id||
    persistedRequest.status!=='pending'||
    typeof persistedRequest.expires_at!=='string')
   deny('request_not_pending_or_id_mismatch');
 // Use this process's clock, NEVER a caller-supplied timestamp. The native
 // executor must repeat this check immediately before Approval Center consume.
 const expiry=Date.parse(persistedRequest.expires_at);
 const now=Date.now();
 if(!Number.isFinite(expiry)||expiry<=now||expiry>now+180000)
   deny('native_request_expired_or_excessive_ttl');
 const input=Object.fromEntries(REQUEST_FIELDS.map(k=>[k,body[k]]));
 const binding=continuity.compareApplyBinding({
   persistedRequest:{
     arguments:persistedRequest.arguments,
     arguments_sha256:persistedRequest.arguments_sha256,
     request_hash:persistedRequest.request_hash
   },
   applyArguments:input,
   consumedArgumentsSha256:persistedRequest.arguments_sha256
 });
 return Object.freeze({
  schema:'prhm.agent3.native-enrollment-apply-precheck.v1',
  route:APPLY_TOOL,
  request_id:body.request_id,
  arguments:Object.freeze(input),
  arguments_sha256:binding.arguments_sha256,
  signed_approval_verified:false,consumption_ledger_verified:false,
  ready_to_invoke_root_dispatch:false,production_mutation:false,
  required_native_checks:Object.freeze([
   'READ_NATIVE_PERSISTED_PENDING_RECORD',
   'CHECK_NATIVE_CLOCK_EXPIRY',
   'VERIFY_AND_CONSUME_SIGNED_ONCE_ONLY_LEVEL4_APPROVAL',
   'DISPATCH_WITH_ROOT_CAPABILITIES_AND_FIXED_JOURNAL'
  ])
 });
}
/**
 * Invocation is reserved for a trusted, root-owned native executor AFTER
 * it independently fetched/validated pending status and expiry and handed
 * the real signed token to its Approval Center consume function.
 *
 * This module DOES NOT trust the caller's claim that consumption succeeded:
 * dispatcher ultimately calls the root-only independent Ed25519 JWS and
 * persisted consumed ledger verifier, and then durable root O_EXCL journal.
 */
async function applyFromTrustedNativeExecutor({
  precheck,approvalToken,rootCapabilities
}={}){
 if(!precheck||precheck.schema!=='prhm.agent3.native-enrollment-apply-precheck.v1'||
    precheck.route!==APPLY_TOOL||!UUID.test(precheck.request_id||'')||
    precheck.ready_to_invoke_root_dispatch!==false||
    precheck.signed_approval_verified!==false||
    precheck.production_mutation!==false||
    !exact(precheck.arguments,REQUEST_FIELDS)||
    precheck.arguments_sha256!==gateway.approvalBindingSha(precheck.arguments))
   deny('invalid_native_precheck');
 registration.boundArgs(precheck.arguments);
 if(typeof approvalToken!=='string'||approvalToken.length<120||
    !rootCapabilities||typeof rootCapabilities!=='object'||
    Array.isArray(rootCapabilities))
   deny('trusted_native_approval_and_capabilities_required');
 return dispatcher.dispatch({
  input:precheck.arguments,approvalToken,rootCapabilities
 });
}
if(require.main===module){
 process.stderr.write('no standalone request, approval, root dispatch or apply\n');
 process.exitCode=78;
}
module.exports=Object.freeze({
 REQUEST_TOOL,APPLY_TOOL,CRITICAL_CONFIRM,REQUEST_FIELDS,APPLY_FIELDS,
 prepareRequest,prepareApply,applyFromTrustedNativeExecutor
});
