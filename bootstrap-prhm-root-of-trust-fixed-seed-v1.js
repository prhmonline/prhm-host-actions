#!/usr/local/bin/prhm-node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const http = require('node:http');

const ACTION = 'control_plane_root_scripts_stage_transport_v1';
const OPERATION = 'host_action.control_plane_root_scripts_stage_transport_v1';
const VERSION = 'prhm-root-of-trust-fixed-seed-v1';
const POLICY_VERSION = '2026-08-25.1-control-plane-root-scripts-stage-transport-v1';
const RUNTIME_INPUTS = Object.freeze([]);
const PATHS = Object.freeze({
  base: '/opt/prhm-agent-selfmaint/server.js',
  executor: '/opt/prhm-agent-selfmaint-exec/server.js',
  policy: '/opt/prhm-company-control-plane/config/approval-policy.json',
  transport: '/home/agent/ssh-agent-api/control-plane-root-scripts-stage-transport-v1.js'
});
const BASELINE_SHA = Object.freeze({
  base: 'e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd',
  executor: '1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd',
  policy: '76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d'
});
const TRANSPORT_HELPER_SHA = 'c64d2fb4c2ae2b048f7f57f6a5e4923588b76ae8a134a540e791b03285ff4d87';
const BACKUP_ROOT = '/var/backups/prhm-root-of-trust-fixed-seed-v1';
const SERVICE_BY_LAYER = Object.freeze({base:'prhm-agent-selfmaint.service',executor:'prhm-agent-selfmaint-exec.service'});

const BASE_ANCHOR = "  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' }";
const BASE_ENTRY = "  control_plane_root_scripts_stage_transport_v1: { operation: 'host_action.control_plane_root_scripts_stage_transport_v1', rollback: 'host-action-v2:control-plane-root-scripts-stage-transport-v1:registration-only' },";
const EXEC_SPEC_ANCHOR = "  imotion_credential_bind_v1:{operation:'host_action.imotion_credential_bind_v1',kind:'imotion_credential_bind_v1'}";
const EXEC_SPEC_ENTRY = "  control_plane_root_scripts_stage_transport_v1:{operation:'host_action.control_plane_root_scripts_stage_transport_v1',kind:'control_plane_root_scripts_stage_transport_v1'},";
const DISPATCH_ANCHOR = "applyHostActionV2=async function(action){if(action==='imotion_credential_bind_v1')return applyImotionCredentialBindV1();";
const DISPATCH_ENTRY = "applyHostActionV2=async function(action){if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();if(action==='imotion_credential_bind_v1')return applyImotionCredentialBindV1();";
const EXEC_APPLY_MARKER = 'function applyControlPlaneRootScriptsStageTransportV1()';

