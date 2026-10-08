'use strict';
// Reviewed release plan only. This module cannot install, register, or execute tools.
// Source commit is fixed; any code drift requires a new review and commit binding.
const SOURCE_COMMIT='8b2b7077d760bc0aaccf21f8ce503903bb19ff61';
const TOOL='node1_vm_geometry_readonly_v1';
const ROUTE='/node1/vm-geometry/read-only';
const FILES=Object.freeze([
  {
    "path": "node1-live-vm-backup-v1.js",
    "sha": "3757f5d82886055435c4818d126d84c7c4d9dc26"
  },
  {
    "path": "node1-vm-geometry-readonly-v1.js",
    "sha": "1fe2518fd4dcc320815e46375d5f8ec4c3c69fce"
  },
  {
    "path": "node1-vm-geometry-runner-v1.js",
    "sha": "b0e96415aa6faa571a106fe75c678cfb3008fa88"
  },
  {
    "path": "node1-vm-geometry-agent-api-route-v1.js",
    "sha": "24f061abaa6412f971db10e31f096f52c8b3d8ee"
  },
  {
    "path": "node1-vm-geometry-mcp-plugin-v1.mjs",
    "sha": "7d1f57de4a81d8d4044c17cab15fddef12ffffcd"
  }
].map(x=>Object.freeze(x)));

const TARGETS=Object.freeze({
  node1Root:'/opt/prhm-node1-readonly/vm-geometry-v1',
  apiRoute:'/home/agent/ssh-agent-api/node1VmGeometryReadonlyRoutes.js',
  mcpPlugin:'/home/agent/ssh-mcp-server/src/plugins/node1VmGeometryReadonly.mjs',
  agentApiService:'prhm-agent-api.service',
  agentMcpService:'prhm-agent-mcp.service'
});
function plan(){
 return Object.freeze({
  schema_version:'prhm.node1-readonly-registration-plan.v1',
  source_repo:'prhmonline/prhm-host-actions',
  source_commit:SOURCE_COMMIT,
  files:FILES,
  tool:TOOL,route:ROUTE,targets:TARGETS,
  zero_input:true,read_only:true,production_mutation:false,
  host:'server1.prhm.ir',
  agent:'PRHM Agent 3 Primary',
  registered:false,installed:false,
  request_created:false,deploy_approved:false,
  required_change_approval:'CONFIRM_LEVEL_4_CRITICAL',
  fixed_node1_transport_required:true,
  sha_pinned_agent_api_and_mcp_baselines_required:true,
  node1_fixed_command_executor_registration_required:true,
  rollback_plan_required:true,
  live_probe_run:false,
  ready_for_deployment:false
 });
}
function verifyStagedBlobs(staged){
 if(!staged||typeof staged!=='object'||Array.isArray(staged))throw Error('staged_artifacts_invalid');
 if(Object.keys(staged).length!==FILES.length)throw Error('staged_file_count_mismatch');
 for(const f of FILES){
  if(typeof staged[f.path]!=='string'||staged[f.path]!==f.sha)throw Error('staged_blob_mismatch:'+f.path);
 }
 return Object.freeze({exact_blobs_match:true,ready_for_production:false,level4_required:true});
}
module.exports={SOURCE_COMMIT,TOOL,ROUTE,FILES,TARGETS,plan,verifyStagedBlobs};
if(require.main===module)process.stdout.write(JSON.stringify(plan())+'\n');
