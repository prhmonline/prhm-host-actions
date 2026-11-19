'use strict';
/**
 * Root-only native Agent3 registry request/execute entrypoints.
 *
 * Production integration must call this module only from a separately
 * reviewed/authenticated root executor. It never exposes a network listener,
 * creates an Approval Center request, issues a token, consumes an approval,
 * registers a Host Action, installs files or performs bootstrap itself.
 *
 * The exact pending record MUST be fetched from the fixed immutable on-disk
 * O_EXCL request store. Never accept a record/precheck/clock from a client
 * or a plug-in. The root dispatcher separately verifies actual Ed25519 JWS
 * + consumed ledger + same request ID, then durable O_EXCL execution claim.
 */
const gateway=require('../../prhm-action-registry-gateway-v1.cjs');
const native=require('./five-field-native-route-contract.cjs');
const store=require('./root-five-field-pending-store.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
const ISSUED_FIELDS=Object.freeze(['request_id','expires_at','action',
 'arguments_sha256','level','risk']);
function deny(reason){throw Error('agent3_native_root_entry_denied:'+reason);}
function exact(x,keys){return !!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===keys.slice().sort().join('|');}
function requireRoot(){if(process.getuid?.()!==0)deny('root_required');}
/**
 * Call only after the authenticated native issuer returns the real issued
 * request identity. This verifies the issued metadata shape, not the
 * provenance of the issuer. The native approval-service client MUST be
 * trusted, not replaced with a caller-provided object.
 */
function persistIssuedNativeRequest({input,issued}={}){
 requireRoot();
 const prepared=native.prepareRequest(input);
 if(!exact(issued,ISSUED_FIELDS)||!UUID.test(issued.request_id||'')||
    issued.action!==gateway.ACTION||issued.arguments_sha256!==prepared.arguments_sha256||
    issued.level!==4||issued.risk!=='critical'||
    typeof issued.expires_at!=='string')deny('untrusted_issuer_metadata');
 // A real pending request only; this is not an approval or signed receipt.
 return store.storeNativePending({
  requestId:issued.request_id,
  expiresAt:issued.expires_at,
  arguments:prepared.arguments
 });
}
/**
 * The body contains only request ID, Level-4 confirmation and exact five
 * fields. NEVER accept client-provided persisted record, precheck, token,
 * approval status or filesystem path.
 */
function prepareApplyFromFixedRootStore(body){
 requireRoot();
 if(!exact(body,native.APPLY_FIELDS))deny('untrusted_native_apply_body');
 if(!UUID.test(body.request_id||''))deny('native_request_id');
 const persisted=store.loadNativePending(body.request_id);
 return native.prepareApply({body,persistedRequest:persisted});
}
/**
 * Signed JWS is delivered by the trusted native Approval Center consume
 * callback after independently verifying the request. No caller-supplied
 * approval flag can satisfy the root dispatcher.
 */
async function applyFromFixedRootStore({
 body,signedApprovalToken,rootCapabilities
}={}){
 const precheck=prepareApplyFromFixedRootStore(body);
 if(typeof signedApprovalToken!=='string'||
    signedApprovalToken.length<120||signedApprovalToken.length>16384||
    !rootCapabilities||typeof rootCapabilities!=='object'||
    Array.isArray(rootCapabilities))
   deny('signed_trusted_consume_result_required');
 return native.applyFromTrustedNativeExecutor({
  precheck,approvalToken:signedApprovalToken,rootCapabilities
 });
}
if(require.main===module){
 process.stderr.write('no CLI, no implicit approval, no registrar bootstrap\n');
 process.exitCode=78;
}
module.exports=Object.freeze({
 ISSUED_FIELDS,persistIssuedNativeRequest,
 prepareApplyFromFixedRootStore,applyFromFixedRootStore
});
