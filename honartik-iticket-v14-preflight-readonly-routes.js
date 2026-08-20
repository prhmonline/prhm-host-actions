'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const Module=require('node:module');

const TOOL='honartik_iticket_v14_preflight_readonly';
const ROUTE='/honartik/iticket/v14/preflight';
const ACTION='honartik_iticket_dark_backend_batch1_v1';
const V14_PAYLOAD='/opt/prhm-agent-readonly-actions/honartik-iticket-v14-preflight.js';
const V14_SHA='420a7f817c99967819e3b5bae43d862b6158a483a8fb5665492917f5c641972b';
const JOURNAL='/var/lib/prhm-agent-selfmaint-exec/host-actions-v14-honartik-iticket-dark-backend-batch1/install-state.json';
const READ_EXACT=new Set([
  V14_PAYLOAD,
  '/opt/prhm-agent-selfmaint/server.js',
  '/opt/prhm-agent-selfmaint-exec/server.js',
  '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  '/opt/prhm-company-control-plane/config/approval-policy.json',
  '/opt/prhm-agent-selfmaint-exec/actions/honartik-iticket-dark-backend-batch1-v1.js',
  '/home/honartik/worktrees/iticket-dark-v1-front',
  '/home/honartik/worktrees/iticket-dark-v1-back',
  JOURNAL
]);
const READ_PREFIXES=Object.freeze(['/var/backups/prhm-host-actions-v14-honartik-iticket-']);
const GIT_ROOTS=new Set([
  '/home/honartik/domains/honartik.ir/public_html',
  '/home/honartik/worktrees/iticket-dark-v1-front',
  '/home/honartik/domains/dashboard.honartik.ir/public_html',
  '/home/honartik/worktrees/iticket-dark-v1-back'
]);
const GIT_COMMANDS=new Set([
  'rev-parse\u0000HEAD',
  'branch\u0000--show-current',
  'status\u0000--porcelain=v1\u0000--untracked-files=all'
]);

