'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const guard=require('../ops/agent3-universal-backup/legacy-route-isolation-guard.cjs');
function excerpts(){
 return {
  base:[
   "if (req.method === 'POST' && req.url === '/v1/host-actions/authorize-consume') {",
   "const input = await readBody(req);",
   "Object.keys(input).some(k => !['action', 'approval_token'].includes(k))",
   "const argHash = argumentsSha256({ action: HOST_ACTION_NAME });",
   "await approvalBridge('/v1/consume', binding);"
  ].join('\n'),
  executor:[
   "const HOST_ACTION_V2_SPECS = Object.freeze({",
   "function hostActionV2Spec(action){const s=HOST_ACTION_V2_SPECS[String(action||'')];",
   "async function applyHostActionV2(action){const spec=hostActionV2Spec(action);"
  ].join('\n'),
  mcp:[
   "mcp.registerTool('host_action_v2_request',{title:'Request Fixed Host Action v2 Approval',",
   "mcp.registerTool('host_action_v2_apply',{title:'Apply Approved Fixed Host Action v2 Stage',"
  ].join('\n')
 };
}
test('current legacy action-only route cannot be relabeled as signed five-field registrar',()=>{
 const result=guard.analyzeExcerpt(excerpts());
 assert.equal(result.observed_legacy_contract,true);
 assert.equal(result.legacy_approval_digest_scope,'action_only');
 assert.equal(result.registry_digest_scope,'five_field_canonical');
 assert.deepEqual(result.legacy_allowed_fields,['action','approval_token']);
 assert.deepEqual(result.registry_required_fields,
  ['action','project','source_commit','manifest_commit','manifest_sha256']);
 for(const forbidden of [
   'legacy_route_usable_for_registry','legacy_route_can_authorize_registry',
   'exact_five_field_route_installed','signed_l4_verified','production_changed'
 ])assert.equal(result[forbidden],false,forbidden);
});
test('safe refusal on changed, ambiguous or incomplete live anchors',()=>{
 const inputs=excerpts();
 for(const [k,fragment] of [
  ['base',"/v1/host-actions/authorize-consume"],
  ['base',"['action', 'approval_token'].includes(k)"],
  ['base','argumentsSha256({ action: HOST_ACTION_NAME })'],
  ['executor','hostActionV2Spec(action)'],
  ['mcp',"mcp.registerTool('host_action_v2_apply'"]
 ]){
  const changed={...inputs,[k]:inputs[k].replace(fragment,'XXXX')};
  assert.throws(()=>guard.analyzeExcerpt(changed),
   /unrecognized_or_changed_legacy_contract/);
 }
 assert.throws(()=>guard.analyzeExcerpt({...inputs,base:'short'}),
  /invalid_source_excerpt/);
});
test('guard has no direct CLI, approval, install or Production side effects',()=>{
 const file=path.join(__dirname,'../ops/agent3-universal-backup/legacy-route-isolation-guard.cjs');
 const out=cp.spawnSync(process.execPath,[file,'--apply'],{
  encoding:'utf8',timeout:10000
 });
 assert.equal(out.status,78);
 assert.match(out.stderr,/no direct apply or registration/);
 assert.equal(typeof guard.install,'undefined');
 assert.equal(typeof guard.consumeApproval,'undefined');
});
