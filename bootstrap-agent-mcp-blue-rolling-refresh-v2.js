#!/usr/local/bin/prhm-node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');

const ACTION='agent_mcp_blue_rolling_refresh_v2';
const PORTS=Object.freeze({public:8123,blue:8124,green:8125,legacy:8130});
const PATHS=Object.freeze({
  pointer:'/var/lib/prhm-agent-zdt/mcp-active',
  source:'/home/agent/ssh-mcp-server/server.js',
  safeFiles:'/home/agent/ssh-mcp-server/src/plugins/safeFiles.js',
  router:'/opt/prhm-agent-zdt/router.mjs',
  backupRoot:'/var/backups/prhm-agent-mcp-blue-rolling-refresh-v2',
  latest:'/var/backups/prhm-agent-mcp-blue-rolling-refresh-v2/latest.json'
});
const UNITS=Object.freeze({
  router:'prhm-agent-mcp-router.service',
  blue:'prhm-agent-mcp-blue.service',
  green:'prhm-agent-mcp-green.service'
});
const EXPECTED_SHA=Object.freeze({
  [PATHS.source]:'558ff55244f43ac60178a6fec0eddd4068223318b25308d42cdf79d92203098f',
  [PATHS.router]:'53b904296da0e9d1490bfc7e3ef0b9c1fbad602a1e693141108f016764ebbe78'
});
const SAFEFILES_SHA=Object.freeze({
  v4:'22dfb51356b3a89d0b6150b6e67e10ebc5464fb66cb67c9e2a75cb6d2e521481',
  v4_1:'2f4cedb73d58bff927e09e8d0b534a08cf49f08b3e5da54f47900f57d8a5f910'
});
const MODES=Object.freeze(['--preflight-only','--apply','--rollback','--finalize']);

