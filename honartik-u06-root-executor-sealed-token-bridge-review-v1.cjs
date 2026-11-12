'use strict';
/**
 * U06 Root-v2 token-context FIXED-SOURCE REVIEW only.
 *
 * Existing Root Executor does call Approval Center authorize-consume, but
 * passes ONLY action into applyHostActionV2. That drops requestId + sealed
 * JWS, preventing the dedicated U06 Root native verifier from independently
 * authenticating Ed25519+consumed ledger. This builds a candidate source
 * patch that forwards the in-memory token ONLY to the exact dedicated U06
 * call AFTER existing consumption; it is never logged or written to disk.
 *
 * No installer, no live handler, no policy mutation, no Root apply.
 */
const crypto=require('node:crypto');
const Preview=require('./honartik-u06-owner-root-routing-preview-v1.cjs');
const ACTION=Preview.ACTION;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const die=x=>{throw Error('u06_root_token_context_review_'+x)};
const once=(s,old,tag)=>{
 if(typeof s!=='string'||s.split(old).length!==2)die('anchor_drift_'+tag);
 return true;
};
const MARK='PRHM_U06_DEDICATED_L4_ROOT_BRIDGE_V1';
const ROUTE="const result=await applyHostActionV2(action);";
const CONSUME="const authz=await callBase('/v2/host-actions/authorize-consume','POST',{action,approval_token:token});";
const CALL="const result=action==='"+ACTION+"'?await runDedicatedU06RootBridge(requestId,token,authz):await applyHostActionV2(action);";
const BRIDGE=[
 '// '+MARK,
 '// Only the exact dedicated U06 path may see the sealed consumed JWS.',
 '// A live Root installer MUST SHA-pin the dedicated handler source before enabling this.',
 'async function runDedicatedU06RootBridge(requestId,sealedToken,consumedReceipt){',
 "  if(!consumedReceipt||consumedReceipt.valid!==true||consumedReceipt.consumed!==true)",
 "    throw new Error('u06_l4_authorize_consume_not_verified');",
 "  if(typeof requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(requestId)||",
 "     typeof sealedToken!=='string'||sealedToken.length<120||sealedToken.length>16384)",
 "    throw new Error('u06_l4_request_or_sealed_token_invalid');",
 "  // DENY until the native source-verified 16-callback handler is installed.",
 "  // This is deliberate. Never replace this guard by a mutable auto-loader.",
 "  throw new Error('u06_full_native_root_handler_not_installed');",
 '}'
].join('\n')+'\n';
function preview(readonlyBuffers){
 const old=Preview.previewExactOwnerSources(readonlyBuffers);
 const p=old.proposed_source_review_only;
 let root=p.root_executor;
 once(root,ROUTE,'existing_apply_call');
 once(root,CONSUME,'authorize_consume');
 once(root,"applyHostActionV2=async function(action){",'dispatch_entry');
 if(root.includes(MARK))die('bridge_already_present');
 if(root.indexOf(CONSUME)>=root.indexOf(ROUTE))die('consumption_order_drift');
 root=root.replace("applyHostActionV2=async function(action){",BRIDGE+"applyHostActionV2=async function(action){");
 root=root.replace(ROUTE,CALL);
 if(!root.includes(Preview.NEW.dispatch))die('deny_only_direct_apply_missing');
 if(root.indexOf(CONSUME)>=root.indexOf(CALL))die('bridge_before_consumption');
 // Live signed L4 policy from separate reviewed Python3.6 candidate remains
 // independently mandatory; Preview itself intentionally leaves policy intact.
 const shas=Object.freeze({
  agent_api:sha(Buffer.from(p.agent_api)),
  root_executor:sha(Buffer.from(root)),
  agent3_mcp:sha(Buffer.from(p.agent3_mcp)),
  approval_policy_unchanged:sha(Buffer.from(p.approval_policy))
 });
 return Object.freeze({
  schema:'prhm.u06.root-native-sealed-token-bridge.readonly.v1',
  action:ACTION,operation:Preview.OPERATION,
  candidate_sha256:shas,
  root_executor_candidate:root,
  agent_api_candidate:p.agent_api,
  agent3_mcp_candidate:p.agent3_mcp,
  existing_approval_center_consume_order_preserved:true,
  u06_sealed_token_only_forwarded_after_consume:true,
  direct_apply_without_trusted_context_denied:true,
  full_native_handler_available:false,
  installation_authorized:false,
  production_mutated:false
 });
}
module.exports=Object.freeze({ACTION,MARK,BRIDGE,ROUTE,CALL,preview,
 SOURCE_ONLY:true,ROOT_INSTALL_ALLOWED:false});
