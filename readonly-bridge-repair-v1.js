#!/usr/local/bin/prhm-node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const http=require('node:http');
const net=require('node:net');

const ACTION='readonly_bridge_repair_v1';
const ENV_PATH='/etc/prhm-readonly-http.env';
const UNIT='prhm-readonly-http.service';
const BACKUP_ROOT='/var/backups/prhm-readonly-bridge-repair-v1';
const expectedEndpoints=Object.freeze({
  recovery:'http://10.71.0.118:8140/health',
  bridge:'http://127.0.0.1:8141/health',
  bridgePrivate:'http://10.71.0.118:8141/health',
  agentApi:'http://127.0.0.1:8099/health',
  mcp:Object.freeze([
    'http://127.0.0.1:8123/health',
    'http://127.0.0.1:8124/health',
    'http://127.0.0.1:8125/health'
  ])
});

function fail(message){throw new Error(message);}
function shaBuffer(bytes){return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');}

function parseBridgeEnv(text){
  if(typeof text!=='string')fail('bridge_env_invalid');
  const lines=text.split('\n');
  const matches=[];
  for(let i=0;i<lines.length;i++){
    const m=/^([A-Za-z_][A-Za-z0-9_]*)=(\d+)$/.exec(lines[i]);
    if(!m)continue;
    const key=m[1];
    if(key!=='PORT'&&!key.endsWith('_PORT'))continue;
    matches.push({key,port:Number(m[2]),lineIndex:i});
  }
  if(matches.length!==1)fail('bridge_port_assignment_count:'+matches.length);
  return matches[0];
}

function rewriteBridgeEnv(text,expectedPort=8140,replacementPort=8141){
  const parsed=parseBridgeEnv(text);
  if(parsed.port!==expectedPort)fail('bridge_port_expected_'+expectedPort+'_actual_'+parsed.port);
  const lines=text.split('\n');
  const original=lines[parsed.lineIndex];
  const prefix=parsed.key+'=';
  if(!original.startsWith(prefix))fail('bridge_port_line_mismatch');
  lines[parsed.lineIndex]=prefix+String(replacementPort);
  return lines.join('\n');
}

function diffAllowed(before,after){
  try{return rewriteBridgeEnv(before)===after;}catch{return false;}
}

function validateEnvMetadata(stat){
  if(!stat||typeof stat!=='object')fail('env_stat_invalid');
  if(typeof stat.isSymbolicLink==='function'&&stat.isSymbolicLink())fail('env_symlink_forbidden');
  if(typeof stat.isFile!=='function'||!stat.isFile())fail('env_not_regular_file');
  if(Number(stat.uid)!==0)fail('env_owner_not_root');
  if((Number(stat.mode)&0o777)!==0o600)fail('env_mode_not_0600');
  return true;
}

function buildPreflightReport(fields){
  const sha=String(fields&&fields.envSha256||'');
  if(!/^[0-9a-f]{64}$/.test(sha))fail('env_sha256_invalid');
  return {
    ok:true,
    action:ACTION,
    schema_version:'prhm.host-action-preflight.v1',
    preflight_only:true,
    production_mutation:false,
    database_mutation:false,
    recovery_mutation:false,
    agent_api_mutation:false,
    mcp_mutation:false,
    env_sha256:sha,
    port_key:String(fields.portKey||''),
    current_port:Number(fields.currentPort),
    replacement_port:Number(fields.replacementPort),
    recovery_healthy:fields.recoveryHealthy===true,
    agent_api_healthy:fields.agentApiHealthy===true,
    mcp_healthy:fields.mcpHealthy===true
  };
}

function identityOk(kind,health){
  if(!health||health.ok!==true||typeof health.service!=='string')return false;
  if(kind==='recovery')return health.service==='prhm-recovery-agent';
  if(kind==='bridge')return health.service==='prhm-readonly-http';
  if(kind==='agentApi')return health.service==='ssh-agent-api';
  if(kind==='mcp')return health.service==='prhm-dev-agent-mcp';
  return false;
}

async function checkCoreHealth(deps){
  const recovery=await deps.health(expectedEndpoints.recovery);
  if(!identityOk('recovery',recovery))fail('recovery_health_failed');
  const agent=await deps.health(expectedEndpoints.agentApi);
  if(!identityOk('agentApi',agent))fail('agent_api_health_failed');
  for(const url of expectedEndpoints.mcp){
    const mcp=await deps.health(url);
    if(!identityOk('mcp',mcp))fail('mcp_health_failed');
  }
  return true;
}

async function checkBridgeHealth(deps){
  const responses=[
    await deps.health(expectedEndpoints.bridge),
    await deps.health(expectedEndpoints.bridgePrivate)
  ];
  let found=false;
  for(const response of responses){
    if(response===null||response===undefined)continue;
    found=true;
    if(!identityOk('bridge',response))fail('bridge_health_identity_mismatch');
  }
  if(!found)fail('bridge_health_failed');
  return true;
}

async function preflight(deps=defaultDeps){
  if(!deps||typeof deps!=='object')fail('deps_required');
  const stat=await deps.lstatEnv();
  validateEnvMetadata(stat);
  const raw=Buffer.from(await deps.readEnv());
  const text=raw.toString('utf8');
  const parsed=parseBridgeEnv(text);
  if(parsed.port!==8140)fail('bridge_port_expected_8140_actual_'+parsed.port);
  if(await deps.unitContractOk()!==true)fail('bridge_unit_contract_mismatch');
  if(await deps.portFree('127.0.0.1',8141)!==true)fail('bridge_target_port_loopback_busy');
  if(await deps.portFree('10.71.0.118',8141)!==true)fail('bridge_target_port_private_busy');
  await checkCoreHealth(deps);
  return buildPreflightReport({
    envSha256:shaBuffer(raw),
    portKey:parsed.key,
    currentPort:8140,
    replacementPort:8141,
    recoveryHealthy:true,
    agentApiHealthy:true,
    mcpHealthy:true
  });
}

async function verifyAfterApply(deps,before,restartBefore){
  const after=Buffer.from(await deps.readEnv()).toString('utf8');
  if(!diffAllowed(Buffer.from(before).toString('utf8'),after))fail('env_postwrite_diff_invalid');
  if(await deps.bridgeActive()!==true)fail('bridge_service_not_active');
  await checkBridgeHealth(deps);
  await checkCoreHealth(deps);
  await deps.sleep(5000);
  if(await deps.bridgeActive()!==true)fail('bridge_service_not_active_after_stability_sample');
  const restartAfter=Number(await deps.getNRestarts());
  if(!Number.isFinite(restartAfter)||restartAfter>restartBefore)fail('restart_counter_increased');
  return restartAfter;
}

async function verifyRollbackSafety(deps){
  await checkCoreHealth(deps);
  return true;
}

async function apply(deps=defaultDeps){
  const pf=await preflight(deps);
  const stat=await deps.lstatEnv();
  validateEnvMetadata(stat);
  const before=Buffer.from(await deps.readEnv());
  if(shaBuffer(before)!==pf.env_sha256)fail('env_sha_drift_before_apply');
  const candidate=Buffer.from(rewriteBridgeEnv(before.toString('utf8')));
  if(!diffAllowed(before.toString('utf8'),candidate.toString('utf8')))fail('candidate_diff_invalid');
  const restartBefore=Number(await deps.getNRestarts());
  if(!Number.isFinite(restartBefore))fail('restart_counter_invalid');
  let backupPath=null;
  let mutated=false;
  try{
    backupPath=await deps.backup(before,stat,pf.env_sha256);
    await deps.atomicReplace(candidate,stat);
    mutated=true;
    await deps.restartBridge();
    const restartAfter=await verifyAfterApply(deps,before,restartBefore);
    return {
      ok:true,
      action:ACTION,
      schema_version:'prhm.host-action-result.v1',
      installed:true,
      backup_path:String(backupPath||''),
      env_before_sha256:pf.env_sha256,
      env_after_sha256:shaBuffer(candidate),
      current_port:8141,
      recovery_port:8140,
      restart_count_before:restartBefore,
      restart_count_after:restartAfter,
      rollback_performed:false,
      database_mutation:false,
      recovery_mutation:false,
      agent_api_mutation:false,
      mcp_mutation:false,
      dns_mutation:false,
      firewall_mutation:false
    };
  }catch(error){
    if(!mutated)throw error;
    const rollbackErrors=[];
    try{await deps.atomicReplace(before,stat);}catch(e){rollbackErrors.push('restore:'+String(e&&e.message||e));}
    try{await deps.restartBridge();}catch(e){rollbackErrors.push('restart:'+String(e&&e.message||e));}
    try{await verifyRollbackSafety(deps);}catch(e){rollbackErrors.push('verify:'+String(e&&e.message||e));}
    if(rollbackErrors.length)fail('readonly_bridge_repair_failed_and_rollback_failed:'+String(error&&error.message||error)+':'+rollbackErrors.join('|'));
    fail('readonly_bridge_repair_failed_rolled_back:'+String(error&&error.message||error));
  }
}

function execSystemctl(args,{allowFailure=false,timeout=30000}={}){
  const r=cp.spawnSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout,maxBuffer:512*1024,stdio:['ignore','pipe','pipe']});
  if(r.error)fail('systemctl_exec_error');
  if(!allowFailure&&r.status!==0)fail('systemctl_failed:'+String(args[0]||'unknown'));
  return r;
}

