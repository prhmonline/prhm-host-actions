import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { textResult } from '../core/result.js';

const BASE_SHA='e4871d509022c293ed0026c60283e18cd157c746b22751394b6933b543105248';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const BASE_FILE=path.join(HERE,`.selfmaint-central-backup-cleanup-base-${BASE_SHA}.mjs`);
const BACKUP_ROOT='/var/backups/prhm-agent-selfmaint';
const SOCKET='/run/prhm-agent-selfmaint-exec/exec.sock';
const MAX_RESPONSE=400000;
const DIRECT_IDS=new Set();

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
  if(!names.length)throw new Error('selfmaint_v22_base_backup_missing');
  const bytes=fs.readFileSync(path.join(BACKUP_ROOT,names[0]));
  if(digest(bytes)!==BASE_SHA)throw new Error('selfmaint_v22_base_backup_sha_mismatch');
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
        if(size>MAX_RESPONSE)return reject(new Error('selfmaint_v22_exec_response_too_large'));
        let out={};
        try{out=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}
        catch{return reject(new Error('selfmaint_v22_exec_invalid_response'))}
        if(res.statusCode<200||res.statusCode>=300||out.ok!==true)
          return reject(new Error(String(out.error||`selfmaint_v22_exec_rejected_${res.statusCode}`)));
        resolve(out);
      });
    });
    req.setTimeout(timeoutMs,()=>req.destroy(new Error('selfmaint_v22_exec_timeout')));
    req.on('error',e=>reject(new Error(`selfmaint_v22_exec_bridge_error:${e.message}`)));
    data?req.end(data):req.end();
  });
}

function directProxy(mcp){
  return new Proxy(mcp,{get(target,prop){
    if(prop==='registerTool'||prop==='tool')return(name,...args)=>{
      if(!['selfmaint_request','selfmaint_status','selfmaint_apply'].includes(name))
        return target[prop](name,...args);
      const i=args.length-1,legacy=args[i];
      if(typeof legacy!=='function')throw new Error('selfmaint_v22_legacy_handler_missing');
      const next=[...args];
      if(name==='selfmaint_request')next[i]=async toolArgs=>{
        if(exactRootStageSentinel(toolArgs))return legacy(toolArgs);
        const out=await callExec('/v1/request','POST',toolArgs);
        const id=String(out?.request?.request_id||out?.request_id||'');
        if(id)DIRECT_IDS.add(id);
        return textResult(out);
      };
      if(name==='selfmaint_status')next[i]=async toolArgs=>{
        const id=String(toolArgs?.request_id||'');
        if(!DIRECT_IDS.has(id))return legacy(toolArgs);
        const out=await callExec('/v1/status','POST',toolArgs);
        const status=String(out?.job?.status||out?.request?.status||out?.status||'');
        if(['succeeded','failed','expired','consumed','cancelled','rejected'].includes(status))DIRECT_IDS.delete(id);
        return textResult(out);
      };
      if(name==='selfmaint_apply')next[i]=async toolArgs=>{
        const id=String(toolArgs?.request_id||'');
        if(!DIRECT_IDS.has(id))return legacy(toolArgs);
        try{return textResult(await callExec('/v1/execute','POST',toolArgs,1200000))}
        finally{DIRECT_IDS.delete(id)}
      };
      return target[prop](name,...next);
    };
    const value=target[prop];
    return typeof value==='function'?value.bind(target):value;
  }});
}

ensureBase();
const base=await import(pathToFileURL(BASE_FILE).href+'?sha='+BASE_SHA);
if(typeof base.registerSelfmaintPlugin!=='function')throw new Error('selfmaint_v22_base_export_missing');

export function registerSelfmaintPlugin(mcp,context){
  return base.registerSelfmaintPlugin(directProxy(mcp),context);
}

export const __selfmaintV22Test={exactRootStageSentinel};