function fail(code){ throw new Error(code); }
function sha(value){ return crypto.createHash('sha256').update(value).digest('hex'); }
function count(source, needle){ return String(source).split(needle).length - 1; }
function unique(source, needle, missing, duplicate){
  const n=count(source,needle);
  if(n===0) fail(missing);
  if(n!==1) fail(duplicate);
  return true;
}
function samePrincipalScope(x, tool){
  return Boolean(x && x.tool===tool && x.project==='control_plane' && x.environment==='production' && x.action===ACTION && x.risk==='critical' && x.operation===OPERATION && Array.isArray(x.principals) && x.principals.length===1 && x.principals[0]?.principal_id==='mohammad' && Array.isArray(x.principals[0]?.roles) && x.principals[0].roles.length===1 && x.principals[0].roles[0]==='mcp-operator');
}
function targetPolicyState(policy){
  if(!policy || typeof policy!=='object' || Array.isArray(policy) || !policy.operations || typeof policy.operations!=='object' || !Array.isArray(policy.typed_scopes)) fail('policy_shape_invalid');
  const operation=policy.operations[OPERATION];
  if(operation!==undefined && !(operation && operation.level===4 && Object.keys(operation).length===1)) fail('conflicting_existing_registration');
  const targetScopes=policy.typed_scopes.filter(x=>x && x.action===ACTION);
  for(const scope of targetScopes){
    if(scope.tool==='control_plane_root_scripts_stage_transport_apply_v1'){
      if(!samePrincipalScope(scope,'control_plane_root_scripts_stage_transport_apply_v1')) fail('conflicting_existing_registration');
    }else if(scope.tool==='host_action_v2_apply'){
      if(!samePrincipalScope(scope,'host_action_v2_apply')) fail('conflicting_existing_registration');
    }else fail('conflicting_existing_registration');
  }
  return {
    operationExact: operation!==undefined,
    actionSpecificExact: targetScopes.some(x=>samePrincipalScope(x,'control_plane_root_scripts_stage_transport_apply_v1')),
    hostV2Exact: targetScopes.some(x=>samePrincipalScope(x,'host_action_v2_apply'))
  };
}
function executorApplyBlock(){
  return `\nfunction applyControlPlaneRootScriptsStageTransportV1(){\n  const helper='${PATHS.transport}';\n  const bytes=fs.readFileSync(helper);\n  const helperSha=require('node:crypto').createHash('sha256').update(bytes).digest('hex');\n  if(helperSha!=='${TRANSPORT_HELPER_SHA}')throw new Error('transport_helper_sha_mismatch');\n  const raw=cp.execFileSync('/usr/local/bin/prhm-node',[helper,'--apply'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000,maxBuffer:400000,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/nonexistent'}}).trim();\n  let transport;try{transport=JSON.parse(raw)}catch{throw new Error('transport_result_invalid_json')}\n  if(!transport||transport.ok!==true||transport.schema_version!=='prhm.root-scripts-stage-transport-result.v1'||transport.action!=='${ACTION}'||transport.database_mutation!==false||transport.status!=='succeeded')throw new Error('transport_result_invalid');\n  return {ok:true,schema_version:'prhm.host-action-result.v1',action:'${ACTION}',production_mutation:transport.production_mutation===true,database_mutation:false,rollback_performed:transport.rollback_performed===true,transport_status:transport.status,old_sha256:transport.old_sha256,new_sha256:transport.new_sha256};\n}\n`;
}
function baseState(source){
  const has=source.includes(BASE_ENTRY);
  const mentions=count(source,ACTION);
  if(has && mentions===2) return 'exact';
  if(mentions!==0) fail('conflicting_existing_registration');
  return 'absent';
}
function executorState(source){
  const exactSpec=source.includes(EXEC_SPEC_ENTRY);
  const exactDispatch=source.includes("if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();");
  const exactApply=source.includes(EXEC_APPLY_MARKER);
  const mentions=count(source,ACTION);
  if(exactSpec && exactDispatch && exactApply && mentions>=4) return 'exact';
  if(mentions!==0) fail('conflicting_existing_registration');
  return 'absent';
}
function patchBase(source){
  if(baseState(source)==='exact') return source;
  unique(source,'imotion_credential_bind_v1:','base_imotion_anchor_missing','base_imotion_anchor_duplicate');
  if(count(source,BASE_ANCHOR)!==1) fail('base_imotion_anchor_shape_invalid');
  return source.replace(BASE_ANCHOR,BASE_ENTRY+'\n'+BASE_ANCHOR);
}
function patchExecutor(source){
  if(executorState(source)==='exact') return source;
  unique(source,EXEC_SPEC_ANCHOR,'executor_imotion_spec_anchor_missing','executor_imotion_spec_anchor_duplicate');
  unique(source,DISPATCH_ANCHOR,'executor_dispatch_anchor_missing','executor_dispatch_anchor_duplicate');
  let out=source.replace(EXEC_SPEC_ANCHOR,EXEC_SPEC_ENTRY+'\n'+EXEC_SPEC_ANCHOR);
  out=out.replace(DISPATCH_ANCHOR,DISPATCH_ENTRY);
  out=out.replace(DISPATCH_ENTRY,executorApplyBlock()+DISPATCH_ENTRY);
  return out;
}
function patchPolicy(text){
  const p=JSON.parse(text);
  const state=targetPolicyState(p);
  if(!p.operations['host_action.imotion_credential_bind_v1']) fail('policy_imotion_operation_missing');
  if(!p.typed_scopes.some(x=>x && x.action==='imotion_credential_bind_v1')) fail('policy_imotion_scope_missing');
  if(!state.operationExact) p.operations[OPERATION]={level:4};
  if(!state.hostV2Exact) p.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:ACTION,risk:'critical',operation:OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
  p.version=POLICY_VERSION;
  return JSON.stringify(p,null,2)+'\n';
}
function buildPatchedFrom({base,executor,policy}){
  if(typeof base!=='string'||typeof executor!=='string'||typeof policy!=='string') fail('snapshot_invalid');
  const bState=baseState(base), eState=executorState(executor), pObj=JSON.parse(policy), pState=targetPolicyState(pObj);
  const fullyApplied=bState==='exact' && eState==='exact' && pState.operationExact && pState.hostV2Exact;
  if(fullyApplied) return {base,executor,policy,alreadyApplied:true};
  return {base:patchBase(base),executor:patchExecutor(executor),policy:patchPolicy(policy),alreadyApplied:false};
}
function verifyFixedContract(){
  if(RUNTIME_INPUTS.length!==0) fail('runtime_inputs_not_empty');
  if(ACTION!=='control_plane_root_scripts_stage_transport_v1'||OPERATION!=='host_action.control_plane_root_scripts_stage_transport_v1') fail('fixed_identity_invalid');
  if(!/^[a-f0-9]{64}$/.test(TRANSPORT_HELPER_SHA)) fail('transport_helper_sha_invalid');
  for(const v of Object.values(BASELINE_SHA)) if(!/^[a-f0-9]{64}$/.test(v)) fail('baseline_sha_invalid');
  return true;
}
function preflightFrom(snapshot){
  verifyFixedContract();
  const out=buildPatchedFrom(snapshot);
  return {ok:true,schema_version:'prhm.root-of-trust-seed-preflight.v1',seed_id:VERSION,action_registered:ACTION,already_applied:out.alreadyApplied,before_sha256:{base:sha(snapshot.base),executor:sha(snapshot.executor),policy:sha(snapshot.policy)},after_sha256:{base:sha(out.base),executor:sha(out.executor),policy:sha(out.policy)},control_plane_mutation:false,database_mutation:false,transport_executed:false};
}


