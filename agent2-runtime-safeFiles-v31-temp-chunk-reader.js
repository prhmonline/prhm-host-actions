import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { textResult } from '../core/result.js';

const BASE_SHA='a06c5d7dbd9fbbbe771967d70134fa5da711b444c5e8b007977151cb101794bb';
const ROOT='/var/backups/prhm-agent-selfmaint';
const HERE=path.dirname(new URL(import.meta.url).pathname);
const BASE_FILE=path.join(HERE,'.safeFiles-zdt-v31-temp-reader-base-'+BASE_SHA+'.mjs');
const WORKTREE='/home/prhm/worktrees/prhm-host-actions-zdt-installer-v2';
const FILE='bootstrap-host-actions-v18-agent-zdt-current-baseline-refresh.js';
const EXPECTED_SHA='33b14dff259393cbc1b989ca4721204845a742ce4912a139586e3af71faf85e6';
const EXPECTED_BYTES=410634;
const CHUNK_BYTES=48000;
const TARGET_TOOL='control_plane_agent_zdt_v18_worktree_diff_v1';
const sha=b=>createHash('sha256').update(b).digest('hex');
let sequence=0;

function ensureBase(){
  try{if(sha(fs.readFileSync(BASE_FILE))===BASE_SHA)return;}catch{}
  const names=fs.readdirSync(ROOT)
    .filter(n=>n.startsWith('agent_mcp-src_plugins_safeFiles.js-')&&n.endsWith('-'+BASE_SHA+'.bak'))
    .sort().reverse();
  if(!names.length)throw new Error('zdt_v31_base_backup_missing');
  const bytes=fs.readFileSync(path.join(ROOT,names[0]));
  if(sha(bytes)!==BASE_SHA)throw new Error('zdt_v31_base_sha_mismatch');
  const tmp=BASE_FILE+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,BASE_FILE);
  fs.chmodSync(BASE_FILE,0o600);
}

ensureBase();
const base=await import(pathToFileURL(BASE_FILE).href+'?zdt-v31='+BASE_SHA);
if(typeof base.registerSafeFilesPlugin!=='function')throw new Error('zdt_v31_base_export_missing');

function nextChunk(){
  const root=fs.lstatSync(WORKTREE);
  if(!root.isDirectory()||root.isSymbolicLink()||fs.realpathSync(WORKTREE)!==WORKTREE)throw new Error('zdt_v31_worktree_invalid');
  const file=path.join(WORKTREE,FILE);
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(path.dirname(file))!==WORKTREE)throw new Error('zdt_v31_file_invalid');
  const bytes=fs.readFileSync(file);
  if(bytes.length!==EXPECTED_BYTES)throw new Error('zdt_v31_size_mismatch');
  if(sha(bytes)!==EXPECTED_SHA)throw new Error('zdt_v31_sha_mismatch');
  const total=Math.ceil(bytes.length/CHUNK_BYTES);
  if(sequence>=total){
    return {ok:true,read_only:true,file:FILE,file_sha256:EXPECTED_SHA,file_bytes:EXPECTED_BYTES,chunk_bytes:CHUNK_BYTES,total_chunks:total,complete:true,next_sequence:null,production_mutation:false};
  }
  const current=sequence++;
  const start=current*CHUNK_BYTES;
  const end=Math.min(start+CHUNK_BYTES,bytes.length);
  const chunk=bytes.subarray(start,end);
  return {ok:true,read_only:true,file:FILE,file_sha256:EXPECTED_SHA,file_bytes:EXPECTED_BYTES,chunk_bytes:chunk.length,total_chunks:total,sequence:current,start,end,chunk_sha256:sha(chunk),chunk_base64:chunk.toString('base64'),complete:sequence>=total,next_sequence:sequence<total?sequence:null,production_mutation:false};
}

export function registerSafeFilesPlugin(mcp,context){
  let replaced=false;
  const proxy=new Proxy(mcp,{
    get(target,prop){
      if(prop==='registerTool'){
        return (name,config,handler)=>{
          if(name===TARGET_TOOL){
            if(replaced)throw new Error('zdt_v31_duplicate_target_tool');
            replaced=true;
            return target.registerTool.call(target,name,config,async()=>textResult(nextChunk()));
          }
          return target.registerTool.call(target,name,config,handler);
        };
      }
      const value=Reflect.get(target,prop,target);
      return typeof value==='function'?value.bind(target):value;
    }
  });
  base.registerSafeFilesPlugin(proxy,context);
  if(!replaced)throw new Error('zdt_v31_target_tool_not_found');
}
