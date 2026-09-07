import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE_SHA='507815d1dd14960e233f8a0888f3ea1f038fdffa3b77f1e4b5a07e62c3b168c7';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const BASE=path.join(HERE,`.project-honartik-iticket-pretoken-run-base-${BASE_SHA}.mjs`);
const BACK='/var/backups/prhm-agent-selfmaint';
const COMMAND='HONARTIK_ITICKET_PRETOKEN_GIT_SYNC_V1:CONFIRM_LEVEL_3_PRODUCTION';
const INNER='{"operation":"honartik_iticket_pretoken_git_sync_v1","confirmation":"CONFIRM_LEVEL_3_PRODUCTION"}';
const H=b=>createHash('sha256').update(b).digest('hex');
const F=x=>{throw new Error(x)};

function ensureBase(){
  try{if(H(fs.readFileSync(BASE))===BASE_SHA)return}catch{}
  const suffix='-'+BASE_SHA+'.bak';
  const name=fs.readdirSync(BACK).filter(x=>x.startsWith('agent_mcp-src_plugins_project.js-')&&x.endsWith(suffix)).sort().reverse()[0];
  if(!name)F('iticket_run_bridge_base_backup_missing');
  const bytes=fs.readFileSync(path.join(BACK,name));
  if(H(bytes)!==BASE_SHA)F('iticket_run_bridge_base_sha_mismatch');
  const tmp=BASE+'.'+process.pid+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,BASE);
  fs.chmodSync(BASE,0o600);
}
ensureBase();
const old=await import(pathToFileURL(BASE).href+'?sha='+BASE_SHA);
if(typeof old.registerProjectPlugin!=='function')F('iticket_run_bridge_base_export_missing');

export function registerProjectPlugin(mcp,context){
  let opsHandler=null;
  function wrap(name,handler){
    if(name==='ops_execute')opsHandler=handler;
    if(name==='run_project_command'){
      return async a=>{
        if(a?.project==='honartik_admin_prod'&&a?.command===COMMAND){
          if(a?.mode!=='approved-risky')F('iticket_run_bridge_approved_risky_required');
          if(typeof opsHandler!=='function')F('iticket_run_bridge_ops_handler_missing');
          return opsHandler({project:'honartik_admin_prod',command:INNER,reason:'Execute fixed Honartik iTicket pre-token canonical Git synchronization.',access:'write',risk:'high',acknowledgeRisk:true,timeoutMs:300000});
        }
        return handler(a);
      };
    }
    return handler;
  }
  const proxy=new Proxy(mcp,{
    get(target,property,receiver){
      if(property==='registerTool')return(name,config,handler,...rest)=>target.registerTool(name,config,wrap(name,handler),...rest);
      if(property==='tool')return(name,description,schema,handler,...rest)=>target.tool(name,description,schema,wrap(name,handler),...rest);
      const value=Reflect.get(target,property,receiver);
      return typeof value==='function'?value.bind(target):value;
    }
  });
  const result=old.registerProjectPlugin(proxy,context);
  if(typeof opsHandler!=='function')F('iticket_run_bridge_ops_handler_not_registered');
  return result;
}
