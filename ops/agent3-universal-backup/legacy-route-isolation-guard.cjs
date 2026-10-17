'use strict';
/**
 * Security boundary for the currently installed Host Actions v1/v2 routes.
 *
 * SOURCE ONLY. The observed Base /v1/host-actions/authorize-consume takes
 * only {action,approval_token} and hashes {action}. It MUST NOT be extended
 * ad hoc to make it a five-field shared action registrar. The new registrar
 * needs its own reviewed route with independent five-field typed schema,
 * persisted request hash, signed Level-4 consume and verified rollback.
 *
 * Pure check. No read, write, network, root calls, signing or installation.
 */
const gateway=require('../../prhm-action-registry-gateway-v1.cjs');
const registration=require('./registration-contract.cjs');
const APPROVAL_ROUTE='/v1/host-actions/authorize-consume';
const LEGACY_KEYS=Object.freeze(['action','approval_token']);
const FIVE_FIELDS=Object.freeze([
 'action','project','source_commit','manifest_commit','manifest_sha256'
]);
function reject(reason){throw Error('agent3_legacy_route_isolation_denied:'+reason);}
function analyzeExcerpt({base,executor,mcp}={}){
 for(const [name,s] of Object.entries({base,executor,mcp}))
  if(typeof s!=='string'||s.length<20||s.length>100000)
   reject('invalid_source_excerpt:'+name);
 const baseRoute=base.includes(APPROVAL_ROUTE);
 const actionOnly=base.includes("['action', 'approval_token'].includes(k)")||
   base.includes('["action", "approval_token"].includes(k)');
 const actionOnlyHash=/argumentsSha256\s*\(\s*\{\s*action\s*:\s*HOST_ACTION_NAME\s*\}\s*\)/.test(base);
 const executorLegacy=executor.includes('hostActionV2Spec(action)')&&
  executor.includes('HOST_ACTION_V2_SPECS');
 const mcpLegacy=mcp.includes("mcp.registerTool('host_action_v2_request'")&&
  mcp.includes("mcp.registerTool('host_action_v2_apply'");
 const observed=baseRoute&&actionOnly&&actionOnlyHash&&executorLegacy&&mcpLegacy;
 if(!observed)reject('unrecognized_or_changed_legacy_contract');
 return Object.freeze({
  schema:'prhm.agent3.legacy-route-isolation.v1',
  route:APPROVAL_ROUTE,
  legacy_allowed_fields:LEGACY_KEYS,
  registry_required_fields:FIVE_FIELDS,
  legacy_approval_digest_scope:'action_only',
  registry_digest_scope:'five_field_canonical',
  registry_action:gateway.ACTION,
  registry_target:registration.INSTALL_ACTION,
  observed_legacy_contract:true,
  legacy_route_usable_for_registry:false,
  legacy_route_can_authorize_registry:false,
  exact_five_field_route_installed:false,
  signed_l4_verified:false,
  production_changed:false,
  required_gate:'DEDICATED_TYPED_REQUEST_PERSIST_CONSUME_APPLY_PLUS_ATOMIC_ROLLBACK'
 });
}
if(require.main===module){
 process.stderr.write('source-only isolation checker; no direct apply or registration\n');
 process.exitCode=78;
}
module.exports=Object.freeze({
 APPROVAL_ROUTE,LEGACY_KEYS,FIVE_FIELDS,analyzeExcerpt
});
