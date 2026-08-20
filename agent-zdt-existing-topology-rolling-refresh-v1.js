#!/usr/local/bin/prhm-node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');

const ACTION='agent_zdt_existing_topology_rolling_refresh_v1';
const PORTS=Object.freeze({
  api:Object.freeze({public:8099,blue:8100,green:8102,legacy:8110}),
  mcp:Object.freeze({public:8123,blue:8124,green:8125,legacy:8130})
});
const PATHS=Object.freeze({
  api:Object.freeze({pointer:'/var/lib/prhm-agent-zdt/api-active'}),
  mcp:Object.freeze({pointer:'/var/lib/prhm-agent-zdt/mcp-active'}),
  router:'/opt/prhm-agent-zdt/router.mjs',
  apiLauncher:'/opt/prhm-agent-zdt/api-slot-launcher.cjs',
  apiSource:'/home/agent/ssh-agent-api/server.js',
  mcpSource:'/home/agent/ssh-mcp-server/server.js',
  backupRoot:'/var/backups/prhm-agent-zdt-existing-topology-rolling-refresh-v1',
  latest:'/var/backups/prhm-agent-zdt-existing-topology-rolling-refresh-v1/latest.json'
});
const UNITS=Object.freeze({
  api:Object.freeze({router:'prhm-agent-api-router.service',blue:'prhm-agent-api-blue.service',green:'prhm-agent-api-green.service',legacy:'prhm-agent-api.service'}),
  mcp:Object.freeze({router:'prhm-agent-mcp-router.service',blue:'prhm-agent-mcp-blue.service',green:'prhm-agent-mcp-green.service',legacy:'prhm-agent-mcp.service'})
});
const EXPECTED_SHA=Object.freeze({
  [PATHS.router]:'53b904296da0e9d1490bfc7e3ef0b9c1fbad602a1e693141108f016764ebbe78',
  [PATHS.apiLauncher]:'d20793dc79ee6d0ffa2ee4bb3b4d5dc1c66750ba0e04f821acb3a45421dcb5ea',
  [PATHS.apiSource]:'70368fdc8be24646b10d414f6159502c2f3d338ed1132451d5b5740d1270999c',
  [PATHS.mcpSource]:'558ff55244f43ac60178a6fec0eddd4068223318b25308d42cdf79d92203098f'
});
const MODES=Object.freeze(['--preflight-only','--apply','--rollback','--finalize']);

