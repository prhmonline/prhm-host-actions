#!/usr/local/bin/prhm-node
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const cp=require('child_process');
const Module=require('module');

const BASE_SERVER_SHA='29b9a47504bd67bf2d04c701bdd4419be3a91bdbd0403b440ab65338f3752795';
const HELPER_OLD_SHA='93ee4406346409f87e2f5cd07f67d6c090fd82832d13ac8828b317ea3a5651a8';
const OLD_MCP_PIN='5d631a1c94208ba2d3daa515e45f3bd3717cf705a1d918f3e8bd9f9d85a97176';
const NEW_MCP_PIN='9034957651c7f367b6c9f5c5db79962c5cc86d5201d2ec5855c64458f6117a5b';
const ROOT='/var/backups/prhm-agent-selfmaint';
const HERE='/home/agent/ssh-agent-api';
const HELPER='/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-existing-topology-rolling-refresh-v1.js';
const BASE_FILE=path.join(HERE,'.server-mcp-pin-forward-base-'+BASE_SERVER_SHA+'.js');
const BACKUP_ROOT='/var/backups/prhm-agent-zdt-mcp-source-forward-refresh-v1';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const count=(s,n)=>s.split(n).length-1;
function fail(m){throw new Error(m)}
function atomic(file,bytes,st,suffix){
  const tmp=file+'.'+suffix+'-'+process.pid+'-'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:st.mode&0o777,flag:'wx'});
  fs.chownSync(tmp,st.uid,st.gid);fs.chmodSync(tmp,st.mode&0o777);fs.renameSync(tmp,file);
}
function ensureBase(){
  try{const b=fs.readFileSync(BASE_FILE);if(sha(b)===BASE_SERVER_SHA)return;}catch{}
  const names=fs.readdirSync(ROOT).filter(n=>n.startsWith('agent_api-server.js-')&&n.endsWith('-'+BASE_SERVER_SHA+'.bak')).sort().reverse();
  if(!names.length)fail('mcp_pin_forward_base_backup_missing');
  const bytes=fs.readFileSync(path.join(ROOT,names[0]));
  if(sha(bytes)!==BASE_SERVER_SHA)fail('mcp_pin_forward_base_sha_mismatch');
  const ds=fs.statSync(HERE);
  const st={mode:0o600,uid:ds.uid,gid:ds.gid};
  atomic(BASE_FILE,bytes,st,'base');
}
function refreshMcpPin(){
  const st=fs.lstatSync(HELPER);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(HELPER)!==HELPER)fail('mcp_pin_forward_helper_invalid');
  const raw=fs.readFileSync(HELPER), actual=sha(raw), source=raw.toString('utf8');
  const oldAnchor="[PATHS.mcpSource]:'"+OLD_MCP_PIN+"'";
  const newAnchor="[PATHS.mcpSource]:'"+NEW_MCP_PIN+"'";
  if(actual!==HELPER_OLD_SHA){
    if(count(source,newAnchor)===1&&count(source,oldAnchor)===0)return {changed:false,sha256:actual};
    fail('mcp_pin_forward_helper_sha_drift:'+actual);
  }
  if(count(source,oldAnchor)!==1||count(source,newAnchor)!==0)fail('mcp_pin_forward_anchor_mismatch');
  const next=Buffer.from(source.replace(oldAnchor,newAnchor),'utf8');
  const ck=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:next,encoding:null,timeout:30000,maxBuffer:500000});
  if(ck.error||ck.status!==0)fail('mcp_pin_forward_helper_syntax_invalid');
  fs.mkdirSync(BACKUP_ROOT,{recursive:true,mode:0o700});
  const backup=path.join(BACKUP_ROOT,'rolling-helper-'+Date.now()+'-'+HELPER_OLD_SHA+'.bak');
  fs.writeFileSync(backup,raw,{mode:0o600,flag:'wx'});
  atomic(HELPER,next,st,'mcp-pin-forward');
  const finalBytes=fs.readFileSync(HELPER), finalText=finalBytes.toString('utf8');
  if(count(finalText,newAnchor)!==1||count(finalText,oldAnchor)!==0)fail('mcp_pin_forward_postcondition_failed');
  return {changed:true,sha256:sha(finalBytes),backup};
}
ensureBase();
const change=refreshMcpPin();
try{
  const source=fs.readFileSync(BASE_FILE,'utf8');
  const m=new Module(BASE_FILE,module);
  m.filename=BASE_FILE;m.paths=module.paths;
  m._compile(source,BASE_FILE);
}catch(e){
  if(change.changed){
    const names=fs.readdirSync(BACKUP_ROOT).filter(n=>n.endsWith('-'+HELPER_OLD_SHA+'.bak')).sort().reverse();
    if(names.length){
      const rb=fs.readFileSync(path.join(BACKUP_ROOT,names[0]));
      const st=fs.lstatSync(HELPER);
      atomic(HELPER,rb,st,'rollback');
    }
  }
  throw e;
}