async function preflightWithAdapter(adapter){
  verifyFixedContract();
  if(!adapter||typeof adapter!=='object') fail('adapter_required');
  if(adapter.getuid()!==0) fail('root_required');
  const layers=['base','executor','policy','transport'];
  const stats={};
  for(const layer of layers){
    const st=adapter.stat(layer);
    if(!st||st.isSymlink===true) fail('target_symlink_rejected:'+layer);
    if(st.isFile!==true) fail('target_not_regular:'+layer);
    stats[layer]=st;
  }
  const originals={};
  for(const layer of layers) originals[layer]=Buffer.from(adapter.read(layer));
  const snapshot={base:originals.base.toString('utf8'),executor:originals.executor.toString('utf8'),policy:originals.policy.toString('utf8')};
  const patched=buildPatchedFrom(snapshot);
  if(adapter.hash('transport')!==TRANSPORT_HELPER_SHA) fail('transport_helper_sha_mismatch');
  if(!patched.alreadyApplied){
    for(const layer of ['base','executor','policy']) if(adapter.hash(layer)!==BASELINE_SHA[layer]) fail('baseline_sha_mismatch:'+layer);
    JSON.parse(patched.policy);
    adapter.syntaxCheck('base',Buffer.from(patched.base,'utf8'));
    adapter.syntaxCheck('executor',Buffer.from(patched.executor,'utf8'));
  }
  const candidates={base:Buffer.from(patched.base,'utf8'),executor:Buffer.from(patched.executor,'utf8'),policy:Buffer.from(patched.policy,'utf8')};
  const beforeSha={base:sha(originals.base),executor:sha(originals.executor),policy:sha(originals.policy)};
  const afterSha={base:sha(candidates.base),executor:sha(candidates.executor),policy:sha(candidates.policy)};
  return {ok:true,alreadyApplied:patched.alreadyApplied,stats,originals,candidates,beforeSha,afterSha};
}

const HEALTH_ATTEMPTS=20;
const HEALTH_RETRY_MS=250;
async function healthWithRetry(adapter,service){
  let lastError=null;
  for(let attempt=1;attempt<=HEALTH_ATTEMPTS;attempt++){
    try{
      if(await adapter.health(service)===true) return true;
      lastError=new Error('health_not_ready:'+service);
    }catch(e){lastError=e;}
    if(attempt<HEALTH_ATTEMPTS){
      if(typeof adapter.sleep==='function') await adapter.sleep(HEALTH_RETRY_MS);
      else await new Promise(resolve=>setTimeout(resolve,HEALTH_RETRY_MS));
    }
  }
  throw lastError||new Error('health_not_ready:'+service);
}

