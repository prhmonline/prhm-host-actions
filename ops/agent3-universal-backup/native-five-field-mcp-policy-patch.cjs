'use strict';
/**
 * Initial *real source transform* for Agent 3 five-field shared registrar.
 * Generates review-only candidate for exact live MCP and Approval Policy.
 * Preserves ALL existing legacy action-only tools. The missing trusted
 * Base+Executor v3 route and root signed dispatcher must be reviewed before
 * this can be used as a Production postimage. No CLI apply, no file writes.
 */
const crypto=require('node:crypto');
const vm=require('node:vm');
const cp=require('node:child_process');
const pins=require('./production-registration-contract.json');
const registration=require('./registration-contract.cjs');
const gateway=require('../../prhm-action-registry-gateway-v1.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const MCP_ANCHOR='export function registerHostActionsV2Plugin(mcp,{agent}={}){';
const SRC=registration.SOURCE_COMMIT;
const REQUEST='/v3/agent3-registry/request';
const APPLY='/v3/agent3-registry/execute';
function deny(reason){throw Error('agent3_mcp_policy_patch_denied:'+reason);}
function precise(source,anchor,replacement){
 if(source.split(anchor).length!==2)deny('source_anchor_missing_or_ambiguous');
 return source.replace(anchor,replacement);
}
function checkedText(value,expected,name){
 if(!Buffer.isBuffer(value)||value.length<100||value.length>2*1024*1024||
    sha(value)!==expected)deny('untrusted_preimage:'+name);
 const source=value.toString('utf8');
 if(!Buffer.from(source).equals(value))deny('noncanonical_utf8:'+name);
 return source;
}
function mcpCandidate(source){
 const text=checkedText(source,pins.preimage_sha256.mcp,'mcp');
 // New tools are distinct from the legacy HostActionV2 enum. They are
 // constrained at their schema boundary and also by the native root store.
 const argumentsSchema=[
  "action:z.literal('"+gateway.ACTION+"')",
  "project:z.literal('"+registration.PROJECT+"')",
  "source_commit:z.literal('"+SRC+"')",
  "manifest_commit:z.string().regex(/^[0-9a-f]{40}$/)",
  "manifest_sha256:z.string().regex(/^[0-9a-f]{64}$/)"
 ].join(',');
 const addition=[
  "  // Dedicated signed Level-4 five-field registrar; never use legacy action-only routes.",
  "  mcp.registerTool('prhm_action_registry_request_v1',{",
  "    title:'Request Agent 3 Shared Registry Enrollment',",
  "    description:'Create a typed fixed-source Level-4 shared registry request. Never register arbitrary action, code, command or path.',",
  "    inputSchema:{"+argumentsSchema+"},annotations:REQUEST",
  "  },async args=>textResult(await callExec('"+REQUEST+"','POST',args)));",
  "  mcp.registerTool('prhm_action_registry_apply_v1',{",
  "    title:'Apply Approved Agent 3 Shared Registry Enrollment',",
  "    description:'Execute only a persisted, signed, ledger-consumed Level-4 registry request with exact five-field SHA binding.',",
  "    inputSchema:{request_id:z.string().uuid(),second_confirmation:z.literal('CONFIRM_LEVEL_4_CRITICAL'),"+argumentsSchema+"},annotations:APPLY",
  "  },async args=>textResult(await callExec('"+APPLY+"','POST',args,1200000)));",
  ""
 ].join('\n');
 const updated=precise(text,MCP_ANCHOR,MCP_ANCHOR+'\n'+addition);
 if(updated.includes('mcp.registerTool(\'host_action_v2_request\'')!==true||
    updated.includes('mcp.registerTool(\'host_action_v2_apply\'')!==true)
  deny('legacy_tools_must_survive');
 const result=cp.spawnSync(process.execPath,['--check','--input-type=module'],{
  input:Buffer.from(updated),encoding:'utf8',timeout:15000,maxBuffer:65536,
  shell:false
 });
 if(result.status!==0||result.error||result.signal)deny('candidate_mcp_syntax_invalid');
 return Buffer.from(updated);
}
function policyCandidate(bytes){
 const source=checkedText(bytes,pins.preimage_sha256.policy,'policy');
 let policy;
 try{policy=JSON.parse(source);}catch{deny('policy_not_json');}
 if(!policy||typeof policy!=='object'||Array.isArray(policy)||
    !policy.operations||typeof policy.operations!=='object'||
    !Array.isArray(policy.typed_scopes)||
    typeof policy.policy_version!=='string'||policy.policy_version.length<8)
  deny('policy_contract_missing');
 if(Object.hasOwn(policy.operations,gateway.OPERATION)||
   policy.typed_scopes.some(r=>r?.operation===gateway.OPERATION||
     r?.action===gateway.ACTION))
   deny('already_registered');
 // The root verifier pins the signed JWS policy_version exactly.
 // Without this explicit revision, an otherwise correctly signed Level-4
 // approval will be rejected after consumption.
 policy.policy_version=gateway.POLICY_VERSION;
 policy.operations[gateway.OPERATION]={level:4,risk:'critical'};
 // The independent Ed25519 JWS verifier is pinned to this exact tool,
 // project and consumer. Do not silently change these without reviewing
 // the trusted signature verifier and existing Approval Center policy.
 policy.typed_scopes.push({
  tool:'host_action_v2_apply',project:'control_plane',
  environment:'production',action:gateway.ACTION,risk:'critical',
  operation:gateway.OPERATION,
  principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
 });
 const after=JSON.stringify(policy,null,2)+'\n';
 if(JSON.parse(after).operations[gateway.OPERATION].level!==4)
  deny('level4_policy_not_bound');
 return Buffer.from(after);
}
function propose({mcp,policy}={}){
 const outputs={mcp:mcpCandidate(mcp),policy:policyCandidate(policy)};
 return Object.freeze({
  schema:'prhm.agent3.mcp-policy-five-field-postimage-proposal.v1',
  action:gateway.ACTION,
  target_action:registration.INSTALL_ACTION,
  trusted_native_endpoints:Object.freeze({request:REQUEST,execute:APPLY}),
  before_sha256:Object.freeze({mcp:pins.preimage_sha256.mcp,
    policy:pins.preimage_sha256.policy}),
  after_sha256:Object.freeze({mcp:sha(outputs.mcp),policy:sha(outputs.policy)}),
  postimage_buffers:Object.freeze(outputs),
  old_action_only_tools_preserved:true,
  base_executor_routes_installed:false,
  signed_approval_consumed:false,
  git_manifest_ready:false,
  production_mutation:false,
  ready_for_registration:false
 });
}
if(require.main===module){
 process.stderr.write('review-only pinned MCP/Policy postimage generator; no deploy, approval or file writes\n');
 process.exitCode=78;
}
module.exports=Object.freeze({MCP_ANCHOR,REQUEST,APPLY,mcpCandidate,policyCandidate,propose});
