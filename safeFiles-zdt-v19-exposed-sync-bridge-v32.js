import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const BASE_SHA='5c816e0b3c1bef97124f3eb918b15ca1d656a90f2109284f52cc16ae50423ed1';
const ROOT='/var/backups/prhm-agent-selfmaint';
const HERE=path.dirname(new URL(import.meta.url).pathname);
const BASE_FILE=path.join(HERE,'.safeFiles-zdt-v31-base-'+BASE_SHA+'.mjs');
const OLD_SYNC='control_plane_agent_zdt_v19_worktree_git_sync_v1';
const REBUILD='control_plane_agent_zdt_v19_rebuild_current_baseline_v1';
const NEW_SYNC='control_plane_agent_zdt_v19_worktree_git_sync_v2';

const sha=b=>createHash('sha256').update(b).digest('hex');

function ensureBase(){
  try{if(sha(fs.readFileSync(BASE_FILE))===BASE_SHA)return;}catch{}
  const names=fs.readdirSync(ROOT)
    .filter(n=>n.startsWith('agent_mcp-src_plugins_safeFiles.js-')&&n.endsWith('-'+BASE_SHA+'.bak'))
    .sort().reverse();
  if(!names.length)throw new Error('zdt_v32_base_backup_missing');
  const bytes=fs.readFileSync(path.join(ROOT,names[0]));
  if(sha(bytes)!==BASE_SHA)throw new Error('zdt_v32_base_sha_mismatch');
  const tmp=BASE_FILE+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,BASE_FILE);
  fs.chmodSync(BASE_FILE,0o600);
}

ensureBase();
const base=await import(pathToFileURL(BASE_FILE).href+'?zdt-v32='+BASE_SHA);
if(typeof base.registerSafeFilesPlugin!=='function')throw new Error('zdt_v32_base_export_missing');

export function registerSafeFilesPlugin(mcp,context){
  let oldConfig=null;
  let rebuildHandler=null;
  let syncHandler=null;
  const proxy=new Proxy(mcp,{
    get(target,prop){
      if(prop==='registerTool')return (name,config,handler)=>{
        if(name===OLD_SYNC){oldConfig=config;return;}
        if(name===REBUILD)rebuildHandler=handler;
        if(name===NEW_SYNC)syncHandler=handler;
        return target.registerTool.call(target,name,config,handler);
      };
      const v=Reflect.get(target,prop,target);
      return typeof v==='function'?v.bind(target):v;
    }
  });
  base.registerSafeFilesPlugin(proxy,context);
  if(!oldConfig||typeof rebuildHandler!=='function'||typeof syncHandler!=='function')
    throw new Error('zdt_v32_required_surface_missing');
  mcp.registerTool(
    OLD_SYNC,
    {
      ...oldConfig,
      title:'Rebuild and Git Sync Agent ZDT V19 Worktree',
      description:'Rebuild the two fixed V19 files from current owner SHAs, require GREEN contract, then stage only those files, commit without force, push the fixed branch, and verify remote HEAD.'
    },
    async()=>{
      await rebuildHandler({});
      return await syncHandler({});
    }
  );
}
