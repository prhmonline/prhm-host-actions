#!/usr/local/bin/prhm-node
'use strict';

const crypto=require('node:crypto');
const ACTION='readonly_bridge_repair_v1';
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

async function preflight(deps){
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
  const bridge=await deps.health(expectedEndpoints.bridge);
  if(!identityOk('bridge',bridge))fail('bridge_health_failed');
  await checkCoreHealth(deps);
  await deps.sleep(5000);
  const restartAfter=Number(await deps.getNRestarts());
  if(!Number.isFinite(restartAfter)||restartAfter>restartBefore)fail('restart_counter_increased');
  return restartAfter;
}

async function verifyRollbackSafety(deps){
  await checkCoreHealth(deps);
  return true;
}

async function apply(deps){
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

module.exports={ACTION,expectedEndpoints,shaBuffer,parseBridgeEnv,rewriteBridgeEnv,diffAllowed,validateEnvMetadata,buildPreflightReport,identityOk,preflight,apply};
