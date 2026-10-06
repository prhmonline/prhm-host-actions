import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {textResult} from '../core/result.js';

const BASE_SHA='41416010bd28f7eb38c57d5e0482a56d782c0f8fca42a961a8480e6f0c88a6d5';
const BACKUP_ROOT='/var/backups/prhm-agent-selfmaint';
const HERE=path.dirname(new URL(import.meta.url).pathname);
const BASE_FILE=path.join(HERE,'.safeFiles-v37-rebase-base-'+BASE_SHA+'.mjs');

const TARGET='/opt/prhm-agent-selfmaint-exec/actions/installer-refresh-l4-binding-repair-state-v1.js';
const STATE_ROOT='/var/lib/prhm-agent-selfmaint-exec/installer-refresh-state-helper-rebase-v37';
const ACTION_BACKUP_ROOT='/var/backups/prhm-installer-refresh-state-helper-rebase-v37';
const CURRENT_SHA='b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e';
const TARGET_SHA='b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb';
const CURRENT_EXPR="const p=path.join(ROOT,'prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js');";
const TARGET_EXPR="const p='/run/prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js';";
const CONFIRM='CONFIRM_LEVEL_4_CRITICAL';

const PREFLIGHT_TOOL='control_plane_installer_refresh_state_helper_rebase_v37_preflight_v1';
const REQUEST_TOOL='control_plane_installer_refresh_state_helper_rebase_v37_request_v1';
const STATUS_TOOL='control_plane_installer_refresh_state_helper_rebase_v37_status_v1';
const APPLY_TOOL='control_plane_installer_refresh_state_helper_rebase_v37_apply_v1';

const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=m=>{throw new Error(m)};

function ensureBase(){
  try{if(sha(fs.readFileSync(BASE_FILE))===BASE_SHA)return}catch{}
  const name=fs.readdirSync(BACKUP_ROOT)
    .filter(n=>n.startsWith('agent_mcp-src_plugins_safeFiles.js-')&&n.endsWith('-'+BASE_SHA+'.bak'))
    .sort().reverse()[0];
  if(!name)fail('v37_surface_base_backup_missing');
  const bytes=fs.readFileSync(path.join(BACKUP_ROOT,name));
  if(sha(bytes)!==BASE_SHA)fail('v37_surface_base_sha_mismatch');
  const tmp=BASE_FILE+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,BASE_FILE);
  fs.chmodSync(BASE_FILE,0o600);
}

