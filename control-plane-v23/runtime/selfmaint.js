import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { textResult } from '../core/result.js';

const BASE_SHA='e4871d509022c293ed0026c60283e18cd157c746b22751394b6933b543105248';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const BASE_FILE=path.join(HERE,`.selfmaint-central-backup-cleanup-base-${BASE_SHA}.mjs`);
const BACKUP_ROOT='/var/backups/prhm-agent-selfmaint';
const SOCKET='/run/prhm-agent-selfmaint-exec/exec.sock';
const MAX_RESPONSE=400000;

const ROOT_STAGE_SENTINEL=Object.freeze({
  target:'agent_api',
  path:'server.js',
  expected_sha256:'7171a63ac5a7e72cd7c0af7d0c90e7d16abd17ed1af623441c44387444e77b23',
  new_content:'/* PRHM_ROOT_SCRIPTS_STAGE_TRANSPORT_REQUEST_SURFACE_V1 */\n',
  reason:'Request fixed control-plane root scripts stage transport approval via mediator.'
});
const SENTINEL_KEYS=Object.freeze(Object.keys(ROOT_STAGE_SENTINEL).sort());

const digest=b=>crypto.createHash('sha256').update(b).digest('hex');

function exactRootStageSentinel(args){
  if(!args||typeof args!=='object'||Array.isArray(args))return false;
  const keys=Object.keys(args).sort();
  if(keys.length!==SENTINEL_KEYS.length)return false;
  for(let i=0;i<keys.length;i++)if(keys[i]!==SENTINEL_KEYS[i])return false;
  return SENTINEL_KEYS.every(k=>args[k]===ROOT_STAGE_SENTINEL[k]);
}

function ensureBase(){
  try{if(digest(fs.readFileSync(BASE_FILE))===BASE_SHA)return}catch{}
  const names=fs.readdirSync(BACKUP_ROOT)
    .filter(n=>n.startsWith('agent_mcp-src_plugins_selfmaint.js-')&&n.endsWith('-'+BASE_SHA+'.bak'))
    .sort().reverse();
  if(!names.length)throw new Error('selfmaint_v23_base_backup_missing');
  const bytes=fs.readFileSync(path.join(BACKUP_ROOT,names[0]));
  if(digest(bytes)!==BASE_SHA)throw new Error('selfmaint_v23_base_backup_sha_mismatch');
  const tmp=BASE_FILE+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,BASE_FILE);
  fs.chmodSync(BASE_FILE,0o600);
}

function callExec(pathname,method='GET',body,timeoutMs=15000){
  return new Promise((resolve,reject)=>{
    const data=body===undefined?null:Buffer.from(JSON.stringify(body));
    const headers=data?{'content-type':'application/json','content-length':data.length}:{};
    const req=http.request({socketPath:SOCKET,path:pathname,method,headers},res=>{
      let size=0;const chunks=[];
      res.on('data',chunk=>{size+=chunk.length;if(size<=MAX_RESPONSE)chunks.push(chunk)});
      res.on('end',()=>{
        if(size>MAX_RESPONSE)return reject(new Error('selfmaint_v23_exec_response_too_large'));
        let out={};
        try{out=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}
        catch{return reject(new Error('selfmaint_v23_exec_invalid_response'))}
        if(res.statusCode<200||res.statusCode>=300||out.ok!==true)
          return reject(new Error(String(out.error||`selfmaint_v23_exec_rejected_${res.statusCode}`)));
        resolve(out);
      });
    });
    req.setTimeout(timeoutMs,()=>req.destroy(new Error('selfmaint_v23_exec_timeout')));
    req.on('error',e=>reject(new Error(`selfmaint_v23_exec_bridge_error:${e.message}`)));
    data?req.end(data):req.end();
  });
}

function directProxy(mcp){
  return new Proxy(mcp,{get(target,prop){
    if(prop==='registerTool'||prop==='tool')return(name,...args)=>{
      if(!['selfmaint_request','selfmaint_status','selfmaint_apply'].includes(name))
        return target[prop](name,...args);
      const i=args.length-1,legacy=args[i];
      if(typeof legacy!=='function')throw new Error('selfmaint_v23_legacy_handler_missing');
      const next=[...args];
      if(name==='selfmaint_request')next[i]=async toolArgs=>{
        if(exactRootStageSentinel(toolArgs))return legacy(toolArgs);
        return textResult(await callExec('/v1/request','POST',toolArgs));
      };
      if(name==='selfmaint_status')next[i]=async toolArgs=>{
        try{return textResult(await callExec('/v1/status','POST',toolArgs))}
        catch(error){
          if(!String(error?.message||error).includes('status_not_found'))throw error;
          return legacy(toolArgs);
        }
      };
      if(name==='selfmaint_apply')next[i]=async toolArgs=>{
        try{return textResult(await callExec('/v1/execute','POST',toolArgs,1200000))}
        catch(error){
          const message=String(error?.message||error);
          if(!message.includes('status_not_found')&&!message.includes('request_not_found'))throw error;
          return legacy(toolArgs);
        }
      };
      return target[prop](name,...next);
    };
    const value=target[prop];
    return typeof value==='function'?value.bind(target):value;
  }});
}

ensureBase();
const base=await import(pathToFileURL(BASE_FILE).href+'?sha='+BASE_SHA);
if(typeof base.registerSelfmaintPlugin!=='function')throw new Error('selfmaint_v23_base_export_missing');

export function registerSelfmaintPlugin(mcp,context){
  const result=base.registerSelfmaintPlugin(directProxy(mcp),context);
  mcp.registerTool('selfmaint_apply_level3',{
    title:'Apply Approved Level-3 Self-maintenance Request',
    description:'Execute only a previously created Level-3/high SHA-bound self-maintenance request using the Level-3 production confirmation literal.',
    inputSchema:{
      request_id:z.string().uuid(),
      second_confirmation:z.literal('CONFIRM_LEVEL_3_PRODUCTION'),
      note:z.string().min(3).max(1000).optional()
    },
    annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}
  },async args=>textResult(await callExec('/v1/execute','POST',args,1200000)));
  return result;
}

export const __selfmaintV23Test={exactRootStageSentinel};
