import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const BASE_SHA='9f83594d0d0c741614dbb44258014018dab1282f77cc84d70899e43b2702e5a6';
const BACK='/var/backups/prhm-agent-selfmaint';
const PREFIX='agent_mcp-server.js-';
const SUFFIX='-'+BASE_SHA+'.bak';
const TMP='/tmp/prhm-agent-mcp-titan-delegation-'+BASE_SHA+'.mjs';
const TITAN_CONTRACT_TOOL='titan_host_actions_worktree_test_v1';
const TITAN_PREFLIGHT_TOOL='titan_front_handoff_preflight_v2';
const TITAN_DEPLOY_TOOL='titan_front_handoff_deploy_v2';
const TITAN_CONFIRM='CONFIRM_DEPLOY_PRODUCTION';
const TITAN_NAMES=new Set([TITAN_CONTRACT_TOOL,TITAN_PREFLIGHT_TOOL,TITAN_DEPLOY_TOOL]);
const sha=b=>createHash('sha256').update(b).digest('hex');

let titanOpsHandler=null;

const ROOT_STAGE_SOCKET='/run/prhm-root-scripts-stage-mediator-v1/mediator.sock';
const ROOT_STAGE_ACTION='control_plane_root_scripts_stage_transport_v1';
const ROOT_STAGE_OPERATION='host_action.control_plane_installer_refresh_root_stage_v1';
const ROOT_STAGE_ARGUMENTS_SHA='49237e7441a82bc94f02ef9db23360c73acc5a2dd5bb80085efcffa5f3678f07';

function rootStageText(value){
  return {content:[{type:'text',text:JSON.stringify(value)}]};
}

