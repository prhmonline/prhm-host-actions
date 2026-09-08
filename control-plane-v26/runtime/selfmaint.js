import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { textResult } from '../core/result.js';

const BASE_SHA='b3cfc90b72cf3f13fecf9c0737369646c6625cda7ca527ed017c78834385a7e4';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const BASE_FILE=path.join(HERE,`.selfmaint-base-fixed-refresh-base-${BASE_SHA}.mjs`);
const BACKUP_ROOT='/var/backups/prhm-agent-selfmaint';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');

function ensureBase(){
  try{if(digest(fs.readFileSync(BASE_FILE))===BASE_SHA)return;}catch{}
  const prefix='agent_mcp-src_plugins_selfmaint.js-';
  const suffix='-'+BASE_SHA+'.bak';
  const names=fs.readdirSync(BACKUP_ROOT).filter(n=>n.startsWith(prefix)&&n.endsWith(suffix)).sort().reverse();
  if(!names.length)throw new Error('selfmaint_base_refresh_mcp_base_backup_missing');
  const bytes=fs.readFileSync(path.join(BACKUP_ROOT,names[0]));
  if(digest(bytes)!==BASE_SHA)throw new Error('selfmaint_base_refresh_mcp_base_sha_mismatch');
  const tmp=BASE_FILE+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,BASE_FILE);
  fs.chmodSync(BASE_FILE,0o600);
}

ensureBase();
const base=await import(pathToFileURL(BASE_FILE).href+'?sha='+BASE_SHA);
if(typeof base.registerSelfmaintPlugin!=='function')throw new Error('selfmaint_base_refresh_mcp_base_export_missing');

export function registerSelfmaintPlugin(mcp,context){
  const result=base.registerSelfmaintPlugin(mcp,context);
  const agent=context&&context.agent;
  if(agent&&typeof agent.callAgent==='function'){
    mcp.registerTool('selfmaint_base_fixed_refresh_v1',{
      title:'Refresh Self-maintenance Base Runtime',
      description:'Fixed zero-input one-shot SHA/PID-bound refresh of prhm-agent-selfmaint.service. No arbitrary command, path, action, service, database or application input.',
      inputSchema:{},
      annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}
    },async()=>textResult(await agent.callAgent('/selfmaint/base-fixed-refresh-v1','POST',{})));
  }
  return result;
}
