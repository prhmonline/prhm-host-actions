#!/usr/local/bin/prhm-node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),Module=require('module');
const BASE_BRIDGE_SHA='df5ae0789529f982e2c5321be87dc07c8b174676df7bced18dd1801f30deaa30';
const OLD="const active=cp.execFileSync('/usr/bin/systemctl',['is-active','prhm-agent-selfmaint-exec.service'],{encoding:'utf8',timeout:10000}).trim();if(active!=='active'||!fs.existsSync(EXEC_SOCKET))fail('central_offsite_executor_reload_failed');";
const NEW="let ready=false;for(let i=0;i<40;i++){let active='';try{active=cp.execFileSync('/usr/bin/systemctl',['is-active','prhm-agent-selfmaint-exec.service'],{encoding:'utf8',timeout:10000}).trim()}catch{}if(active==='active'&&fs.existsSync(EXEC_SOCKET)){ready=true;break}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250)}if(!ready)fail('central_offsite_executor_reload_failed');";
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(m){throw new Error(m)}
function loadBase(){
  const names=fs.readdirSync(__dirname).filter(n=>n.startsWith('opsSelfmaintBridge.js.agent-backup.')).sort().reverse();
  for(const name of names){const p=path.join(__dirname,name);let st;try{st=fs.lstatSync(p)}catch{continue}if(!st.isFile()||st.isSymbolicLink())continue;const b=fs.readFileSync(p);if(sha(b)===BASE_BRIDGE_SHA)return b}
  fail('readiness_wrapper_base_backup_missing');
}
const bytes=loadBase();let source=bytes.toString('utf8');
if(source.split(OLD).length-1!==1||source.includes('for(let i=0;i<40;i++)'))fail('readiness_wrapper_anchor_mismatch');
source=source.replace(OLD,NEW);
if(source.split(OLD).length-1!==0||source.split(NEW).length-1!==1)fail('readiness_wrapper_postcondition');
const m=new Module(__filename,module);m.filename=__filename;m.paths=module.paths;m._compile(source,__filename);
module.exports=m.exports;
