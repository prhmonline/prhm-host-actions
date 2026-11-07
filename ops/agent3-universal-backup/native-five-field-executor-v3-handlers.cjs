'use strict';
/**
 * Agent 3 native Executor v3 registrar wiring candidate (SOURCE ONLY).
 *
 * This module must be imported exclusively by a separately reviewed,
 * root-owned Executor with an authenticated fixed Base transport and trusted
 * root capabilities. It does NOT start a server, load credentials, issue
 * approvals independently, write owner files or install/register itself.
 *
 * Request: Base issues -> Executor checks exact issuer identity -> root O_EXCL
 *          immutable pending request is persisted before caller sees its ID.
 * Execute: root rereads pending -> Base decides/consumes once -> Executor
 *          checks receipt binding -> root verifies Ed25519 JWS AND consumed
 *          ledger, claims execution once and runs SHA-pinned rollback installer.
 *
 * Base's consumed:true / valid:true flags confer NO executor authority.
 */
const base=require('./native-five-field-base-v3-postimage.cjs');
const approval=require('./native-v3-signed-approval-protocol.cjs');
const route=require('./five-field-native-route-contract.cjs');
const root=require('./native-root-request-entrypoints.cjs');

const REQUEST_PATH='/v3/agent3-registry/request';
const EXECUTE_PATH='/v3/agent3-registry/execute';
const RESPONSE_KEYS=Object.freeze(['ok','request','arguments_sha256']);
const CONSUME_KEYS=Object.freeze(['ok','request_id','arguments_sha256',
 'approval_token','consumed_by_approval_center','root_jws_verified']);
const TOKEN=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
function deny(message){throw Error('agent3_native_executor_v3_denied:'+message);}
function exact(o,fields){
 return !!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===fields.slice().sort().join('|');
}
function onlyRoot(){
 if(typeof process.getuid!=='function'||process.getuid()!==0)
  deny('trusted_root_executor_required');
}
function assertIssueResponse({input,response,nowMs=Date.now()}={}){
 const offer=route.prepareRequest(input);
 if(!exact(response,RESPONSE_KEYS)||response.ok!==true||
    !exact(response.request,root.ISSUED_FIELDS)||
    response.arguments_sha256!==offer.arguments_sha256)
  deny('base_issued_receipt_schema_or_hash');
 const checked=approval.verifyIssued({
  args:input,response,nowMs
 });
 return Object.freeze({
  request_id:checked.request_id,expires_at:checked.expires_at,
  action:checked.action,arguments_sha256:checked.arguments_sha256,
  level:checked.level,risk:checked.risk
 });
}
function assertConsumedResponse({precheck,response}={}){
 if(!precheck||
    precheck.schema!=='prhm.agent3.native-enrollment-apply-precheck.v1'||
    precheck.ready_to_invoke_root_dispatch!==false||
    precheck.signed_approval_verified!==false||
    !exact(response,CONSUME_KEYS)||
    response.ok!==true||
    response.request_id!==precheck.request_id||
    response.arguments_sha256!==precheck.arguments_sha256||
    response.consumed_by_approval_center!==true||
    response.root_jws_verified!==false||
    typeof response.approval_token!=='string'||
    response.approval_token.length<120||
    response.approval_token.length>16384||
    !TOKEN.test(response.approval_token))
  deny('base_consumed_receipt_untrusted_or_unbound');
 // Shape only. Trust comes EXCLUSIVELY from the already-owned root verifier
 // in native-root-request-entrypoints -> shared registrar bridge.
 return Object.freeze({
  token:response.approval_token,
  verified_by_root:false,
  ledger_verified_by_root:false
 });
}
/**
 * The caller must be the installed root-owned Executor, not an MCP handler.
 * basePost is a trusted server-constructed client to the two fixed Base v3
 * endpoints; rootCapabilities are fixed native functions (not request data).
 * These are injected ONCE at root server initialization, never from JSON.
 */
function bindTrustedExecutor({basePost,rootCapabilities}={}){
 onlyRoot();
 if(typeof basePost!=='function'||!rootCapabilities||
    typeof rootCapabilities!=='object'||Array.isArray(rootCapabilities))
  deny('fixed_native_bindings_required');
 const caps=rootCapabilities;
 const post=basePost;
 let inflight=false;
 async function request(untrustedBody){
  onlyRoot();
  const prepared=route.prepareRequest(untrustedBody);
  const input=Object.freeze({...prepared.arguments});
  // Base response is not authority: check issuer binding and persist in
  // root-only O_EXCL store BEFORE returning the request ID to the caller.
  const response=await post(base.REQUEST,input);
  const issued=assertIssueResponse({input,response});
  const stored=root.persistIssuedNativeRequest({input,issued});
  if(stored.request_id!==issued.request_id||stored.durable!==true||
     stored.exclusive!==true||stored.arguments_sha256!==issued.arguments_sha256)
   deny('root_pending_persistence_not_durable');
  return Object.freeze({
   request_id:issued.request_id,expires_at:issued.expires_at,
   arguments_sha256:issued.arguments_sha256,
   level:4,risk:'critical',approved:false,installed:false
  });
 }
 async function execute(untrustedBody){
  onlyRoot();
  // The native root precheck loads persisted data by immutable request UUID.
  // Never accept a caller-supplied pending record, approval token or path.
  const body=Object.freeze({...untrustedBody});
  const precheck=root.prepareApplyFromFixedRootStore(body);
  if(inflight)deny('same_process_execution_inflight');
  inflight=true;
  try{
   const result=await post(base.CONFIRM,body);
   const receipt=assertConsumedResponse({precheck,response:result});
   // Cannot treat the Base receipt as approval. The root dispatcher rejects
   // invalid Ed25519 JWS, mismatched/absent consumed ledger, stale request,
   // non-durable claim and unverified source/preimage/rollback.
   return await root.applyFromFixedRootStore({
    body,signedApprovalToken:receipt.token,rootCapabilities:caps
   });
  }finally{inflight=false;}
 }
 return Object.freeze({request,execute});
}
if(require.main===module){
 process.stderr.write('No standalone Executor v3 bootstrap or deploy path.\n');
 process.exitCode=78;
}
module.exports=Object.freeze({
 REQUEST_PATH,EXECUTE_PATH,assertIssueResponse,
 assertConsumedResponse,bindTrustedExecutor
});