function callRootStage(pathname,method='GET',body,timeoutMs=15000){
  return new Promise((resolve,reject)=>{
    const data=body===undefined?null:Buffer.from(JSON.stringify(body));
    const headers=data?{'content-type':'application/json','content-length':String(data.length)}:{};
    const req=http.request({socketPath:ROOT_STAGE_SOCKET,path:pathname,method,headers},res=>{
      let size=0;
      const chunks=[];
      res.on('data',chunk=>{size+=chunk.length;if(size<=262144)chunks.push(chunk);});
      res.on('end',()=>{
        if(size>262144)return reject(new Error('menu_root_stage_response_too_large'));
        let out={};
        try{out=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
        catch{return reject(new Error('menu_root_stage_invalid_json'));}
        if(res.statusCode<200||res.statusCode>=300||out.ok!==true){
          return reject(new Error(String(out.error||('menu_root_stage_rejected_'+res.statusCode)).slice(0,240)));
        }
        resolve(out);
      });
    });
    req.setTimeout(timeoutMs,()=>req.destroy(new Error('menu_root_stage_timeout')));
    req.on('error',error=>reject(new Error('menu_root_stage_socket_error:'+error.message)));
    data?req.end(data):req.end();
  });
}

function assertRootStage(status,requestId){
  const fixed={
    action:ROOT_STAGE_ACTION,
    operation:ROOT_STAGE_OPERATION,
    project:'control_plane',
    environment:'production',
    risk:'critical',
    level:4,
    arguments_sha256:ROOT_STAGE_ARGUMENTS_SHA
  };
  if(!status||status.ok!==true||String(status.request_id||'')!==String(requestId||'')||String(status.status||'')!=='pending'){
    throw new Error('menu_root_stage_status_invalid');
  }
  for(const key of ['action','operation','project','environment','risk','arguments_sha256']){
    if(String(status[key]||'')!==String(fixed[key]))throw new Error('menu_root_stage_binding_mismatch:'+key);
  }
  if(Number(status.level)!==4)throw new Error('menu_root_stage_binding_mismatch:level');
  const expires=Date.parse(String(status.expires_at||''));
  if(!Number.isFinite(expires)||Date.now()>=expires)throw new Error('menu_root_stage_request_expired');
  return status;
}

async function rootStageRequestV1(){
  const created=await callRootStage('/v1/request','POST',{});
  const requestId=String(created.request_id||'');
  if(!/^[0-9a-f-]{36}$/i.test(requestId))throw new Error('menu_root_stage_request_id_invalid');
  const status=assertRootStage(await callRootStage('/v1/status/'+encodeURIComponent(requestId),'GET'),requestId);
  return rootStageText({
    ok:true,
    request:status,
    action:ROOT_STAGE_ACTION,
    arguments_sha256:status.arguments_sha256,
    executor:'root-stage-mediator-v1',
    spec_fixed_server_side:true
  });
}

function wrapRootStageRequest(name,handler){
  if(name!=='host_action_v2_request')return handler;
  return async args=>String(args?.action||'')===ROOT_STAGE_ACTION?rootStageRequestV1():handler(args);
}

function loadBase(){
  const names=fs.readdirSync(BACK).filter(n=>n.startsWith(PREFIX)&&n.endsWith(SUFFIX)).sort().reverse();
  if(!names.length)throw new Error('titan_mcp_delegation_base_backup_missing');
  const bytes=fs.readFileSync(path.join(BACK,names[0]));
  if(sha(bytes)!==BASE_SHA)throw new Error('titan_mcp_delegation_base_sha_mismatch');
  return bytes;
}

function titanOpsPayload(name,args){
  if(name===TITAN_CONTRACT_TOOL){
    if(args?.suite!=='contract_v1')throw new Error('titan_contract_suite_invalid');
    return {
      project:'control_plane',
      command:JSON.stringify({operation:'titan_host_actions_contract_v1'}),
      reason:'Run only the fixed Titan handoff contract through the Agent API delegation boundary.',
      access:'read',risk:'low',acknowledgeRisk:false,timeoutMs:180000
    };
  }
  if(name===TITAN_PREFLIGHT_TOOL){
    return {
      project:'control_plane',
      command:JSON.stringify({operation:'titan_front_handoff_preflight_v2'}),
      reason:'Run the fixed read-only Titan production handoff preflight through the Agent API delegation boundary.',
      access:'read',risk:'low',acknowledgeRisk:false,timeoutMs:180000
    };
  }
  if(name===TITAN_DEPLOY_TOOL){
    if(args?.confirmation!==TITAN_CONFIRM)throw new Error('titan_deploy_confirmation_required');
    return {
      project:'control_plane',
      command:JSON.stringify({operation:'titan_front_handoff_deploy_v2',confirmation:TITAN_CONFIRM}),
      reason:'Deploy only the fixed SHA-bound Titan frontend handoff through the Titan-only Agent API sandbox boundary.',
      access:'write',risk:'high',acknowledgeRisk:true,timeoutMs:1200000
    };
  }
  throw new Error('titan_tool_unexpected');
}

async function titanDelegate(name,args){
  if(typeof titanOpsHandler!=='function')throw new Error('titan_ops_execute_handler_missing');
  return titanOpsHandler(titanOpsPayload(name,args));
}

const previousRegisterTool=McpServer.prototype.registerTool;
McpServer.prototype.registerTool=function(name,config,handler,...rest){
  if(name==='ops_execute')titanOpsHandler=handler;
  const baseNext=TITAN_NAMES.has(name)?(async args=>titanDelegate(name,args)):handler;
  const next=wrapRootStageRequest(name,baseNext);
  return previousRegisterTool.call(this,name,config,next,...rest);
};

const previousTool=McpServer.prototype.tool;
McpServer.prototype.tool=function(name,description,schema,handler,...rest){
  if(name==='ops_execute')titanOpsHandler=handler;
  const baseNext=TITAN_NAMES.has(name)?(async args=>titanDelegate(name,args)):handler;
  const next=wrapRootStageRequest(name,baseNext);
  return previousTool.call(this,name,description,schema,next,...rest);
};

const bytes=loadBase();
try{
  if(!fs.readFileSync(TMP).equals(bytes))throw new Error('refresh');
}catch{
  const tmp=TMP+'.'+process.pid+'-'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,TMP);
  fs.chmodSync(TMP,0o600);
}

await import(pathToFileURL(TMP).href+'?titan-delegation='+BASE_SHA);
// TITAN_MCP_AGENT_API_DELEGATION_V1
// TITAN_PROJECT_BRIDGE_RELOAD_V1
