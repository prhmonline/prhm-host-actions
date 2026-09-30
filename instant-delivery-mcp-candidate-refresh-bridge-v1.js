'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const Module=require('node:module');

const PREFLIGHT_OPERATION='instant_delivery_mcp_candidate_refresh_preflight_v1';
const APPLY_OPERATION='instant_delivery_mcp_candidate_refresh_apply_v1';
const STATUS_OPERATION='instant_delivery_mcp_candidate_refresh_status_v1';
const CONFIRMATION='CONFIRM_LEVEL_4_CRITICAL';
const CANDIDATE_SERVICE='prhm-agent-mcp-instant-delivery-candidate.service';
const CANDIDATE_TARGET='/home/agent/candidates/agent3-instant-delivery-v1/mcp/src/plugins/hostActionsV2.js';
const SOURCE_SHA256='048e2db190c5548f47967447b3b564eefd0b7203cf6df84beb73c520d481633d';
const TARGET_PREIMAGE_SHA256='b2f95b97dfa7e26ca717dfbec7871bf2f64286952548fb4d6d8e99908aeaacc0';
const BASE_SHA256='55158cb03f503bed6681abdb3b797d7271730bf1b803bc42cd57bb32e1c97d44';
const HELPER_SHA256='43f2d7322496cbd9d60c9d98e6c39b44f6b99daef32743274ff944184edf74ef';
const BASE_PATH='/home/agent/ssh-agent-api/.instant-delivery-mcp-candidate-refresh-bridge-base-'+BASE_SHA256+'.cjs';
const HELPER_NS_PATH='/home/agent/ssh-agent-api/instant-delivery-mcp-candidate-refresh-v1.js';
const HELPER_HOST_PATH='/home/agent/candidates/agent3-instant-delivery-v1/api/instant-delivery-mcp-candidate-refresh-v1.js';
const RESULT_DIR='/var/lib/prhm-agent-instant-delivery-v1/mcp-candidate-refresh-bridge';
const RESULT_PATH=path.join(RESULT_DIR,'latest.json');
const BACKUP_ROOT='/var/backups/prhm-agent-instant-delivery-mcp-candidate-refresh-v1';
const SYSTEMD_RUN='/usr/bin/systemd-run';
const NODE='/usr/local/bin/prhm-node';

function fail(message){throw new Error(message)}
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex')}
function fixedFile(file,expected,label){
  const st=fs.lstatSync(file);
  if(st.isSymbolicLink()||!st.isFile())fail(label+'_not_regular');
  const bytes=fs.readFileSync(file);
  if(sha(bytes)!==expected)fail(label+'_sha_mismatch');
  return bytes;
}
function exactKeys(obj,keys){
  if(Object.keys(obj).sort().join(',')!==keys.slice().sort().join(','))fail('unexpected control-plane field');
}
function parseEvidence(){
  const st=fs.lstatSync(RESULT_PATH);
  if(st.isSymbolicLink()||!st.isFile()||st.size<2||st.size>131072)fail('candidate_refresh_result_invalid');
  let out;try{out=JSON.parse(fs.readFileSync(RESULT_PATH,'utf8'))}catch{fail('candidate_refresh_result_json_invalid')}
  if(!out||out.action!=='agent_instant_delivery_mcp_candidate_refresh_v1')fail('candidate_refresh_result_contract_invalid');
  return out;
}

function productionSpec(){return Object.freeze({
  helper_sha256:HELPER_SHA256,source_sha256:SOURCE_SHA256,target_preimage_sha256:TARGET_PREIMAGE_SHA256,
  candidate_target:CANDIDATE_TARGET,candidate_service:CANDIDATE_SERVICE,
  api_candidate_mutation:false,router_mutation:false,database_mutation:false,production_application_mutation:false,
})}

