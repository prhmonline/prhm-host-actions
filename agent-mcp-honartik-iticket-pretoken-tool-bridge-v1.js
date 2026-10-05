import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE_SHA='34e95fcd1d79e2058d3abcb48e9fb5ef189934fa464a6085dd575e9c92935264';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const BASE=path.join(HERE,`.project-honartik-iticket-pretoken-tool-base-${BASE_SHA}.mjs`);
const BACK='/var/backups/prhm-agent-selfmaint';
const TOOL='honartik_iticket_pretoken_git_sync_v1';
const INNER='{"operation":"honartik_iticket_pretoken_git_sync_v1","confirmation":"CONFIRM_LEVEL_3_PRODUCTION"}';
const H=b=>createHash('sha256').update(b).digest('hex');
const F=x=>{throw new Error(x)};

function ensureBase(){
  try{if(H(fs.readFileSync(BASE))===BASE_SHA)return}catch{}
  const suffix='-'+BASE_SHA+'.bak';
  const name=fs.readdirSync(BACK).filter(x=>x.startsWith('agent_mcp-src_plugins_project.js-')&&x.endsWith(suffix)).sort().reverse()[0];
  if(!name)F('iticket_tool_bridge_base_backup_missing');
  const bytes=fs.readFileSync(path.join(BACK,name));
  if(H(bytes)!==BASE_SHA)F('iticket_tool_bridge_base_sha_mismatch');
  const tmp=BASE+'.'+process.pid+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,BASE);
  fs.chmodSync(BASE,0o600);
}
ensureBase();
const old=await import(pathToFileURL(BASE).href+'?sha='+BASE_SHA);
if(typeof old.registerProjectPlugin!=='function')F('iticket_tool_bridge_base_export_missing');

export function registerProjectPlugin(mcp,context){
  let opsHandler=null;
  const proxy=new Proxy(mcp,{
    get(target,property,receiver){
      if(property==='registerTool')return(name,config,handler,...rest)=>{if(name==='ops_execute')opsHandler=handler;return target.registerTool(name,config,handler,...rest)};
      if(property==='tool')return(name,description,schema,handler,...rest)=>{if(name==='ops_execute')opsHandler=handler;return target.tool(name,description,schema,handler,...rest)};
      const value=Reflect.get(target,property,receiver);
      return typeof value==='function'?value.bind(target):value;
    }
  });
  const result=old.registerProjectPlugin(proxy,context);
  if(typeof opsHandler!=='function')F('iticket_tool_bridge_ops_handler_not_registered');
  mcp.tool(TOOL,'Fixed zero-input Honartik iTicket pre-token canonical Git synchronization. Reuses the installed SHA-bound engine; no arbitrary command, path, token, database, external network or production deploy input.',{},async()=>opsHandler({project:'honartik_admin_prod',command:INNER,reason:'Execute fixed Honartik iTicket pre-token canonical Git synchronization.',access:'write',risk:'high',acknowledgeRisk:true,timeoutMs:300000}));
  return result;
}