function requestJson(url,timeoutMs=2500){
  return new Promise(resolve=>{
    let settled=false;
    const done=value=>{if(settled)return;settled=true;resolve(value);};
    const req=http.get(url,{timeout:timeoutMs},res=>{
      let size=0;const chunks=[];
      res.on('data',chunk=>{size+=chunk.length;if(size>65536){req.destroy();done(null);return;}chunks.push(chunk);});
      res.on('end',()=>{
        if(res.statusCode!==200)return done(null);
        try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));done(body&&typeof body==='object'?body:null);}catch{done(null);}
      });
    });
    req.on('timeout',()=>{req.destroy();done(null);});
    req.on('error',()=>done(null));
  });
}

function tcpPortFree(host,port,timeoutMs=1200){
  return new Promise(resolve=>{
    let settled=false;
    const socket=net.createConnection({host,port});
    const done=value=>{if(settled)return;settled=true;socket.destroy();resolve(value);};
    socket.setTimeout(timeoutMs);
    socket.on('connect',()=>done(false));
    socket.on('timeout',()=>done(false));
    socket.on('error',error=>done(error&&error.code==='ECONNREFUSED'));
  });
}

function atomicReplaceFile(bytes,stat){
  const dir=path.dirname(ENV_PATH);
  const tmp=path.join(dir,'.prhm-readonly-http.env.repair-'+process.pid+'-'+Date.now()+'.tmp');
  let fd;
  try{
    fd=fs.openSync(tmp,'wx',0o600);
    fs.writeFileSync(fd,Buffer.from(bytes));
    fs.fsyncSync(fd);
    fs.closeSync(fd);fd=undefined;
    fs.chownSync(tmp,Number(stat.uid),Number(stat.gid));
    fs.chmodSync(tmp,Number(stat.mode)&0o777);
    fs.renameSync(tmp,ENV_PATH);
    const dfd=fs.openSync(dir,'r');
    try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}
  }finally{
    if(fd!==undefined){try{fs.closeSync(fd);}catch{}}
    try{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}catch{}
  }
}

