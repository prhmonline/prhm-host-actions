import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const BASE_SERVER_SHA='5d631a1c94208ba2d3daa515e45f3bd3717cf705a1d918f3e8bd9f9d85a97176';
const REGISTRY_OLD_SHA='0d69b284f8bcf9b772a711dff962a614bd0c1234ee03b87f3faa70877eadb48c';
const ROOT='/var/backups/prhm-agent-selfmaint';
const HERE='/home/agent/ssh-mcp-server';
const REGISTRY=path.join(HERE,'src/core/registry.js');
const BASE_FILE=path.join(HERE,'.server-central-offsite-registry-base-'+BASE_SERVER_SHA+'.mjs');
const BACKUP_ROOT='/var/backups/prhm-agent-mcp-central-offsite-registry-registration-v1';
const sha=b=>createHash('sha256').update(b).digest('hex');

function atomic(file,bytes,mode,uid,gid,suffix){
  const dir=path.dirname(file);
  const tmp=path.join(dir,'.'+path.basename(file)+'.'+suffix+'-'+process.pid+'-'+Date.now()+'.tmp');
  fs.writeFileSync(tmp,bytes,{mode,flag:'wx'});
  fs.chownSync(tmp,uid,gid);
  fs.chmodSync(tmp,mode);
  fs.renameSync(tmp,file);
}

function ensureBase(){
  try{const b=fs.readFileSync(BASE_FILE);if(sha(b)===BASE_SERVER_SHA)return;}catch{}
  const names=fs.readdirSync(ROOT).filter(n=>n.startsWith('agent_mcp-server.js-')&&n.endsWith('-'+BASE_SERVER_SHA+'.bak')).sort().reverse();
  if(!names.length)throw new Error('central_offsite_registry_base_backup_missing');
  const bytes=fs.readFileSync(path.join(ROOT,names[0]));
  if(sha(bytes)!==BASE_SERVER_SHA)throw new Error('central_offsite_registry_base_sha_mismatch');
  const dirStat=fs.statSync(HERE);
  atomic(BASE_FILE,bytes,0o600,dirStat.uid,dirStat.gid,'base');
}

function patchRegistry(){
  const st=fs.lstatSync(REGISTRY);
  if(st.isSymbolicLink()||!st.isFile())throw new Error('central_offsite_registry_not_regular');
  if(fs.realpathSync(REGISTRY)!==REGISTRY)throw new Error('central_offsite_registry_realpath_mismatch');
  const original=fs.readFileSync(REGISTRY);
  const source=original.toString('utf8');
  const importAnchor="import { registerCentralOffsitePlugin } from '../plugins/centralOffsite.js';";
  const call='  registerCentralOffsitePlugin(mcp, context);';
  const callAnchor='  registerHostActionsPlugin(mcp, context);\n  {';
  if(source.split(importAnchor).length-1!==1)throw new Error('central_offsite_registry_import_anchor_mismatch');
  const callCount=source.split(call).length-1;
  if(callCount===1)return {already_applied:true,sha256:sha(original)};
  if(callCount!==0)throw new Error('central_offsite_registry_call_anchor_mismatch');
  if(sha(original)!==REGISTRY_OLD_SHA)throw new Error('central_offsite_registry_preimage_drift');
  if(source.split(callAnchor).length-1!==1)throw new Error('central_offsite_registry_call_anchor_mismatch');
  const candidate=Buffer.from(source.replace(callAnchor,'  registerHostActionsPlugin(mcp, context);\n'+call+'\n  {'),'utf8');
  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);
  const backupDir=path.join(BACKUP_ROOT,stamp+'-'+process.pid);
  fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(backupDir,'registry.js.bak'),original,{mode:0o600,flag:'wx'});
  const check=REGISTRY+'.check-'+process.pid+'-'+Date.now()+'.mjs';
  try{
    fs.writeFileSync(check,candidate,{mode:0o600,flag:'wx'});
    const syntax=spawnSync('/usr/local/bin/prhm-node',['--check',check],{encoding:'utf8',timeout:30000,maxBuffer:200000});
    if(syntax.error||syntax.status!==0)throw new Error('central_offsite_registry_candidate_syntax_invalid');
  }finally{try{fs.unlinkSync(check)}catch{}}
  atomic(REGISTRY,candidate,st.mode&0o777,st.uid,st.gid,'central-offsite');
  const finalBytes=fs.readFileSync(REGISTRY);
  const finalText=finalBytes.toString('utf8');
  if(finalText.split(importAnchor).length-1!==1||finalText.split(call).length-1!==1)throw new Error('central_offsite_registry_postcondition_failed');
  return {already_applied:false,sha256:sha(finalBytes),backup_dir:backupDir};
}

patchRegistry();
ensureBase();
await import(pathToFileURL(BASE_FILE).href+'?central-offsite-registry='+BASE_SERVER_SHA);