async function rollbackWithAdapter(adapter,ctx,changedServices){
  const errors=[];
  for(const layer of ['policy','executor','base']){
    try{adapter.restore(layer,ctx.originals[layer],ctx.stats[layer]);}catch(e){errors.push('restore:'+layer+':'+String(e?.message||e));}
  }
  for(const service of changedServices){
    try{await adapter.restart(service);}catch(e){errors.push('restart:'+service+':'+String(e?.message||e));}
  }
  for(const layer of ['base','executor','policy']){
    try{if(!adapter.verifyRestored(layer,ctx.beforeSha[layer])) errors.push('verify_restored:'+layer);}catch(e){errors.push('verify_restored:'+layer+':'+String(e?.message||e));}
  }
  for(const service of changedServices){
    try{if(await healthWithRetry(adapter,service)!==true) errors.push('health:'+service);}catch(e){errors.push('health:'+service+':'+String(e?.message||e));}
  }
  return {ok:errors.length===0,errors};
}

async function executeWithAdapter(adapter){
  const ctx=await preflightWithAdapter(adapter);
  if(ctx.alreadyApplied){
    return {ok:true,schema_version:'prhm.root-of-trust-seed-result.v1',seed_id:VERSION,action_registered:true,services_healthy:true,rollback_performed:false,result:'ALREADY_APPLIED',before_sha256:ctx.beforeSha,after_sha256:ctx.afterSha,transport_executed:false,database_mutation:false};
  }
  adapter.beginBackup(ctx.originals,ctx.stats);
  let mutationStarted=false;
  const changedServices=[];
  try{
    for(const layer of ['base','executor','policy']){
      if(Buffer.compare(ctx.originals[layer],ctx.candidates[layer])===0) continue;
      mutationStarted=true;
      adapter.atomicWrite(layer,ctx.candidates[layer],ctx.stats[layer]);
      if(!adapter.verifyInstalled(layer,ctx.afterSha[layer])) fail('postwrite_sha_mismatch:'+layer);
      if(SERVICE_BY_LAYER[layer]&&!changedServices.includes(SERVICE_BY_LAYER[layer])) changedServices.push(SERVICE_BY_LAYER[layer]);
    }
    for(const service of changedServices) await adapter.restart(service);
    for(const service of changedServices) if(await healthWithRetry(adapter,service)!==true) fail('service_health_failed:'+service);
    return {ok:true,schema_version:'prhm.root-of-trust-seed-result.v1',seed_id:VERSION,action_registered:true,services_healthy:true,rollback_performed:false,result:'APPLIED',before_sha256:ctx.beforeSha,after_sha256:ctx.afterSha,transport_executed:false,database_mutation:false};
  }catch(error){
    if(!mutationStarted) throw error;
    const rb=await rollbackWithAdapter(adapter,ctx,changedServices.length?changedServices:Object.values(SERVICE_BY_LAYER));
    return {ok:false,schema_version:'prhm.root-of-trust-seed-result.v1',seed_id:VERSION,action_registered:false,services_healthy:rb.ok,rollback_performed:true,result:rb.ok?'FAILED_ROLLED_BACK':'FAILED_ROLLBACK_INCOMPLETE',error:String(error?.message||error),rollback_errors:rb.errors,transport_executed:false,database_mutation:false};
  }
}

