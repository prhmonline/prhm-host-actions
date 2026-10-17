'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const cp=require('node:child_process');
const path=require('node:path');
const crypto=require('node:crypto');
const gateway=require('../prhm-action-registry-gateway-v1.cjs');
const registration=require('../ops/agent3-universal-backup/registration-contract.cjs');
const filename=path.join(__dirname,'../ops/agent3-universal-backup/native-five-field-mcp-policy-patch.cjs');
const code=fs.readFileSync(filename,'utf8');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const mcpSource=[
 "import { z } from 'zod';",
 "const REQUEST={readOnlyHint:false};",
 "const APPLY={destructiveHint:true};",
 "const callExec=async()=>({ok:true});",
 "const textResult=x=>x;",
 "export function registerHostActionsV2Plugin(mcp,{agent}={}){",
 "  mcp.registerTool('host_action_v2_request',{inputSchema:{action:z.string()},annotations:REQUEST},async args=>textResult(await callExec('/v2/host-actions/request','POST',args)));",
 "  mcp.registerTool('host_action_v2_apply',{inputSchema:{request_id:z.string()},annotations:APPLY},async args=>textResult(await callExec('/v2/host-actions/execute','POST',args)));",
 "}"
].join('\n')+'\n';
const originalPolicy=JSON.stringify({
 operations:{'host_action.legacy':{level:3}},
 typed_scopes:[{tool:'host_action_v2_apply',project:'control_plane',
  action:'legacy',risk:'high',operation:'host_action.legacy'}]
},null,2)+'\n';
function fixture({mcp=mcpSource,policy=originalPolicy}={}){
 const b={mcp:Buffer.from(mcp),policy:Buffer.from(policy)};
 const module={exports:{}};
 const requireStub=id=>{
  if(id==='node:crypto')return require('node:crypto');
  if(id==='node:vm')return require('node:vm');
  if(id==='node:child_process')return require('node:child_process');
  if(id==='./production-registration-contract.json')
   return {preimage_sha256:{mcp:sha(b.mcp),policy:sha(b.policy)}};
  if(id==='./registration-contract.cjs')return registration;
  if(id==='../../prhm-action-registry-gateway-v1.cjs')return gateway;
  throw Error('unapproved_module_import:'+id);
 };
 const factory=vm.runInNewContext(
  '(function(require,module,exports,process,Buffer){'+code+'\n})',
  {console,Buffer}, {filename,timeout:7000});
 factory(requireStub,module,module.exports,process,Buffer);
 return {api:module.exports,bytes:b};
}
test('exact SHA-bound MPC/Policy candidate registers two independent five-field tools, preserves all legacy tools',()=>{
 const {api,bytes}=fixture();
 const out=api.propose(bytes);
 assert.equal(out.action,gateway.ACTION);
 assert.equal(out.target_action,registration.INSTALL_ACTION);
 assert.equal(out.production_mutation,false);
 assert.equal(out.git_manifest_ready,false);
 assert.equal(out.ready_for_registration,false);
 assert.equal(out.base_executor_routes_installed,false);
 assert.equal(out.signed_approval_consumed,false);
 const mcp=out.postimage_buffers.mcp.toString();
 assert.equal(mcp.includes("mcp.registerTool('host_action_v2_request'"),true);
 assert.equal(mcp.includes("mcp.registerTool('host_action_v2_apply'"),true);
 assert.equal(mcp.includes("mcp.registerTool('prhm_action_registry_request_v1'"),true);
 assert.equal(mcp.includes("mcp.registerTool('prhm_action_registry_apply_v1'"),true);
 assert.equal(mcp.includes("callExec('/v3/agent3-registry/request','POST',args)"),true);
 assert.equal(mcp.includes("callExec('/v3/agent3-registry/execute','POST',args,1200000)"),true);
 assert.equal(mcp.includes("source_commit:z.literal('"+registration.SOURCE_COMMIT+"')"),true);
 assert.equal(mcp.includes("action:z.literal('"+gateway.ACTION+"')"),true);
 assert.equal(mcp.includes("project:z.literal('agent3')"),true);
 assert.equal(mcp.includes("second_confirmation:z.literal('CONFIRM_LEVEL_4_CRITICAL')"),true);
 assert.equal(mcp.includes("manifest_commit:z.string().regex(/^[0-9a-f]{40}$/)"),true);
 assert.equal(mcp.includes("manifest_sha256:z.string().regex(/^[0-9a-f]{64}$/)"),true);
 assert.equal(mcp.match(/mcp\.registerTool\('/g).length,4);
 const policy=JSON.parse(out.postimage_buffers.policy.toString());
 assert.deepEqual(policy.operations['host_action.legacy'],{level:3});
 assert.deepEqual(policy.operations[gateway.OPERATION],{level:4,risk:'critical'});
 const scope=policy.typed_scopes.find(t=>t.action===gateway.ACTION);
 assert.equal(scope.tool,'host_action_v2_apply');
 assert.equal(scope.project,'control_plane');
 assert.equal(scope.risk,'critical');
 assert.equal(scope.operation,gateway.OPERATION);
 assert.equal(out.after_sha256.mcp,sha(out.postimage_buffers.mcp));
 assert.equal(out.after_sha256.policy,sha(out.postimage_buffers.policy));
 assert.notEqual(out.before_sha256.mcp,out.after_sha256.mcp);
 assert.notEqual(out.before_sha256.policy,out.after_sha256.policy);
});
test('pinned source change, duplicate insertion, missing legacy tool and bad JS syntax all reject',()=>{
 const {api,bytes}=fixture();
 assert.throws(()=>api.mcpCandidate(Buffer.from(mcpSource+'changed')),
  /untrusted_preimage/);
 const candidates=[
  mcpSource.replace("export function registerHostActionsV2Plugin(mcp,{agent}={}){",
    'export function changed(mcp,{agent}={}){'),
  mcpSource.replace("mcp.registerTool('host_action_v2_apply'",
    "mcp.registerTool('old_apply'"),
  mcpSource.replace("mcp.registerTool('host_action_v2_request'",
    "mcp.registerTool('old_request'"),
  mcpSource+"\nexport function registerHostActionsV2Plugin(mcp,{agent}={}){}",
  mcpSource.replace("const REQUEST={readOnlyHint:false};",'const REQUEST = ;')
 ];
 for(const mcp of candidates){
  const f=fixture({mcp});
  assert.throws(()=>f.api.mcpCandidate(f.bytes.mcp));
 }
 const tampered=fixture({policy:'this is deliberately malformed json '.repeat(8)});
 assert.throws(()=>tampered.api.policyCandidate(tampered.bytes.policy),
  /policy_not_json/);
});
test('duplicate registry policy entry cannot be silently overwritten',()=>{
 for(const p of [
  {...JSON.parse(originalPolicy),operations:{
   'host_action.legacy':{level:3},[gateway.OPERATION]:{level:2}}},
  {...JSON.parse(originalPolicy),typed_scopes:[
   {action:gateway.ACTION,operation:'arbitrary'}]}
 ]){
  const f=fixture({policy:JSON.stringify(p)});
  assert.throws(()=>f.api.policyCandidate(f.bytes.policy),/already_registered/);
 }
});
test('source-only patch has no arbitrary file paths, apply command, credential or standalone production mutation',()=>{
 const result=cp.spawnSync(process.execPath,[filename,'--apply'],
  {encoding:'utf8',timeout:10000});
 assert.equal(result.status,78);
 assert.match(result.stderr,/review-only pinned MCP\/Policy postimage generator/);
 const {api}=fixture();
 for(const method of ['install','writeProduction','approve','consumeApproval','setRootPath'])
  assert.equal(typeof api[method],'undefined');
});