function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function fail(code){throw new Error(code);}
function normalizeAbsolute(value){
  if(typeof value!=='string'||!value.startsWith('/'))fail('iticket_v14_preflight_path_denied');
  const normalized=path.posix.normalize(value);
  if(normalized!==value)fail('iticket_v14_preflight_path_denied');
  return normalized;
}
function allowReadPath(value){
  const file=normalizeAbsolute(value);
  if(READ_EXACT.has(file)||READ_PREFIXES.some(prefix=>file.startsWith(prefix)))return file;
  fail('iticket_v14_preflight_path_denied');
}
function readOnlyFs(){
  return Object.freeze({
    constants:fs.constants,
    existsSync(file){return fs.existsSync(allowReadPath(file));},
    lstatSync(file){return fs.lstatSync(allowReadPath(file));},
    readFileSync(file,options){return fs.readFileSync(allowReadPath(file),options);}
  });
}
function validateGitArgs(file,args){
  if(file!=='/usr/bin/git'||!Array.isArray(args)||args.length<6)fail('iticket_v14_preflight_child_process_denied');
  if(args[0]!=='-c'||typeof args[1]!=='string'||!args[1].startsWith('safe.directory=')||args[2]!=='-C')fail('iticket_v14_preflight_child_process_denied');
  const root=args[3];
  if(!GIT_ROOTS.has(root)||args[1]!==`safe.directory=${root}`)fail('iticket_v14_preflight_child_process_denied');
  const op=args.slice(4).join('\u0000');
  if(!GIT_COMMANDS.has(op))fail('iticket_v14_preflight_child_process_denied');
  return {root,op};
}
function gitOnlyChildProcess(){
  return Object.freeze({
    spawnSync(file,args){
      validateGitArgs(file,args);
      return cp.spawnSync(file,args,{
        encoding:'utf8',timeout:30000,maxBuffer:1024*1024,
        env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/root'},
        stdio:['ignore','pipe','pipe']
      });
    },
    execFileSync(){fail('iticket_v14_preflight_child_process_denied');}
  });
}
const deniedNetwork=Object.freeze({
  request(){fail('iticket_v14_preflight_network_denied');},
  get(){fail('iticket_v14_preflight_network_denied');},
  createConnection(){fail('iticket_v14_preflight_network_denied');},
  connect(){fail('iticket_v14_preflight_network_denied');},
  createServer(){fail('iticket_v14_preflight_network_denied');}
});
function compilePinnedModule(bytes){
  if(!Buffer.isBuffer(bytes)||sha(bytes)!==V14_SHA)fail('iticket_v14_preflight_payload_sha_mismatch');
  const compiled=new Module(V14_PAYLOAD,module);
  compiled.filename=V14_PAYLOAD;
  compiled.paths=[];
  const originalLoad=Module._load;
  const rofs=readOnlyFs();
  const rocp=gitOnlyChildProcess();
  Module._load=function(request,parent,isMain){
    if(request==='node:fs'||request==='fs')return rofs;
    if(request==='node:child_process'||request==='child_process')return rocp;
    if(['node:http','http','node:https','https','node:net','net','node:tls','tls','node:dgram','dgram'].includes(request))return deniedNetwork;
    if(['node:path','path','node:os','os','node:crypto','crypto'].includes(request))return originalLoad.call(this,request,parent,isMain);
    fail('iticket_v14_preflight_module_denied');
  };
  try{compiled._compile(bytes.toString('utf8'),V14_PAYLOAD);}
  finally{Module._load=originalLoad;}
  if(!compiled.exports||typeof compiled.exports.preflight!=='function')fail('iticket_v14_preflight_export_missing');
  return compiled.exports;
}
function validateResult(result){
  if(!result||result.ok!==true||result.schema_version!=='prhm.host-action-install-preflight.v1'||result.action!==ACTION||result.preflight_only!==true)fail('iticket_v14_preflight_result_invalid');
  const falseFields=['control_plane_mutation','production_mutation','production_application_tree_mutation','database_mutation','deploy','external_network','token_read'];
  for(const key of falseFields)if(result[key]!==false)fail('iticket_v14_preflight_unsafe_result');
  const alreadyInstalled=result.already_installed===true;
  if(alreadyInstalled){if(result.baseline_match!==null)fail('iticket_v14_preflight_baseline_state_invalid');}
  else if(result.baseline_match!==true)fail('iticket_v14_preflight_baseline_state_invalid');
  if(typeof result.helper_sha256!=='string'||!/^[a-f0-9]{64}$/.test(result.helper_sha256))fail('iticket_v14_preflight_helper_sha_invalid');
  if(typeof result.version!=='string'||result.version.length>160||typeof result.policy_version!=='string'||result.policy_version.length>160)fail('iticket_v14_preflight_version_invalid');
  return {
    ok:true,
    schema_version:result.schema_version,
    action:result.action,
    version:result.version,
    policy_version:result.policy_version,
    preflight_only:true,
    already_installed:alreadyInstalled,
    baseline_match:result.baseline_match,
    helper_sha256:result.helper_sha256,
    payload_sha256:V14_SHA,
    control_plane_mutation:false,
    production_mutation:false,
    production_application_tree_mutation:false,
    database_mutation:false,
    deploy:false,
    external_network:false,
    token_read:false
  };
}
function runPinnedPreflight(){
  const bytes=fs.readFileSync(V14_PAYLOAD);
  if(sha(bytes)!==V14_SHA)fail('iticket_v14_preflight_payload_sha_mismatch');
  const v14=compilePinnedModule(bytes);
  return validateResult(v14.preflight());
}
function registerHonartikIticketV14PreflightRoutes(app,{auth}){
  if(!app||typeof app.post!=='function'||typeof auth!=='function')fail('iticket_v14_preflight_registration_invalid');
  app.post(ROUTE,auth,async(req,res)=>{
    const body=req&&req.body==null?{}:req.body;
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==0)return res.status(400).json({ok:false,error:'iticket_v14_preflight_zero_input_required'});
    try{return res.json(runPinnedPreflight());}
    catch{return res.status(409).json({ok:false,error:'honartik_iticket_v14_preflight_failed'});}
  });
}
module.exports={TOOL,ROUTE,V14_PAYLOAD,V14_SHA,registerHonartikIticketV14PreflightRoutes,runPinnedPreflight,compilePinnedModule,validateResult};