function productionRunner(){
  function run(mode){
    if(mode!=='preflight'&&mode!=='apply')fail('mode_not_allowlisted');
    fixedFile(HELPER_NS_PATH,HELPER_SHA256,'helper');
    fs.mkdirSync(RESULT_DIR,{recursive:true,mode:0o700});
    try{fs.unlinkSync(RESULT_PATH)}catch(error){if(error&&error.code!=='ENOENT')throw error}
    const unit='prhm-mcp-candidate-refresh-'+mode+'-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex');
    const args=[
      '--wait','--collect','--quiet','--unit='+unit,
      '--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true',
      '--property=PrivateTmp=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only',
      '--property=ReadOnlyPaths=/home/agent/ssh-mcp-server',
      '--property=ReadWritePaths=/home/agent/candidates/agent3-instant-delivery-v1/mcp',
      '--property=ReadWritePaths='+BACKUP_ROOT,'--property=ReadWritePaths='+RESULT_DIR,
      '--setenv=PRHM_MCP_CANDIDATE_REFRESH_RESULT=1',
      NODE,HELPER_HOST_PATH,mode==='preflight'?'--preflight':'--apply'
    ];
    const r=cp.spawnSync(SYSTEMD_RUN,args,{encoding:'utf8',timeout:180000,maxBuffer:1048576,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/nonexistent'}});
    let evidence=null;try{evidence=parseEvidence()}catch(error){if(r.error||r.status!==0)fail('candidate_refresh_transient_failed:'+String(r.stderr||r.stdout||r.error&&r.error.message||'unknown').slice(-800));throw error}
    if(mode==='preflight'){
      if(evidence.ok!==true||evidence.mode!=='preflight'||evidence.mutation!==false||evidence.production_mutation!==false)fail('candidate_refresh_preflight_contract_invalid');
    }else if(evidence.ok===true){
      if(evidence.after_sha256!==SOURCE_SHA256||evidence.api_candidate_mutation!==false||evidence.router_mutation!==false||evidence.database_mutation!==false||evidence.production_application_mutation!==false)fail('candidate_refresh_apply_contract_invalid');
    }else if(!(evidence.status==='FAILED_ROLLED_BACK'&&evidence.rollback_performed===true&&evidence.after_sha256===TARGET_PREIMAGE_SHA256)){
      fail('candidate_refresh_failure_contract_invalid');
    }
    if(r.error||r.status!==0){if(evidence&&evidence.status==='FAILED_ROLLED_BACK')return evidence;fail('candidate_refresh_transient_failed')}
    return evidence;
  }
  return Object.freeze({run,status:parseEvidence});
}

function createFixedDispatcher(runner,fallbackExecute){
  if(!runner||typeof runner.run!=='function'||typeof runner.status!=='function'||typeof fallbackExecute!=='function')fail('bridge_dependency_invalid');
  return Object.freeze({async execute(command){
    let spec=null;try{spec=JSON.parse(command)}catch{}
    if(spec&&spec.operation===PREFLIGHT_OPERATION){exactKeys(spec,['operation']);return{...runner.run('preflight'),operation:PREFLIGHT_OPERATION}}
    if(spec&&spec.operation===STATUS_OPERATION){exactKeys(spec,['operation']);return{...runner.status(),operation:STATUS_OPERATION}}
    if(spec&&spec.operation===APPLY_OPERATION){
      if(spec.second_confirmation!==CONFIRMATION)fail('Level-4 confirmation required');
      exactKeys(spec,['operation','second_confirmation']);
      return{...runner.run('apply'),operation:APPLY_OPERATION};
    }
    return fallbackExecute(command);
  }});
}

let baseModule=null;
function loadBase(){
  if(baseModule)return baseModule;
  const bytes=fixedFile(BASE_PATH,BASE_SHA256,'base_bridge');
  const m=new Module(BASE_PATH,module);m.filename=BASE_PATH;m.paths=Module._nodeModulePaths(path.dirname(BASE_PATH));m._compile(bytes.toString('utf8'),BASE_PATH);
  if(!m.exports||typeof m.exports.createOpsSelfmaintBridge!=='function')fail('base_bridge_contract_invalid');
  baseModule=m.exports;return baseModule;
}
function createOpsSelfmaintBridge(){
  const base=loadBase().createOpsSelfmaintBridge();
  const fixed=createFixedDispatcher(productionRunner(),command=>base.execute(command));
  return{execute:(command,ctx={})=>fixed.execute(command,ctx)};
}

module.exports=Object.freeze({PREFLIGHT_OPERATION,APPLY_OPERATION,STATUS_OPERATION,CONFIRMATION,CANDIDATE_SERVICE,CANDIDATE_TARGET,SOURCE_SHA256,TARGET_PREIMAGE_SHA256,BASE_SHA256,HELPER_SHA256,BASE_PATH,HELPER_NS_PATH,HELPER_HOST_PATH,RESULT_PATH,productionSpec,productionRunner,createFixedDispatcher,createOpsSelfmaintBridge});
