// Candidate Agent 3 MCP tool. Must be SHA-bound and registered once by existing MCP
// registry during an independently reviewed rollout. No direct node1 network access.
const TOOL='node1_vm_geometry_readonly_v1';
const ROUTE='/node1/vm-geometry/read-only';
const RO=Object.freeze({readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false});
function requireTrue(value,code){if(!value)throw Error(code)}
export function registerNode1VmGeometryReadonlyPlugin(mcp,{agent}={}){
 requireTrue(mcp&&typeof mcp.registerTool==='function','mcp_registration_missing');
 requireTrue(agent&&typeof agent.callAgent==='function','authenticated_agent_bridge_missing');
 return mcp.registerTool(TOOL,{
   title:'Node1 VM Geometry and Guest Agent Read-Only Diagnostics',
   description:'Fixed read-only validation of both known node1 VM disk sizes and Guest Agent status. Zero input; no arbitrary commands, credentials, backup jobs, or host mutations.',
   inputSchema:{},annotations:RO
 },async()=>{
   const response=await agent.callAgent(ROUTE,'POST',{});
   if(!response||typeof response!=='object'||response.schema_version!=='prhm.node1-vm-geometry-readonly.v1'||
     response.readonly!==true||response.production_mutation!==false||
     response.ready_for_deployment!==false)throw Error('node1_geometry_response_invalid');
   return {content:[{type:'text',text:JSON.stringify(response)}]};
 });
}
export {TOOL,ROUTE,RO};
