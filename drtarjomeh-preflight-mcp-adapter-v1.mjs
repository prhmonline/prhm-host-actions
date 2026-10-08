// Fixed zero-input MCP adapter for the reviewed DrTarjomeh security audit.
const TOOL='drtarjomeh_current_release_preflight_readonly_v1';
const ROUTE='/drtarjomeh/security/current-release/preflight';
const RO=Object.freeze({readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false});

export function registerDrtarjomehCurrentReleasePreflight(mcp,{agent}){
  if(!mcp||typeof mcp.registerTool!=='function'||!agent||typeof agent.callAgent!=='function')
    throw new Error('drtarjomeh_preflight_agent_invalid');
  mcp.registerTool(TOOL,{
    title:'DrTarjomeh Current Release Read-Only Security Preflight',
    description:'Fixed zero-input, audit-only 24-file SHA/status and protected-env metadata check for the Oct-06 DrTarjomeh release. No credentials, arbitrary paths, shell, file writes, deployment or rollback operations.',
    inputSchema:{},
    annotations:RO
  },async()=>{
    const r=await agent.callAgent(ROUTE,'POST',{});
    if(!r||r.audit_only!==true||r.production_mutation!==false||r.cutover_authorized!==false||
        typeof r.gate!=='string'||!r.gate.startsWith('BLOCKED'))
      throw new Error('drtarjomeh_preflight_result_contract_invalid');
    return {content:[{type:'text',text:JSON.stringify(r)}]};
  });
}
export {TOOL,ROUTE};