const WORKER=String.raw`const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const TARGET="/opt/prhm-agent-selfmaint-exec/actions/installer-refresh-l4-binding-repair-state-v1.js";
const STATE_ROOT="/var/lib/prhm-agent-selfmaint-exec/installer-refresh-state-helper-rebase-v37";
const BACKUP_ROOT="/var/backups/prhm-installer-refresh-state-helper-rebase-v37";
const CURRENT_SHA="b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e";
const TARGET_SHA="b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb";
const CURRENT_EXPR="const p=path.join(ROOT,'prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js');";
const TARGET_EXPR="const p='/run/prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js';";
const CONFIRM="CONFIRM_LEVEL_4_CRITICAL",TTL=180000;
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(m){throw new Error(m)}
function count(s,n){return String(s).split(String(n)).length-1}
function regular(file,label){const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(file)!==file)fail(label+'_invalid');return st}
function syntax(bytes){const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:bytes,encoding:null,timeout:30000,maxBuffer:500000});if(r.error||r.status!==0)fail('candidate_syntax_invalid:'+String(r.stderr||r.stdout||r.error||'').slice(-1000))}
function candidate(source){
  const bytes=Buffer.from(String(source),'utf8'),current=H(bytes);
  if(current===TARGET_SHA){if(count(source,TARGET_EXPR)!==1||count(source,CURRENT_EXPR)!==0)fail('target_state_anchor_invalid');syntax(bytes);return{bytes,sha256:TARGET_SHA,changed:false}}
  if(current!==CURRENT_SHA)fail('v37_current_state_sha_mismatch:'+current);
  if(count(source,CURRENT_EXPR)!==1||count(source,TARGET_EXPR)!==0)fail('v37_tmp_path_anchor_mismatch');
  const next=String(source).replace(CURRENT_EXPR,TARGET_EXPR),out=Buffer.from(next,'utf8'),nextSha=H(out);
  if(nextSha!==TARGET_SHA)fail('v37_target_state_sha_mismatch:'+nextSha);
  syntax(out);return{bytes:out,sha256:nextSha,changed:true};
}
function valid(id){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id||''))fail('request_id_invalid');return id}
function stateFile(id){return path.join(STATE_ROOT,valid(id)+'.json')}
function writeJson(file,obj){const bytes=Buffer.from(JSON.stringify(obj,null,2)+'\\n'),tmp=file+'.'+process.pid+'.'+Date.now()+'.tmp';fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});fs.renameSync(tmp,file)}
function readState(id){const file=stateFile(id),st=regular(file,'request_state'),obj=JSON.parse(fs.readFileSync(file,'utf8'));if(obj.request_id!==id)fail('request_state_id_mismatch');return{file,obj,st}}
function preflight(){regular(TARGET,'state_helper');const source=fs.readFileSync(TARGET,'utf8'),current=H(Buffer.from(source,'utf8')),next=candidate(source);console.log(JSON.stringify({ok:true,type:'installer-refresh-state-helper-rebase-v37-preflight-v1',read_only:true,current_sha256:current,target_sha256:next.sha256,would_change:next.changed,production_application_mutation:false,database_mutation:false,arbitrary_command:false,arbitrary_path:false}))}
function request(){fs.mkdirSync(STATE_ROOT,{recursive:true,mode:0o700});fs.chmodSync(STATE_ROOT,0o700);const id=crypto.randomUUID(),now=Date.now(),obj={ok:true,request_id:id,status:'pending',level:4,risk:'critical',action:'control_plane_installer_refresh_state_helper_rebase_v37',operation:'host_action.control_plane_installer_refresh_state_helper_rebase_v37',created_at:new Date(now).toISOString(),expires_at:new Date(now+TTL).toISOString(),one_time_use:true,second_confirmation_required:true,production_application_mutation:false,database_mutation:false};writeJson(stateFile(id),obj);console.log(JSON.stringify(obj))}
function status(id){const{obj}=readState(id);console.log(JSON.stringify({...obj,expired:Date.now()>Date.parse(obj.expires_at),production_application_mutation:false,database_mutation:false}))}
function writeFsync(file,bytes,mode){const fd=fs.openSync(file,'wx',mode);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}
function restore(preimage,st){const tmp=TARGET+'.rollback-'+process.pid+'-'+Date.now()+'.tmp';writeFsync(tmp,preimage,st.mode&0o777);fs.chownSync(tmp,st.uid,st.gid);fs.chmodSync(tmp,st.mode&0o777);fs.renameSync(tmp,TARGET);if(H(fs.readFileSync(TARGET))!==H(preimage))fail('rollback_sha_mismatch')}
function apply(id,confirmation){
  if(confirmation!==CONFIRM)fail('critical_second_confirmation_required');
  const{file,obj}=readState(id);
  if(obj.status!=='pending')fail('request_not_pending');
  if(Date.now()>Date.parse(obj.expires_at)){obj.status='expired';obj.consumed_at=new Date().toISOString();writeJson(file,obj);fail('request_expired')}
  obj.status='applying';obj.consumed_at=new Date().toISOString();writeJson(file,obj);
  const st=regular(TARGET,'state_helper'),preimage=fs.readFileSync(TARGET),next=candidate(preimage.toString('utf8'));
  if(!next.changed){
    obj.status='succeeded';obj.completed_at=new Date().toISOString();obj.evidence={ok:true,changed:false,old_sha256:TARGET_SHA,new_sha256:TARGET_SHA,rollback_performed:false,control_plane_mutation:false,production_application_mutation:false,database_mutation:false};writeJson(file,obj);console.log(JSON.stringify({ok:true,request_id:id,status:'succeeded',level:4,risk:'critical',evidence:obj.evidence,one_time_use:true}));return;
  }
  fs.mkdirSync(BACKUP_ROOT,{recursive:true,mode:0o700});fs.chmodSync(BACKUP_ROOT,0o700);
  const runDir=path.join(BACKUP_ROOT,'run-'+Date.now()+'-'+process.pid);fs.mkdirSync(runDir,{mode:0o700});
  writeFsync(path.join(runDir,'state-helper.preimage.bak'),preimage,0o600);
  let renamed=false;
  try{
    const tmp=TARGET+'.v37-'+process.pid+'-'+Date.now()+'.tmp';
    writeFsync(tmp,next.bytes,st.mode&0o777);fs.chownSync(tmp,st.uid,st.gid);fs.chmodSync(tmp,st.mode&0o777);syntax(fs.readFileSync(tmp));
    if(H(fs.readFileSync(tmp))!==TARGET_SHA)fail('candidate_tmp_sha_mismatch');
    fs.renameSync(tmp,TARGET);renamed=true;
    if(H(fs.readFileSync(TARGET))!==TARGET_SHA)fail('post_write_sha_mismatch');
    const evidence={ok:true,changed:true,old_sha256:CURRENT_SHA,new_sha256:TARGET_SHA,backup_dir:runDir,rollback_performed:false,control_plane_mutation:true,production_application_mutation:false,database_mutation:false,arbitrary_command:false,arbitrary_path:false};
    writeFsync(path.join(runDir,'result.json'),Buffer.from(JSON.stringify(evidence,null,2)+'\\n'),0o600);
    obj.status='succeeded';obj.completed_at=new Date().toISOString();obj.evidence=evidence;writeJson(file,obj);
    console.log(JSON.stringify({ok:true,request_id:id,status:'succeeded',level:4,risk:'critical',evidence,one_time_use:true}));
  }catch(error){
    let rollbackError=null;
    if(renamed){try{restore(preimage,st)}catch(e){rollbackError=String(e&&e.message||e)}}
    obj.status='failed';obj.failed_at=new Date().toISOString();obj.error=String(error&&error.message||error).slice(0,3000);obj.rollback_performed=renamed&&!rollbackError;obj.rollback_error=rollbackError;try{writeJson(file,obj)}catch{}
    if(rollbackError)fail('v37_failed_rollback_failed:'+obj.error+':'+rollbackError);
    fail('v37_failed'+(renamed?'_rolled_back':'')+':'+obj.error);
  }
}
const a=process.argv.slice(2);
try{
  if(a[0]==='preflight'&&a.length===1)preflight();
  else if(a[0]==='request'&&a.length===1)request();
  else if(a[0]==='status'&&a.length===2)status(a[1]);
  else if(a[0]==='apply'&&a.length===3)apply(a[1],a[2]);
  else fail('unexpected_arguments');
}catch(error){console.error(JSON.stringify({ok:false,error:String(error&&error.message||error)}));process.exit(1)}
`;