function parseMode(args){if(!Array.isArray(args)||args.length!==1||!MODES.includes(args[0]))throw new Error('unexpected_arguments');return args[0];}
function lanePorts(kind){const p=PORTS[kind];if(!p)throw new Error('invalid_lane');return p;}
function candidateFor(kind,activePort){const p=lanePorts(kind);if(activePort===p.blue)return p.green;if(activePort===p.green)return p.blue;throw new Error(`active_pointer_not_blue_green:${kind}:${activePort}`);}
function slotFor(kind,port){const p=lanePorts(kind);if(port===p.blue)return'blue';if(port===p.green)return'green';throw new Error(`slot_not_blue_green:${kind}:${port}`);}
function shaFile(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function safeRegular(file){try{const s=fs.lstatSync(file);return s.isFile()&&!s.isSymbolicLink();}catch{return false;}}
function command(file,args,timeout=30000){return cp.execFileSync(file,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout}).trim();}
function systemctl(...args){return command('/usr/bin/systemctl',args,90000);}
function isActive(unit){try{return systemctl('is-active',unit)==='active';}catch{return false;}}
function isEnabled(unit){try{return systemctl('is-enabled',unit)==='enabled';}catch{return false;}}
function unitShow(unit){
  const fields=['Id','LoadState','ActiveState','SubState','UnitFileState','FragmentPath','ExecStart'];
  const out={};
  for(const field of fields){try{out[field]=systemctl('show',unit,'--property='+field,'--value');}catch{out[field]='';}}
  return out;
}
function redact(value){
  if(Array.isArray(value))return value.map(redact);
  if(value&&typeof value==='object'){const o={};for(const[k,v]of Object.entries(value)){if(/token|secret|password|credential|authorization|cookie|private[_-]?key/i.test(k))continue;o[k]=redact(v);}return o;}
  if(typeof value==='string'&&/(bearer\s+[a-z0-9._~-]{16,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i.test(value))return'[REDACTED]';
  return value;
}
function atomicBuffer(file,bytes,meta={}){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=`${file}.${process.pid}.${Date.now()}.tmp`;let fd;
  try{fd=fs.openSync(tmp,'wx',meta.mode??0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);}
  if(meta.uid!==undefined&&meta.gid!==undefined)fs.chownSync(tmp,meta.uid,meta.gid);
  if(meta.mode!==undefined)fs.chmodSync(tmp,meta.mode);
  fs.renameSync(tmp,file);let dfd;try{dfd=fs.openSync(path.dirname(file),'r');fs.fsyncSync(dfd);}finally{if(dfd!==undefined)fs.closeSync(dfd);}
}
function atomicJson(file,value){atomicBuffer(file,Buffer.from(JSON.stringify(redact(value),null,2)+'\n'),{mode:0o600});}
async function endpointOk(port,route,key){try{const r=await fetch(`http://127.0.0.1:${port}${route}`,{signal:AbortSignal.timeout(5000)});if(r.status!==200)return false;const j=await r.json();return j?.[key]===true;}catch{return false;}}
async function waitEndpoint(port,route,key){for(let i=0;i<40;i++){if(await endpointOk(port,route,key))return true;await new Promise(r=>setTimeout(r,250));}return false;}
function listeningPorts(){const text=command('/usr/sbin/ss',['-ltnp'],10000);const set=new Set();for(const line of text.split('\n')){const m=/127\.0\.0\.1:(\d+)\b/.exec(line);if(m)set.add(Number(m[1]));}return set;}
function pointerInfo(kind){
  const file=PATHS[kind].pointer;
  if(!safeRegular(file))return{regular:false,port:null,bytes:null,meta:null};
  const s=fs.lstatSync(file),bytes=fs.readFileSync(file),text=bytes.toString('utf8');
  if(!/^\d+\n?$/.test(text))return{regular:true,port:null,bytes,meta:{mode:s.mode&0o777,uid:s.uid,gid:s.gid}};
  return{regular:true,port:Number(text.trim()),bytes,meta:{mode:s.mode&0o777,uid:s.uid,gid:s.gid}};
}
function refuseMcpServiceContext(){let c='';try{c=fs.readFileSync('/proc/self/cgroup','utf8');}catch{}if(String(c).split('\n').some(line=>/(?:^|\/)prhm-agent-mcp(?:-(?:blue|green))?\.service(?:\/|$)/.test(line)))throw new Error('refuse_mcp_service_context');}

function validateLane(kind,s){
  if(!s||s.pointer_regular!==true)throw new Error(`pointer_invalid:${kind}`);
  const candidate=candidateFor(kind,s.pointer_port);
  if(s.source_sha_match!==true)throw new Error(`source_sha_mismatch:${kind}`);
  if(s.topology_match!==true)throw new Error(`topology_contract_invalid:${kind}`);
  if(s.router_active!==true||s.router_enabled!==true)throw new Error(`router_state_invalid:${kind}`);
  if(s.public_health!==true)throw new Error(`${kind}_public_health_failed`);
  if(s.public_ready!==true)throw new Error(`${kind}_public_ready_failed`);
  if(s.active_health!==true)throw new Error(`${kind}_active_health_failed`);
  if(s.active_ready!==true)throw new Error(`${kind}_active_ready_failed`);
  if(s.candidate_contract!==true)throw new Error(`candidate_contract_invalid:${kind}`);
  if(s.legacy_listening!==true)throw new Error(`legacy_listener_missing:${kind}`);
  if(s.reserved_8101_untouched!==true)throw new Error('reserved_8101_contract_failed');
  return{kind,current_backend:s.pointer_port,candidate_backend:candidate,current_slot:slotFor(kind,s.pointer_port),candidate_slot:slotFor(kind,candidate),candidate_active:s.candidate_active===true,candidate_enabled:s.candidate_enabled===true,public_health:true,public_ready:true,active_health:true,active_ready:true,legacy_listening:true,source_sha_match:true,topology_match:true};
}
async function preflight(adapter){
  const api=validateLane('api',await adapter.inspectLane('api'));
  const mcp=validateLane('mcp',await adapter.inspectLane('mcp'));
  return{ok:true,action:ACTION,schema_version:'prhm.host-action-result.v1',preflight_only:true,production_mutation:false,database_mutation:false,api, mcp,reserved_8101_untouched:true,apply_ready:true};
}

async function applyLane(kind,adapter,state){
  const pre=await adapter.captureLaneState(kind,state);let mutated=false;
  try{
    await adapter.restartCandidate(kind,pre);mutated=true;
    if(await adapter.candidateHealth(kind,pre)!==true)throw new Error(`${kind}_candidate_health_failed`);
    if(await adapter.candidateReady(kind,pre)!==true)throw new Error(`${kind}_candidate_ready_failed`);
    await adapter.assertPointerUnchanged(kind,pre);
    await adapter.switchPointer(kind,pre);
    if(await adapter.publicHealth(kind)!==true)throw new Error(`${kind}_public_health_failed`);
    if(await adapter.publicReady(kind)!==true)throw new Error(`${kind}_public_ready_failed`);
    const out=await adapter.persistLaneApply(kind,{...pre,status:'applied',previous_backend:pre.previous_backend,active_backend:pre.candidate_backend,rollback_performed:false});
    return out;
  }catch(error){
    if(mutated){
      let rb={...pre,status:'rollback_failed'};
      try{
        await adapter.restorePointer(kind,pre);
        if(await adapter.publicHealth(kind)!==true)throw new Error(`${kind}_rollback_public_health_failed`);
        if(await adapter.publicReady(kind)!==true)throw new Error(`${kind}_rollback_public_ready_failed`);
        await adapter.restoreCandidatePrestate(kind,pre);
        rb=await adapter.persistLaneRollback(kind,{...pre,status:'rolled_back',active_backend:pre.previous_backend,rollback_performed:true});
      }catch(rollbackError){error.rollback_error=String(rollbackError?.message||rollbackError);}
      error.rollback_result=rb;
    }
    throw error;
  }
}

async function runApply(adapter){
  const started_at=new Date().toISOString();
  const result={ok:false,action:ACTION,schema_version:'prhm.host-action-result.v1',preflight_only:false,production_mutation:true,database_mutation:false,started_at,finished_at:null,api:null,mcp:null,partial_success:false,rollback_performed:false,reserved_8101_untouched:true};
  const apiState=validateLane('api',await adapter.inspectLane('api'));
  try{result.api=await applyLane('api',adapter,apiState);}catch(error){result.finished_at=new Date().toISOString();result.error=String(error?.message||error);result.api=error.rollback_result||{status:'failed'};await adapter.persistResult?.(result);throw error;}
  if(await adapter.publicHealth('api')!==true||await adapter.publicReady('api')!==true)throw new Error('api_public_unstable_before_mcp');
  const mcpState=validateLane('mcp',await adapter.inspectLane('mcp'));
  try{result.mcp=await applyLane('mcp',adapter,mcpState);}catch(error){result.mcp=error.rollback_result||{status:'failed'};result.partial_success=true;result.ok=true;result.finished_at=new Date().toISOString();await adapter.persistResult?.(result);return result;}
  result.ok=true;result.finished_at=new Date().toISOString();await adapter.persistResult?.(result);return result;
}

function validEvidence(e){if(!e||e.status!=='applied'||e.finalized===true||e.rolled_back===true)throw new Error('apply_evidence_invalid');return e;}
async function runRollback(adapter){
  const e=validEvidence(await adapter.loadLatestEvidence());const out={ok:true,action:ACTION,schema_version:'prhm.host-action-result.v1',production_mutation:true,rollback_performed:true,finalized:false,api:e.api,mcp:e.mcp};
  for(const kind of ['api','mcp']){const lane=e[kind];if(!lane||lane.status!=='applied')continue;await adapter.validateRollbackLane(kind,lane);await adapter.restorePointer(kind,lane);if(await adapter.publicHealth(kind)!==true)throw new Error(`${kind}_rollback_public_health_failed`);if(await adapter.publicReady(kind)!==true)throw new Error(`${kind}_rollback_public_ready_failed`);await adapter.restoreCandidatePrestate(kind,lane);out[kind]=await adapter.persistLaneRollback(kind,{...lane,status:'rolled_back',active_backend:lane.previous_backend,rollback_performed:true});}
  out.status='rolled_back';out.rolled_back=true;await adapter.persistResult?.(out);return out;
}
async function runFinalize(adapter){
  const e=validEvidence(await adapter.loadLatestEvidence());const out={ok:true,action:ACTION,schema_version:'prhm.host-action-result.v1',production_mutation:true,rollback_performed:false,finalized:true,api:e.api,mcp:e.mcp};
  for(const kind of ['api','mcp']){const lane=e[kind];if(!lane||lane.status!=='applied')continue;await adapter.validateFinalizeLane(kind,lane);if(await adapter.publicHealth(kind)!==true||await adapter.publicReady(kind)!==true)throw new Error(`${kind}_finalize_public_health_failed`);await adapter.enableActive(kind,lane);await adapter.disableOld(kind,lane);if(await adapter.publicHealth(kind)!==true||await adapter.publicReady(kind)!==true)throw new Error(`${kind}_finalize_public_health_failed_after_enablement`);out[kind]=await adapter.persistFinalize(kind,{...lane,status:'finalized',finalized:true,old_backend_still_running:true});}
  out.status='finalized';await adapter.persistResult?.(out);return out;
}

class ProductionAdapter{
  constructor(){this.pre={};}
  async inspectLane(kind){
    refuseMcpServiceContext();const p=lanePorts(kind),ptr=pointerInfo(kind),units=UNITS[kind],router=unitShow(units.router),blue=unitShow(units.blue),green=unitShow(units.green),ports=listeningPorts();
    let active=null,candidate=null;try{active=ptr.port;candidate=candidateFor(kind,active);}catch{}
    const activeSlot=active===p.blue?'blue':active===p.green?'green':null,candidateSlot=candidate===p.blue?'blue':candidate===p.green?'green':null;
    const backendContract=(u,name)=>u.Id===name&&u.LoadState==='loaded'&&String(u.ExecStart||'').includes('/usr/local/bin/prhm-node')&&(kind==='api'?String(u.ExecStart||'').includes(PATHS.apiLauncher):String(u.ExecStart||'').includes(PATHS.mcpSource));
    const topology_match=router.Id===units.router&&router.LoadState==='loaded'&&String(router.ExecStart||'').includes(PATHS.router)&&backendContract(blue,units.blue)&&backendContract(green,units.green);
    const sourceFiles=kind==='api'?[PATHS.router,PATHS.apiLauncher,PATHS.apiSource]:[PATHS.router,PATHS.mcpSource];
    const source_sha_match=sourceFiles.every(f=>safeRegular(f)&&shaFile(f)===EXPECTED_SHA[f]);
    return{kind,pointer_regular:ptr.regular,pointer_port:ptr.port,router_active:router.ActiveState==='active'&&router.SubState==='running',router_enabled:router.UnitFileState==='enabled',topology_match,source_sha_match,public_health:await endpointOk(p.public,'/health','ok'),public_ready:await endpointOk(p.public,'/ready','ready'),active_health:active?await endpointOk(active,'/health','ok'):false,active_ready:active?await endpointOk(active,'/ready','ready'):false,candidate_active:candidateSlot?isActive(units[candidateSlot]):false,candidate_enabled:candidateSlot?isEnabled(units[candidateSlot]):false,candidate_contract:candidateSlot?backendContract(candidateSlot==='blue'?blue:green,units[candidateSlot]):false,legacy_listening:ports.has(p.legacy),reserved_8101_untouched:![p.public,p.blue,p.green,p.legacy].includes(8101)};
  }
  async captureLaneState(kind,state){
    const ptr=pointerInfo(kind);if(!ptr.regular||ptr.port!==state.current_backend)throw new Error(`pointer_prestate_changed:${kind}`);const candidate=state.candidate_backend,slot=slotFor(kind,candidate),stamp=new Date().toISOString().replace(/[:.]/g,'-'),dir=path.join(PATHS.backupRoot,stamp,kind);fs.mkdirSync(dir,{recursive:true,mode:0o700});const pointerBackup=path.join(dir,'pointer.before');atomicBuffer(pointerBackup,ptr.bytes,{mode:0o600});const pre={kind,backup_path:dir,pointer_backup:pointerBackup,pointer_mode:ptr.meta.mode,pointer_uid:ptr.meta.uid,pointer_gid:ptr.meta.gid,previous_backend:state.current_backend,candidate_backend:candidate,candidate_slot:slot,candidate_pre_active:isActive(UNITS[kind][slot]),candidate_pre_enabled:isEnabled(UNITS[kind][slot]),captured_at:new Date().toISOString()};atomicJson(path.join(dir,'pre-state.json'),pre);this.pre[kind]=pre;return pre;
  }
  async restartCandidate(kind,pre){systemctl('restart',UNITS[kind][pre.candidate_slot]);}
  async candidateHealth(kind,pre){return waitEndpoint(pre.candidate_backend,'/health','ok');}
  async candidateReady(kind,pre){return waitEndpoint(pre.candidate_backend,'/ready','ready');}
  async assertPointerUnchanged(kind,pre){const ptr=pointerInfo(kind);if(!ptr.regular||ptr.port!==pre.previous_backend)throw new Error('pointer_changed_before_cutover');return true;}
  async switchPointer(kind,pre){const ptr=pointerInfo(kind);if(!ptr.regular||ptr.port!==pre.previous_backend)throw new Error('pointer_changed_before_cutover');atomicBuffer(PATHS[kind].pointer,Buffer.from(String(pre.candidate_backend)+'\n'),ptr.meta);}
  async publicHealth(kind){return waitEndpoint(PORTS[kind].public,'/health','ok');}
  async publicReady(kind){return waitEndpoint(PORTS[kind].public,'/ready','ready');}
  async persistLaneApply(kind,e){const out={...e,status:'applied',applied_at:new Date().toISOString()};atomicJson(path.join(e.backup_path,'apply-result.json'),out);return out;}
  async restorePointer(kind,e){if(!e.pointer_backup||!safeRegular(e.pointer_backup))throw new Error('pointer_backup_missing');atomicBuffer(PATHS[kind].pointer,fs.readFileSync(e.pointer_backup),{mode:e.pointer_mode,uid:e.pointer_uid,gid:e.pointer_gid});}
  async restoreCandidatePrestate(kind,e){const unit=UNITS[kind][e.candidate_slot||slotFor(kind,e.candidate_backend)];try{systemctl(e.candidate_pre_active?'start':'stop',unit);}catch{}try{systemctl(e.candidate_pre_enabled?'enable':'disable',unit);}catch{}}
  async persistLaneRollback(kind,e){const out={...e,status:'rolled_back',rolled_back_at:new Date().toISOString(),rollback_performed:true};atomicJson(path.join(e.backup_path,'rollback-result.json'),out);return out;}
  async persistResult(result){fs.mkdirSync(PATHS.backupRoot,{recursive:true,mode:0o700});atomicJson(PATHS.latest,result);}
  async loadLatestEvidence(){if(!safeRegular(PATHS.latest))throw new Error('apply_evidence_missing');return JSON.parse(fs.readFileSync(PATHS.latest,'utf8'));}
  async validateRollbackLane(kind,e){if(e.status!=='applied'||e.finalized===true||e.rollback_performed===true)throw new Error(`rollback_evidence_invalid:${kind}`);const ptr=pointerInfo(kind);if(!ptr.regular||ptr.port!==e.active_backend)throw new Error(`rollback_pointer_drift:${kind}`);return e;}
  async validateFinalizeLane(kind,e){if(e.status!=='applied'||e.finalized===true||e.rollback_performed===true)throw new Error(`finalize_evidence_invalid:${kind}`);const ptr=pointerInfo(kind);if(!ptr.regular||ptr.port!==e.active_backend)throw new Error(`finalize_pointer_drift:${kind}`);if(!await endpointOk(e.active_backend,'/health','ok')||!await endpointOk(e.active_backend,'/ready','ready'))throw new Error(`finalize_candidate_unhealthy:${kind}`);return e;}
  async enableActive(kind,e){systemctl('enable',UNITS[kind][slotFor(kind,e.active_backend)]);}
  async disableOld(kind,e){systemctl('disable',UNITS[kind][slotFor(kind,e.previous_backend)]);}
  async persistFinalize(kind,e){const out={...e,status:'finalized',finalized:true,finalized_at:new Date().toISOString(),old_backend_still_running:true};atomicJson(path.join(e.backup_path,'finalize-result.json'),out);return out;}
}

async function main(){refuseMcpServiceContext();const mode=parseMode(process.argv.slice(2)),adapter=new ProductionAdapter();let result;if(mode==='--preflight-only')result=await preflight(adapter);else if(mode==='--apply')result=await runApply(adapter);else if(mode==='--rollback')result=await runRollback(adapter);else result=await runFinalize(adapter);console.log(JSON.stringify(redact(result)));}

module.exports={ACTION,PORTS,PATHS,UNITS,EXPECTED_SHA,parseMode,candidateFor,slotFor,validateLane,preflight,applyLane,runApply,runRollback,runFinalize,ProductionAdapter,redact,atomicBuffer,refuseMcpServiceContext};
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({ok:false,action:ACTION,error:String(error?.message||error),rollback_error:error?.rollback_error||null}));process.exit(1);});
