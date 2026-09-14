#!/usr/local/bin/prhm-node
'use strict';

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

module.exports={ACTION,expectedEndpoints,parseBridgeEnv,rewriteBridgeEnv,diffAllowed,validateEnvMetadata,buildPreflightReport,identityOk};