function atomicFileWrite(abs,bytes,st){
  const dir=path.dirname(abs),tmp=path.join(dir,'.'+path.basename(abs)+'.root-seed-'+process.pid+'-'+Date.now()+'.tmp');
  let fd;
  try{
    fd=fs.openSync(tmp,'wx',st.mode&0o777);
    fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    fs.chmodSync(tmp,st.mode&0o777);fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,abs);
    const dfd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}
  }catch(e){try{if(fd!==undefined)fs.closeSync(fd);}catch{}try{fs.unlinkSync(tmp);}catch{}throw e;}
}
function serviceHealth(service){
  const socket=service==='prhm-agent-selfmaint.service'?'/run/prhm-agent-selfmaint/selfmaint.sock':'/run/prhm-agent-selfmaint-exec/exec.sock';
  return new Promise((resolve,reject)=>{
    const req=http.request({socketPath:socket,path:'/health',method:'GET',timeout:10000},res=>{
      let size=0;const chunks=[];res.on('data',c=>{size+=c.length;if(size<=200000)chunks.push(c)});res.on('end',()=>{if(size>200000)return reject(new Error('health_response_too_large'));let o;try{o=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{return reject(new Error('health_invalid_json'))}resolve(res.statusCode===200&&o&&o.ok===true);});
    });
    req.on('timeout',()=>req.destroy(new Error('health_timeout')));req.on('error',reject);req.end();
  });
}
function productionAdapter(){
  let backupDir=null;
  const fixed={base:PATHS.base,executor:PATHS.executor,policy:PATHS.policy,transport:PATHS.transport};
  return {
    getuid:()=>process.getuid?process.getuid():-1,
    stat(layer){const s=fs.lstatSync(fixed[layer]);return{isFile:s.isFile(),isSymlink:s.isSymbolicLink(),mode:s.mode,uid:s.uid,gid:s.gid};},
    read:layer=>fs.readFileSync(fixed[layer]),
    hash:layer=>sha(fs.readFileSync(fixed[layer])),
    syntaxCheck(layer,bytes){const dir=fs.mkdtempSync('/tmp/prhm-root-seed-check-');const f=path.join(dir,layer+'.js');try{fs.writeFileSync(f,bytes,{mode:0o600});const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check',f],{encoding:'utf8',timeout:15000,maxBuffer:200000,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/nonexistent'}});if(r.error||r.status!==0)fail('candidate_syntax_invalid:'+layer);}finally{try{fs.rmSync(dir,{recursive:true,force:true});}catch{}}},
    beginBackup(originals,stats){const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);backupDir=path.join(BACKUP_ROOT,stamp+'-'+process.pid);fs.mkdirSync(backupDir,{recursive:true,mode:0o700});for(const layer of ['base','executor','policy']){const f=path.join(backupDir,layer+'.bak');fs.writeFileSync(f,originals[layer],{flag:'wx',mode:0o600});fs.chownSync(f,stats[layer].uid,stats[layer].gid);}return{backup_dir:backupDir};},
    atomicWrite(layer,bytes,st){atomicFileWrite(fixed[layer],bytes,st);},
    restore(layer,bytes,st){atomicFileWrite(fixed[layer],bytes,st);},
    async restart(service){cp.execFileSync('/usr/bin/systemctl',['restart',service],{stdio:'pipe',timeout:120000});const a=cp.execFileSync('/usr/bin/systemctl',['is-active',service],{encoding:'utf8',timeout:10000}).trim();if(a!=='active')fail('service_not_active:'+service);return true;},
    health:service=>serviceHealth(service),
    sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
    verifyInstalled(layer,expected){return sha(fs.readFileSync(fixed[layer]))===expected;},
    verifyRestored(layer,expected){return sha(fs.readFileSync(fixed[layer]))===expected;}
  };
}

module.exports={ACTION,OPERATION,VERSION,POLICY_VERSION,RUNTIME_INPUTS,PATHS,BASELINE_SHA,TRANSPORT_HELPER_SHA,BACKUP_ROOT,BASE_ANCHOR,EXEC_SPEC_ANCHOR,DISPATCH_ANCHOR,HEALTH_ATTEMPTS,HEALTH_RETRY_MS,sha,verifyFixedContract,patchBase,patchExecutor,patchPolicy,buildPatchedFrom,preflightFrom,preflightWithAdapter,healthWithRetry,executeWithAdapter,productionAdapter};
if(require.main===module){
  if(process.argv.length!==2){console.error(JSON.stringify({ok:false,seed_id:VERSION,error:'unexpected_arguments'}));process.exit(2);}
  executeWithAdapter(productionAdapter()).then(out=>{process.stdout.write(JSON.stringify(out)+'\n');process.exit(out.ok===false?1:0);}).catch(error=>{console.error(JSON.stringify({ok:false,seed_id:VERSION,error:String(error?.message||error)}));process.exit(1);});
}