function parseMode(args){if(!Array.isArray(args)||args.length!==1||!MODES.includes(args[0]))throw new Error('unexpected_arguments');return args[0];}
function shaFile(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function safeRegular(file){const s=fs.lstatSync(file);return s.isFile()&&!s.isSymbolicLink();}
function command(file,args,timeout=30000){return cp.execFileSync(file,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout,maxBuffer:262144}).trim();}
function systemctl(...args){return command('/usr/bin/systemctl',args,90000);}
function isActive(unit){try{return systemctl('is-active',unit)==='active';}catch{return false;}}
function isEnabled(unit){try{return systemctl('is-enabled',unit)==='enabled';}catch{return false;}}
function ensureDir(dir,mode=0o700){
  if(fs.existsSync(dir)){const s=fs.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink())throw new Error('unsafe_directory:'+dir);return;}
  fs.mkdirSync(dir,{recursive:true,mode});
}
function fsyncDir(dir){let fd;try{fd=fs.openSync(dir,'r');fs.fsyncSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);}}
function atomicBuffer(file,bytes,meta={}){
  ensureDir(path.dirname(file),0o700);
  const mode=meta.mode===undefined?0o600:meta.mode;
  const tmp=`${file}.${process.pid}.${Date.now()}.tmp`;
  let fd;
  try{
    fd=fs.openSync(tmp,'wx',mode);
    if(Number.isInteger(meta.uid)&&Number.isInteger(meta.gid))fs.fchownSync(fd,meta.uid,meta.gid);
    fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
  }finally{if(fd!==undefined)fs.closeSync(fd);}
  fs.renameSync(tmp,file);fsyncDir(path.dirname(file));
}
function atomicJson(file,value){atomicBuffer(file,Buffer.from(JSON.stringify(redactEvidence(value))+'\n'),{mode:0o600});}
function redactEvidence(value){
  if(Array.isArray(value))return value.map(redactEvidence);
  if(value&&typeof value==='object'){
    const out={};
    for(const [k,v] of Object.entries(value)){
      if(/token|secret|password|credential|private[_-]?key|authorization|cookie|dsn/i.test(k))continue;
      out[k]=redactEvidence(v);
    }
    return out;
  }
  if(typeof value==='string'&&/(bearer\s+[A-Za-z0-9._~-]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i.test(value))return '[REDACTED]';
  return value;
}
function refuseMcpServiceContext(){
  let cgroup='';try{cgroup=fs.readFileSync('/proc/self/cgroup','utf8');}catch{}
  if(String(cgroup).split('\n').some(line=>/(?:^|\/)prhm-agent-mcp(?:-(?:blue|green))?\.service(?:\/|$)/.test(line)))throw new Error('refuse_mcp_service_context');
}
function unitShow(unit){
  const text=command('/usr/bin/systemctl',['show',unit,'--no-pager','-p','Id','-p','LoadState','-p','ActiveState','-p','SubState','-p','UnitFileState','-p','ExecStart','-p','WorkingDirectory'],30000);
  const out={};for(const line of text.split('\n')){const i=line.indexOf('=');if(i>0)out[line.slice(0,i)]=line.slice(i+1);}return out;
}
function listenerPorts(){
  const text=command('/usr/sbin/ss',['-H','-ltnp'],10000);const ports=new Set();
  for(const line of text.split('\n')){const m=/127\.0\.0\.1:(\d+)\b/.exec(line);if(m)ports.add(Number(m[1]));}
  return ports;
}
async function endpointOk(port,pathname,field){
  try{const r=await fetch(`http://127.0.0.1:${port}${pathname}`,{signal:AbortSignal.timeout(5000)});if(r.status!==200)return false;const body=await r.json();return body&&body[field]===true;}catch{return false;}
}
async function waitEndpoint(port,pathname,field){for(let i=0;i<40;i++){if(await endpointOk(port,pathname,field))return true;await new Promise(r=>setTimeout(r,250));}return false;}
function coreShaMatch(){for(const [file,sha] of Object.entries(EXPECTED_SHA)){if(!fs.existsSync(file)||!safeRegular(file)||shaFile(file)!==sha)return false;}return true;}
function safeFilesSha(){if(!fs.existsSync(PATHS.safeFiles)||!safeRegular(PATHS.safeFiles))return null;return shaFile(PATHS.safeFiles);}
function sourceReadyV41(){return coreShaMatch()&&safeFilesSha()===SAFEFILES_SHA.v4_1;}
function pointerInfo(){
  if(!fs.existsSync(PATHS.pointer))return{regular:false,blue:false,green:false,bytes:null,meta:null};
  const s=fs.lstatSync(PATHS.pointer);if(!s.isFile()||s.isSymbolicLink())return{regular:false,blue:false,green:false,bytes:null,meta:null};
  const bytes=fs.readFileSync(PATHS.pointer);const text=bytes.toString('utf8');
  return{regular:true,blue:/^8124\n?$/.test(text),green:/^8125\n?$/.test(text),bytes,meta:{mode:s.mode&0o777,uid:s.uid,gid:s.gid}};
}
function topologyContract(){
  const router=unitShow(UNITS.router),blue=unitShow(UNITS.blue),green=unitShow(UNITS.green);
  const routerContract=router.Id===UNITS.router&&router.LoadState==='loaded'&&String(router.ExecStart||'').includes('/usr/local/bin/prhm-node')&&String(router.ExecStart||'').includes('/opt/prhm-agent-zdt/router.mjs');
  const backend=(u,name)=>u.Id===name&&u.LoadState==='loaded'&&u.WorkingDirectory==='/home/agent/ssh-mcp-server'&&String(u.ExecStart||'').includes('/usr/local/bin/prhm-node')&&String(u.ExecStart||'').includes('/home/agent/ssh-mcp-server/server.js');
  return{match:routerContract&&backend(blue,UNITS.blue)&&backend(green,UNITS.green),router,blue,green};
}
async function inspectProduction(){
  refuseMcpServiceContext();
  if(process.getuid&&process.getuid()!==0)throw new Error('must_run_as_root');
  const hostname=command('/usr/bin/hostname',['-f']);
  const topo=topologyContract();const ports=listenerPorts();const ptr=pointerInfo();
  const deps=['/usr/local/bin/prhm-node','/usr/bin/systemctl','/usr/sbin/ss','/usr/bin/df'].every(fs.existsSync);
  const avail=Number(command('/usr/bin/df',['--output=avail','-k','/var']).split(/\s+/).at(-1));
  return{
    hostname,
    server_sha_match:fs.existsSync(PATHS.source)&&safeRegular(PATHS.source)&&shaFile(PATHS.source)===EXPECTED_SHA[PATHS.source],
    router_sha_match:fs.existsSync(PATHS.router)&&safeRegular(PATHS.router)&&shaFile(PATHS.router)===EXPECTED_SHA[PATHS.router],
    safe_files_sha:safeFilesSha(),
    topology_match:topo.match,
    router_active:topo.router.ActiveState==='active'&&topo.router.SubState==='running',
    router_enabled:topo.router.UnitFileState==='enabled',
    blue_active:topo.blue.ActiveState==='active'&&topo.blue.SubState==='running',
    blue_enabled:topo.blue.UnitFileState==='enabled',
    green_active:topo.green.ActiveState==='active'&&topo.green.SubState==='running',
    green_disabled:topo.green.UnitFileState==='disabled',
    public_health:await endpointOk(PORTS.public,'/health','ok'),
    public_ready:await endpointOk(PORTS.public,'/ready','ready'),
    blue_health:await endpointOk(PORTS.blue,'/health','ok'),
    blue_ready:await endpointOk(PORTS.blue,'/ready','ready'),
    green_health:await endpointOk(PORTS.green,'/health','ok'),
    green_ready:await endpointOk(PORTS.green,'/ready','ready'),
    legacy_listening:ports.has(PORTS.legacy),
    pointer_regular:ptr.regular,
    pointer_green:ptr.green,
    disk_enough:Number.isFinite(avail)&&avail>131072,
    dependencies:deps
  };
}
function validatePreflightState(s){
  if(!['prhm-production.prhm.ir','prhm-production'].includes(s.hostname))throw new Error('hostname_mismatch');
  if(s.server_sha_match!==true||s.router_sha_match!==true)throw new Error('source_sha_mismatch');
  if(![SAFEFILES_SHA.v4,SAFEFILES_SHA.v4_1].includes(s.safe_files_sha))throw new Error('safe_files_sha_mismatch');
  if(s.topology_match!==true)throw new Error('topology_mismatch');
  if(s.router_active!==true||s.router_enabled!==true)throw new Error('router_state_invalid');
  if(s.blue_active!==true||s.blue_enabled!==true)throw new Error('blue_state_invalid');
  if(s.green_active!==true||s.green_disabled!==true)throw new Error('green_state_invalid');
  if(s.public_health!==true||s.public_ready!==true)throw new Error('public_health_failed');
  if(s.blue_health!==true||s.blue_ready!==true)throw new Error('blue_health_failed');
  if(s.green_health!==true||s.green_ready!==true)throw new Error('green_health_failed');
  if(s.legacy_listening!==true)throw new Error('legacy_listener_missing');
  if(s.pointer_regular!==true)throw new Error('pointer_not_regular');
  if(s.pointer_green!==true)throw new Error('pointer_not_green');
  if(s.disk_enough!==true)throw new Error('insufficient_disk');
  if(s.dependencies!==true)throw new Error('dependencies_missing');
}
async function preflight(adapter){
  const s=await adapter.inspect();validatePreflightState(s);
  const ready=s.safe_files_sha===SAFEFILES_SHA.v4_1;
  return{ok:true,action:ACTION,preflight_only:true,production_mutation:false,database_mutation:false,api_mutation:false,router_restart_reload:false,green_restart_stop:false,current_backend:PORTS.green,candidate_backend:PORTS.blue,source_state:ready?'v4_1_ready':'v4_prepatch',source_patch_required:!ready,apply_ready:ready,topology_match:true,public_health:true,blue_health:true,green_health:true};
}
async function runApply(adapter){
  const gate=await preflight(adapter);if(gate.apply_ready!==true)throw new Error('source_v4_1_not_ready');let pre=null;let mutated=false;
  try{
    pre=await adapter.captureApplyState();
    await adapter.restartBlue();mutated=true;
    if(await adapter.healthBlue()!==true)throw new Error('blue_health_failed');
    if(await adapter.readyBlue()!==true)throw new Error('blue_ready_failed');
    await adapter.switchToBlue();
    if(await adapter.healthPublic()!==true)throw new Error('public_health_failed');
    if(await adapter.readyPublic()!==true)throw new Error('public_ready_failed');
    const out={ok:true,action:ACTION,preflight_only:false,production_mutation:true,database_mutation:false,api_mutation:false,router_restart_reload:false,green_restart_stop:false,previous_backend:PORTS.green,active_backend:PORTS.blue,blue_restarted:true,public_health:true,rollback_performed:false,backup_path:pre.backup_path};
    await adapter.persistApply(out,pre);return out;
  }catch(error){
    if(mutated){try{await adapter.restoreApplyState(pre);}catch(rollbackError){error.rollback_error=String(rollbackError?.message||rollbackError);}}
    try{await adapter.persistApplyFailure({ok:false,action:ACTION,error:String(error?.message||error),rollback_performed:mutated},pre);}catch{}
    throw error;
  }
}
function validApplyEvidence(e){return e&&e.status==='applied'&&e.active_backend===PORTS.blue&&e.previous_backend===PORTS.green&&e.finalized!==true&&e.rolled_back!==true;}
async function runRollback(adapter){
  const e=await adapter.loadLatestApplyEvidence();if(!validApplyEvidence(e))throw new Error('apply_evidence_invalid');
  if(await adapter.verifyRollbackState(e)!==true)throw new Error('rollback_state_mismatch');
  await adapter.restorePointerFromEvidence(e);
  if(await adapter.healthPublic()!==true)throw new Error('rollback_public_health_failed');
  if(await adapter.readyPublic()!==true)throw new Error('rollback_public_ready_failed');
  await adapter.restoreBluePrestate(e);
  const out={ok:true,action:ACTION,production_mutation:true,database_mutation:false,api_mutation:false,active_backend:PORTS.green,rollback_performed:true,finalized:false};
  await adapter.persistRollback(out,e);return out;
}
async function runFinalize(adapter){
  const e=await adapter.loadLatestApplyEvidence();if(!validApplyEvidence(e))throw new Error('apply_evidence_invalid');
  if(await adapter.verifyFinalizeState(e)!==true)throw new Error('finalize_state_mismatch');
  if(await adapter.healthPublic()!==true)throw new Error('finalize_public_health_failed');
  if(await adapter.readyPublic()!==true)throw new Error('finalize_public_ready_failed');
  await adapter.enableBlue();await adapter.disableGreen();
  if(await adapter.healthPublic()!==true)throw new Error('finalize_public_health_failed_after_enablement');
  if(await adapter.readyPublic()!==true)throw new Error('finalize_public_ready_failed_after_enablement');
  const out={ok:true,action:ACTION,production_mutation:true,database_mutation:false,api_mutation:false,active_backend:PORTS.blue,rollback_performed:false,finalized:true,green_still_running:true};
  await adapter.persistFinalize(out,e);return out;
}

class ProductionAdapter{
  constructor(){this.applyState=null;}
  async inspect(){return inspectProduction();}
  async captureApplyState(){
    ensureDir(PATHS.backupRoot,0o700);
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');const dir=path.join(PATHS.backupRoot,stamp);ensureDir(dir,0o700);
    const ptr=pointerInfo();if(!ptr.regular||!ptr.green)throw new Error('pointer_prestate_changed');
    const bluePreActive=isActive(UNITS.blue),bluePreEnabled=isEnabled(UNITS.blue);
    const before=path.join(dir,'mcp-active.before');atomicBuffer(before,ptr.bytes,{mode:0o600});
    const state={backup_path:dir,pointer_backup:before,pointer_mode:ptr.meta.mode,pointer_uid:ptr.meta.uid,pointer_gid:ptr.meta.gid,blue_pre_active:bluePreActive,blue_pre_enabled:bluePreEnabled,previous_backend:PORTS.green,source_sha:{...Object.fromEntries(Object.entries(EXPECTED_SHA).map(([f])=>[f,shaFile(f)])),[PATHS.safeFiles]:safeFilesSha()}};
    atomicJson(path.join(dir,'pre-state.json'),state);this.applyState=state;return state;
  }
  async restartBlue(){systemctl('restart',UNITS.blue);}
  async healthBlue(){return waitEndpoint(PORTS.blue,'/health','ok');}
  async readyBlue(){return waitEndpoint(PORTS.blue,'/ready','ready');}
  async switchToBlue(){const ptr=pointerInfo();if(!ptr.regular||!ptr.green)throw new Error('pointer_changed_before_cutover');atomicBuffer(PATHS.pointer,Buffer.from('8124\n'),ptr.meta);}
  async healthPublic(){return waitEndpoint(PORTS.public,'/health','ok');}
  async readyPublic(){return waitEndpoint(PORTS.public,'/ready','ready');}
  async persistApply(out,pre){
    const record={status:'applied',action:ACTION,backup_path:pre.backup_path,pointer_backup:pre.pointer_backup,pointer_mode:pre.pointer_mode,pointer_uid:pre.pointer_uid,pointer_gid:pre.pointer_gid,blue_pre_active:pre.blue_pre_active,blue_pre_enabled:pre.blue_pre_enabled,previous_backend:PORTS.green,active_backend:PORTS.blue,finalized:false,rolled_back:false,applied_at:new Date().toISOString(),result:redactEvidence(out)};
    atomicJson(path.join(pre.backup_path,'apply-result.json'),record);atomicJson(PATHS.latest,record);
  }
  async restoreApplyState(pre){
    if(!pre||!pre.pointer_backup||!safeRegular(pre.pointer_backup))throw new Error('rollback_prestate_missing');
    const bytes=fs.readFileSync(pre.pointer_backup);atomicBuffer(PATHS.pointer,bytes,{mode:pre.pointer_mode,uid:pre.pointer_uid,gid:pre.pointer_gid});
    try{systemctl(pre.blue_pre_enabled===true?'enable':'disable',UNITS.blue);}catch{}
    try{systemctl(pre.blue_pre_active===true?'start':'stop',UNITS.blue);}catch{}
    if(!await waitEndpoint(PORTS.public,'/health','ok'))throw new Error('automatic_rollback_public_health_failed');
  }
  async persistApplyFailure(out,pre){if(pre?.backup_path)atomicJson(path.join(pre.backup_path,'apply-failure.json'),out);}
  async loadLatestApplyEvidence(){if(!fs.existsSync(PATHS.latest)||!safeRegular(PATHS.latest))throw new Error('apply_evidence_missing');return JSON.parse(fs.readFileSync(PATHS.latest,'utf8'));}
  async verifyRollbackState(e){
    if(!sourceReadyV41())return false;const ptr=pointerInfo();if(!ptr.regular||!ptr.blue)return false;
    if(!e.pointer_backup||!fs.existsSync(e.pointer_backup)||!safeRegular(e.pointer_backup))return false;
    return isActive(UNITS.router)&&isActive(UNITS.blue)&&isActive(UNITS.green);
  }
  async restorePointerFromEvidence(e){const bytes=fs.readFileSync(e.pointer_backup);atomicBuffer(PATHS.pointer,bytes,{mode:e.pointer_mode,uid:e.pointer_uid,gid:e.pointer_gid});}
  async restoreBluePrestate(e){try{systemctl(e.blue_pre_enabled===true?'enable':'disable',UNITS.blue);}catch{};try{systemctl(e.blue_pre_active===true?'start':'stop',UNITS.blue);}catch{};}
  async persistRollback(out,e){const next={...e,status:'rolled_back',active_backend:PORTS.green,rolled_back:true,finalized:false,rolled_back_at:new Date().toISOString(),rollback_result:redactEvidence(out)};atomicJson(path.join(e.backup_path,'rollback-result.json'),next);atomicJson(PATHS.latest,next);}
  async verifyFinalizeState(){const ptr=pointerInfo();return sourceReadyV41()&&ptr.regular&&ptr.blue&&isActive(UNITS.router)&&isActive(UNITS.blue)&&isActive(UNITS.green)&&await endpointOk(PORTS.blue,'/health','ok')&&await endpointOk(PORTS.blue,'/ready','ready');}
  async enableBlue(){systemctl('enable',UNITS.blue);}
  async disableGreen(){systemctl('disable',UNITS.green);}
  async persistFinalize(out,e){const next={...e,status:'finalized',active_backend:PORTS.blue,finalized:true,rolled_back:false,finalized_at:new Date().toISOString(),finalize_result:redactEvidence(out)};atomicJson(path.join(e.backup_path,'finalize-result.json'),next);atomicJson(PATHS.latest,next);}
}

async function main(){
  refuseMcpServiceContext();const mode=parseMode(process.argv.slice(2));const adapter=new ProductionAdapter();let result;
  if(mode==='--preflight-only')result=await preflight(adapter);
  else if(mode==='--apply')result=await runApply(adapter);
  else if(mode==='--rollback')result=await runRollback(adapter);
  else result=await runFinalize(adapter);
  console.log(JSON.stringify(redactEvidence(result)));
}

module.exports={ACTION,PORTS,PATHS,UNITS,EXPECTED_SHA,SAFEFILES_SHA,parseMode,redactEvidence,preflight,runApply,runRollback,runFinalize,ProductionAdapter};
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({ok:false,action:ACTION,error:String(error?.message||error),rollback_error:error?.rollback_error||null}));process.exit(1);});