function parseResult(stdout){
  for(const line of String(stdout||'').trim().split(/\n+/).reverse()){
    try{const value=JSON.parse(line);if(value&&value.ok===true)return value}catch{}
  }
  fail('v37_surface_result_missing');
}

function runWorker(args,{writePaths=[],timeout=60000}={}){
  const unit='prhm-installer-refresh-v37-'+args[0]+'-'+Date.now()+'-'+process.pid;
  const cmd=['--wait','--collect','--pipe','--quiet','--unit='+unit,
    '--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true',
    '--property=PrivateTmp=true','--property=PrivateDevices=true','--property=ProtectSystem=strict',
    '--property=ProtectHome=read-only','--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true',
    '--property=ProtectControlGroups=true','--property=RestrictAddressFamilies=AF_UNIX',
    '--property=CapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_FOWNER','--property=AmbientCapabilities=',
    ...writePaths.map(p=>'--property=ReadWritePaths='+p),
    '--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    '/usr/local/bin/prhm-node','-e',WORKER,...args];
  const run=spawnSync('/usr/bin/systemd-run',cmd,{encoding:'utf8',timeout,maxBuffer:1500000});
  if(run.error||run.status!==0)fail('v37_surface_exec_failed:'+String(run.stderr||run.stdout||run.error||'').slice(-3000));
  return parseResult(run.stdout);
}

ensureBase();
const base=await import(pathToFileURL(BASE_FILE).href+'?v37-rebase='+BASE_SHA);
if(typeof base.registerSafeFilesPlugin!=='function')fail('v37_surface_base_export_missing');

export function registerSafeFilesPlugin(mcp,context){
  const result=base.registerSafeFilesPlugin(mcp,context);
  mcp.registerTool(PREFLIGHT_TOOL,{
    title:'Preflight Installer Refresh State Helper Rebase V37',
    description:'Fixed zero-input read-only validation of the exact installer-refresh L4 state-helper V37 preimage/target pair. No production application or database mutation.',
    inputSchema:{},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },async()=>textResult(runWorker(['preflight'])));

  mcp.registerTool(REQUEST_TOOL,{
    title:'Request Installer Refresh State Helper Rebase V37',
    description:'Create a fresh one-time 180-second Level-4/critical request for the exact fixed V37 state-helper rebase. No target, path, command, service, or payload input.',
    inputSchema:{},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
  },async()=>textResult(runWorker(['request'],{writePaths:[STATE_ROOT]})));

  mcp.registerTool(STATUS_TOOL,{
    title:'Installer Refresh State Helper Rebase V37 Status',
    description:'Read one fixed V37 state-helper rebase request state.',
    inputSchema:{request_id:z.string().uuid()},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },async args=>textResult(runWorker(['status',args.request_id])));

  mcp.registerTool(APPLY_TOOL,{
    title:'Apply Installer Refresh State Helper Rebase V37',
    description:'Consume one fresh pending Level-4 request and atomically replace only the exact SHA-bound installer-refresh state helper with backup and rollback.',
    inputSchema:{request_id:z.string().uuid(),second_confirmation:z.literal(CONFIRM)},
    annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}
  },async args=>textResult(runWorker(['apply',args.request_id,args.second_confirmation],{
    writePaths:[STATE_ROOT,'/opt/prhm-agent-selfmaint-exec/actions',ACTION_BACKUP_ROOT],
    timeout:180000
  })));
  return result;
}

// INSTALLER_REFRESH_STATE_HELPER_REBASE_V37_SAFEFILES_SURFACE_V1
