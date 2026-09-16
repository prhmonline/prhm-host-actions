'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');

const ACTION='control_plane_preimage_evidence_v1';
const PATHS=Object.freeze([
  '/opt/prhm-agent-selfmaint/server.js',
  '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'
]);

function sha256(buf){return crypto.createHash('sha256').update(buf).digest('hex');}
function fail(path,error){const e=new Error('evidence_read_failed:'+path+':'+(error?.code||error?.message||'unknown'));e.code='evidence_read_failed';throw e;}
function collectWith(io){
  if(!io||typeof io.stat!=='function'||typeof io.read!=='function')throw new Error('invalid_dependencies');
  const files=[];
  for(const path of PATHS){
    try{
      const st=io.stat(path);
      const body=io.read(path);
      files.push({path,sha256:sha256(body),size:Number(st.size),mtime:new Date(st.mtime).toISOString(),readable:true});
    }catch(error){fail(path,error);}
  }
  return {ok:true,action:ACTION,files};
}
function collect(){return collectWith({stat:fs.statSync,read:fs.readFileSync});}
module.exports={ACTION,PATHS,collectWith,collect};