const defaultDeps=Object.freeze({
  lstatEnv:()=>fs.lstatSync(ENV_PATH),
  readEnv:()=>fs.readFileSync(ENV_PATH),
  unitContractOk:()=>{
    const r=execSystemctl(['cat',UNIT],{allowFailure:true,timeout:10000});
    if(r.status!==0)return false;
    const out=String(r.stdout||'');
    return out.includes('EnvironmentFile=/etc/prhm-readonly-http.env')&&
      out.includes('ExecStart=/usr/local/bin/prhm-node /opt/prhm-readonly-http/server.js')&&
      out.includes('User=prhm-readonly-http')&&
      out.includes('Group=prhm-readonly-cap');
  },
  portFree:(host,port)=>tcpPortFree(host,port),
  health:url=>requestJson(url),
  bridgeActive:()=>String(execSystemctl(['is-active',UNIT],{allowFailure:true,timeout:10000}).stdout||'').trim()==='active',
  backup:(bytes,stat,envSha)=>{
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const dir=path.join(BACKUP_ROOT,stamp+'-'+envSha.slice(0,12));
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    fs.chmodSync(dir,0o700);
    const file=path.join(dir,'prhm-readonly-http.env.bak');
    fs.writeFileSync(file,Buffer.from(bytes),{mode:0o600,flag:'wx'});
    fs.chownSync(file,0,0);fs.chmodSync(file,0o600);
    return file;
  },
  atomicReplace:(bytes,stat)=>atomicReplaceFile(bytes,stat),
  restartBridge:()=>{execSystemctl(['restart',UNIT],{timeout:30000});},
  getNRestarts:()=>{
    const r=execSystemctl(['show',UNIT,'-p','NRestarts','--value'],{timeout:10000});
    const value=Number(String(r.stdout||'').trim());
    if(!Number.isFinite(value))fail('restart_counter_invalid');
    return value;
  },
  sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))
});

async function run(argv=process.argv.slice(2),deps=defaultDeps){
  if(!Array.isArray(argv)||argv.length!==1||!['--preflight-only','--apply'].includes(argv[0]))fail('unexpected_arguments');
  return argv[0]==='--preflight-only'?preflight(deps):apply(deps);
}

if(require.main===module){
  run().then(result=>{process.stdout.write(JSON.stringify(result)+'\n');}).catch(error=>{
    process.stderr.write(JSON.stringify({ok:false,action:ACTION,error:String(error&&error.message||error).slice(0,1000)})+'\n');
    process.exitCode=1;
  });
}

module.exports={ACTION,ENV_PATH,UNIT,BACKUP_ROOT,expectedEndpoints,shaBuffer,parseBridgeEnv,rewriteBridgeEnv,diffAllowed,validateEnvMetadata,buildPreflightReport,identityOk,checkBridgeHealth,preflight,apply,run};
