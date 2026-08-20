import { textResult } from '../core/result.js';

const TOOL='honartik_iticket_v14_preflight_readonly';
const RO={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};

export function registerHonartikIticketPreflightPlugin(mcp,{agent}){
  mcp.registerTool(TOOL,{
    title:'Honartik iTicket V14 Read-Only Preflight',
    description:'Run the fixed zero-input SHA-bound read-only preflight for the Honartik iTicket V14 installer. No install, deploy, database, token, or external network access.',
    inputSchema:{},annotations:RO
  },async()=>textResult(await agent.callAgent('/honartik/iticket/v14/preflight','POST',{})));
}
