#!/usr/local/bin/prhm-node
'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const cp=require('child_process');

const PATHS=Object.freeze({
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  base:'/opt/prhm-agent-selfmaint/server.js',
  exec:'/opt/prhm-agent-selfmaint-exec/server.js',
  registry:'/home/agent/ssh-mcp-server/src/core/registry.js',
  hostActionsV1:'/home/agent/ssh-mcp-server/src/plugins/hostActions.js',
  hostActionsV2:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  marker:'/var/lib/prhm-agent-selfmaint-exec/host-actions-v2-bootstrap.json'
});

const EXPECTED=Object.freeze({
  policy:'f3925655110b6b79d98190c2f5b5c84dce16caeaed99fcfb8da638aa9e747c69',
  base:'af80e836a44c89fc390474533f6f9bc2b864066e444637587c1d1ed1260a2cab',
  exec:'fedb9d1c9d54e69a4c99d93114e461dd4f998c053c0965ee54a3b12360bed584',
  registry:'fbb8641b15563ceb95e11c82702b6c39cae1048bb3a910e5c693a578bd886887',
  hostActionsV1:'48d94fe8a47216e36ac4430a845c3441912b45484920628dd03fd3c2cb487312'
});

const VERSION='2026-08-13.1-host-actions-v2';
const ACTIONS=Object.freeze({
  agent_api_process_sandbox_v1:{
    operation:'host_action.agent_api_process_sandbox_v1',
    rollback:'host-action-v2:agent-api-process-sandbox:auto-backup',
    dropin:'91-prhm-process-sandbox.conf'
  },
  agent_api_filesystem_confinement_v1:{
    operation:'host_action.agent_api_filesystem_confinement_v1',
    rollback:'host-action-v2:agent-api-filesystem-confinement:auto-backup',
    dropin:'92-prhm-filesystem-confinement.conf'
  },
  agent_api_capability_minimize_v1:{
    operation:'host_action.agent_api_capability_minimize_v1',
    rollback:'host-action-v2:agent-api-capability-minimize:auto-backup',
    dropin:'93-prhm-capability-minimize.conf'
  }
});

const PROCESS_CONFIG=[
  '[Service]',
  'NoNewPrivileges=yes',
  'PrivateTmp=yes',
  'ProtectKernelTunables=yes',
  'ProtectKernelModules=yes',
  'ProtectControlGroups=yes',
  'RestrictNamespaces=yes',
  'RestrictSUIDSGID=yes',
  'LockPersonality=yes',
  'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
  ''
].join('\n');

const FILESYSTEM_CONFIG=[
  '[Service]',
  'ProtectSystem=full',
  'ProtectHome=read-only',
  'ReadWritePaths=-/home/agent/ssh-agent-api -/home/agent/ssh-agent-runtime -/home/prhm -/home/honartik -/home/drtarjomeh -/mnt/imotion-prod-vm',
  ''
].join('\n');

const CAPABILITY_CONFIG=[
  '[Service]',
  'CapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_DAC_READ_SEARCH CAP_FOWNER CAP_FSETID CAP_KILL CAP_SETGID CAP_SETUID CAP_NET_BIND_SERVICE',
  'AmbientCapabilities=',
  ''
].join('\n');

function shaText(s){return crypto.createHash('sha256').update(Buffer.from(s,'utf8')).digest('hex');}
function read(f){return fs.readFileSync(f,'utf8');}
function assertSha(label,file,expected){const actual=shaText(read(file));if(actual!==expected)throw Error(`sha_mismatch:${label}:${actual}`);}
function replaceOnce(text,anchor,replacement,label){const i=text.indexOf(anchor);if(i<0)throw Error(`anchor_missing:${label}`);if(text.indexOf(anchor,i+anchor.length)>=0)throw Error(`anchor_not_unique:${label}`);return text.slice(0,i)+replacement+text.slice(i+anchor.length);}
function writeAtomic(file,text,mode,uid,gid){const tmp=`${file}.host-actions-v2-${process.pid}-${Date.now()}.tmp`;fs.writeFileSync(tmp,text,{mode});fs.chmodSync(tmp,mode);fs.chownSync(tmp,uid,gid);fs.renameSync(tmp,file);}
function backupFile(file,dir){const dest=path.join(dir,file.replace(/^\//,'').replace(/\//g,'__'));fs.copyFileSync(file,dest,fs.constants.COPYFILE_EXCL);fs.chmodSync(dest,0o600);return dest;}
function nodeCheck(file){cp.execFileSync('/usr/local/bin/prhm-node',['--check',file],{stdio:'pipe',timeout:15000});}
function systemctl(...args){return cp.execFileSync('systemctl',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();}
function curlUnix(socket,url){return cp.execFileSync('curl',['-fsS','--max-time','5','--unix-socket',socket,url],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:8000}).trim();}
function sleep(ms){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);}
function waitFor(fn,attempts=30,delay=500){let last;for(let i=0;i<attempts;i++){try{const x=fn();if(x)return x;}catch(e){last=e;}sleep(delay);}throw last||Error('health_timeout');}

function patchPolicy(input){
  const p=JSON.parse(input);
  if(p.schema_version!=='prhm.approval-policy.v1')throw Error('unexpected_policy_schema');
  p.version=VERSION;
  p.operations=p.operations||{};
  p.typed_scopes=Array.isArray(p.typed_scopes)?p.typed_scopes:[];
  for(const [action,spec] of Object.entries(ACTIONS)){
    p.operations[spec.operation]={level:4};
    const matches=p.typed_scopes.filter(x=>x&&x.tool==='host_action_v2_apply'&&x.project==='control_plane'&&x.environment==='production'&&x.action===action&&x.risk==='critical'&&x.operation===spec.operation);
    if(matches.length>1)throw Error(`duplicate_scope:${action}`);
    if(matches.length===0)p.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',environment:'production',action,risk:'critical',operation:spec.operation,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
  }
  return JSON.stringify(p,null,2)+'\n';
}

const BASE_CONSTANTS=`\nconst HOST_ACTIONS_V2_BASE_MARKER = true;\nconst HOST_ACTION_V2_SPECS = Object.freeze({\n  agent_api_process_sandbox_v1: { operation: 'host_action.agent_api_process_sandbox_v1', rollback: 'host-action-v2:agent-api-process-sandbox:auto-backup' },\n  agent_api_filesystem_confinement_v1: { operation: 'host_action.agent_api_filesystem_confinement_v1', rollback: 'host-action-v2:agent-api-filesystem-confinement:auto-backup' },\n  agent_api_capability_minimize_v1: { operation: 'host_action.agent_api_capability_minimize_v1', rollback: 'host-action-v2:agent-api-capability-minimize:auto-backup' }\n});\n`;

const BASE_ROUTES=`\n    if (req.method === 'POST' && req.url === '/v2/host-actions/request') {\n      const input = await readBody(req);\n      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1) throw Object.assign(new Error('invalid_host_action_v2_request'), { status: 400 });\n      const action = String(input.action || '');\n      const spec = HOST_ACTION_V2_SPECS[action];\n      if (!spec) throw Object.assign(new Error('host_action_v2_not_allowed'), { status: 400 });\n      const env = readEnvFile(APPROVAL_CLIENT_ENV);\n      if (!env.APPROVAL_REQUEST_TOKEN) throw new Error('approval_request_token_missing');\n      const args = { action };\n      const argHash = argumentsSha256(args);\n      const result = approvalHttp('POST', '/v1/requests', env.APPROVAL_REQUEST_TOKEN, {\n        principal_id:'mohammad', role:'mcp-operator', tool:'host_action_v2_apply', project:'control_plane', environment:'production', action, risk:'critical', operation:spec.operation, arguments:args, arguments_sha256:argHash, ttl_seconds:180, rollback_reference:spec.rollback\n      });\n      const request = result.request || {};\n      if (!request.request_id || Number(request.level)!==4 || String(request.action||'')!==action || String(request.arguments_sha256||'')!==argHash) throw Object.assign(new Error('host_action_v2_request_binding_mismatch'), { status:409 });\n      return send(res,201,{ok:true,request,action,arguments_sha256:argHash});\n    }\n\n    if (req.method === 'POST' && req.url === '/v2/host-actions/confirm') {\n      const input = await readBody(req);\n      const allowed = new Set(['request_id','action','second_confirmation','note']);\n      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('invalid_host_action_v2_confirm_body'), { status:400 });\n      for (const key of Object.keys(input)) if (!allowed.has(key)) throw Object.assign(new Error('host_action_v2_confirm_field_not_allowed:'+key), { status:400 });\n      const requestId=String(input.request_id||'');\n      if(!/^[0-9a-f-]{36}$/i.test(requestId))throw Object.assign(new Error('invalid_request_id'),{status:400});\n      const action=String(input.action||'');\n      const spec=HOST_ACTION_V2_SPECS[action];\n      if(!spec)throw Object.assign(new Error('host_action_v2_not_allowed'),{status:400});\n      if(String(input.second_confirmation||'')!==CONFIRM_LITERAL)throw Object.assign(new Error('critical_second_confirmation_required'),{status:409});\n      const env=readEnvFile(APPROVAL_CLIENT_ENV);\n      if(!env.APPROVAL_DECISION_TOKEN)throw new Error('approval_decision_token_missing');\n      const result=approvalHttp('POST','/v1/requests/'+requestId+'/decision',env.APPROVAL_DECISION_TOKEN,{decision:'accept',second_confirmation:CONFIRM_LITERAL,rollback_reference:spec.rollback,note:String(input.note||'Approved fixed Host Actions v2 stage')});\n      const approval=result.approval||{};\n      const token=String(result.approval_token||result.token||approval.token||'');\n      const argHash=argumentsSha256({action});\n      if(token.length<32||token.length>16384)throw Object.assign(new Error('approval_token_not_returned'),{status:502});\n      if(approval.execution_authorized!==true)throw Object.assign(new Error('approval_not_execution_authorized'),{status:409});\n      if(approval.action&&String(approval.action)!==action)throw Object.assign(new Error('approval_action_mismatch'),{status:409});\n      if(approval.arguments_sha256&&String(approval.arguments_sha256)!==argHash)throw Object.assign(new Error('approval_arguments_hash_mismatch'),{status:409});\n      return send(res,200,{ok:true,request:result.request,approval,approval_token:token});\n    }\n\n    if (req.method === 'POST' && req.url === '/v2/host-actions/authorize-consume') {\n      const input=await readBody(req);\n      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['action','approval_token'].includes(k)))throw Object.assign(new Error('invalid_host_action_v2_authorize_body'),{status:400});\n      const action=String(input.action||'');\n      const spec=HOST_ACTION_V2_SPECS[action];\n      if(!spec)throw Object.assign(new Error('host_action_v2_not_allowed'),{status:400});\n      const token=String(input.approval_token||'');\n      if(token.length<32||token.length>16384)throw Object.assign(new Error('approval_token_required'),{status:400});\n      const argHash=argumentsSha256({action});\n      const binding={approval_token:token,principal_id:'mohammad',role:'mcp-operator',tool:'host_action_v2_apply',project:'control_plane',environment:'production',action,risk:'critical',operation:spec.operation,arguments_sha256:argHash};\n      const validated=await approvalBridge('/v1/validate',binding);\n      if(validated.valid!==true)throw Object.assign(new Error('host_action_v2_approval_validation_failed'),{status:409});\n      const consumed=await approvalBridge('/v1/consume',{...binding,consumer:'prhm-agent-selfmaint-exec-host-actions-v2'});\n      if(consumed.consumed!==true)throw Object.assign(new Error('host_action_v2_approval_consume_failed'),{status:409});\n      return send(res,200,{ok:true,valid:true,consumed:true,action,arguments_sha256:argHash,token_exposed:false});\n    }\n`;

function patchBase(input){
  if(input.includes('HOST_ACTIONS_V2_BASE_MARKER'))throw Error('base_v2_already_patched');
  let out=replaceOnce(input,'const HOST_ACTIONS_V1_BASE_MARKER = true;','const HOST_ACTIONS_V1_BASE_MARKER = true;'+BASE_CONSTANTS,'base_v2_constants');
  const anchor="    if (req.method === 'POST' && req.url === '/v1/apply') {";
  out=replaceOnce(out,anchor,BASE_ROUTES+anchor,'base_v2_routes');
  return out;
}

const EXEC_CONSTANTS=`\nconst HOST_ACTIONS_V2_EXEC_MARKER = true;\nconst HOST_ACTION_V2_REQUEST_DIR = path.join(DATA_ROOT, 'host-action-v2-requests');\nconst HOST_ACTION_V2_JOB_DIR = path.join(DATA_ROOT, 'host-action-v2-jobs');\nconst HOST_ACTION_V2_BACKUP_DIR = path.join(DATA_ROOT, 'host-action-v2-backups');\nconst HOST_ACTION_V2_DROPIN_DIR = '/etc/systemd/system/prhm-agent-api.service.d';\nconst HOST_ACTION_V2_SPECS = Object.freeze({\n  agent_api_process_sandbox_v1:{operation:'host_action.agent_api_process_sandbox_v1',dropin:'91-prhm-process-sandbox.conf',depends:[],config:${JSON.stringify(PROCESS_CONFIG)}},\n  agent_api_filesystem_confinement_v1:{operation:'host_action.agent_api_filesystem_confinement_v1',dropin:'92-prhm-filesystem-confinement.conf',depends:['agent_api_process_sandbox_v1'],config:${JSON.stringify(FILESYSTEM_CONFIG)}},\n  agent_api_capability_minimize_v1:{operation:'host_action.agent_api_capability_minimize_v1',dropin:'93-prhm-capability-minimize.conf',depends:['agent_api_process_sandbox_v1','agent_api_filesystem_confinement_v1'],config:${JSON.stringify(CAPABILITY_CONFIG)}}\n});\n`;

const EXEC_HELPERS=`\nfunction hostActionV2RequestFile(id){return path.join(HOST_ACTION_V2_REQUEST_DIR, validateUuid(id)+'.json');}\nfunction hostActionV2JobFile(id){return path.join(HOST_ACTION_V2_JOB_DIR, validateUuid(id)+'.json');}\nfunction hostActionV2Spec(action){const s=HOST_ACTION_V2_SPECS[String(action||'')];if(!s)throw new Error('host_action_v2_not_allowed');return s;}\nfunction loadHostActionV2Request(id){const file=hostActionV2RequestFile(id);if(!fs.existsSync(file))throw new Error('host_action_v2_request_not_found');const r=readJson(file);hostActionV2Spec(r.action);if(!r.expires_at||Date.now()>=Date.parse(r.expires_at)){try{fs.unlinkSync(file)}catch{};throw new Error('host_action_v2_request_expired');}return r;}\nfunction writeHostActionV2Job(id,fields){const file=hostActionV2JobFile(id);const current=fs.existsSync(file)?readJson(file):{};const next={...current,request_id:id,...fields,updated_at:new Date().toISOString()};atomicJson(file,next);return next;}\nfunction verifyProcessSandboxV2(){const required={NoNewPrivileges:'yes',PrivateTmp:'yes',ProtectKernelTunables:'yes',ProtectKernelModules:'yes',ProtectControlGroups:'yes',RestrictNamespaces:'yes',RestrictSUIDSGID:'yes',LockPersonality:'yes'};const actual={};for(const [n,e] of Object.entries(required)){actual[n]=systemdProp(n);if(actual[n]!==e)throw new Error('v2_process_property_mismatch:'+n+':'+actual[n]+':'+e);}return actual;}\nfunction verifyFilesystemV2(){const actual={ProtectSystem:systemdProp('ProtectSystem'),ProtectHome:systemdProp('ProtectHome'),ReadWritePaths:systemdProp('ReadWritePaths')};if(actual.ProtectSystem!=='full')throw new Error('v2_filesystem_property_mismatch:ProtectSystem:'+actual.ProtectSystem);if(actual.ProtectHome!=='read-only')throw new Error('v2_filesystem_property_mismatch:ProtectHome:'+actual.ProtectHome);for(const p of ['/home/agent/ssh-agent-api','/home/agent/ssh-agent-runtime','/home/prhm','/home/honartik','/home/drtarjomeh','/mnt/imotion-prod-vm'])if(!actual.ReadWritePaths.includes(p))throw new Error('v2_readwritepath_missing:'+p);return actual;}\nfunction verifyCapabilitiesV2(){const actual={CapabilityBoundingSet:systemdProp('CapabilityBoundingSet').toLowerCase(),AmbientCapabilities:systemdProp('AmbientCapabilities')};for(const blocked of ['cap_sys_admin','cap_net_admin','cap_sys_module','cap_bpf','cap_sys_ptrace'])if(actual.CapabilityBoundingSet.split(/\\s+/).includes(blocked))throw new Error('v2_dangerous_capability_present:'+blocked);if(actual.AmbientCapabilities.trim()!=='')throw new Error('v2_ambient_capabilities_not_empty');return actual;}\nfunction verifyHostActionV2Dependencies(action){if(action==='agent_api_filesystem_confinement_v1'){verifyProcessSandboxV2();}if(action==='agent_api_capability_minimize_v1'){verifyProcessSandboxV2();verifyFilesystemV2();}}\nfunction verifyHostActionV2(action){if(action==='agent_api_process_sandbox_v1')return verifyProcessSandboxV2();if(action==='agent_api_filesystem_confinement_v1')return verifyFilesystemV2();if(action==='agent_api_capability_minimize_v1')return verifyCapabilitiesV2();throw new Error('host_action_v2_not_allowed');}\nasync function applyHostActionV2(action){const spec=hostActionV2Spec(action);verifyHostActionV2Dependencies(action);ensureDir(HOST_ACTION_V2_DROPIN_DIR,0o755);ensureDir(HOST_ACTION_V2_BACKUP_DIR,0o700);const target=path.join(HOST_ACTION_V2_DROPIN_DIR,spec.dropin);const existed=fs.existsSync(target);let backup=null;if(existed){backup=path.join(HOST_ACTION_V2_BACKUP_DIR,action+'-'+Date.now()+'.bak');fs.copyFileSync(target,backup,fs.constants.COPYFILE_EXCL);fs.chmodSync(backup,0o600);}let mutated=false;try{atomicText(target,spec.config,0o644);mutated=true;execSystemctl(['daemon-reload']);execSystemctl(['restart','prhm-agent-api.service']);if(!(await waitAgentApiHealthy()))throw new Error('agent_api_health_failed_after_v2_stage');const properties=verifyHostActionV2(action);return{ok:true,action,service:'prhm-agent-api.service',dropin:target,previous_dropin_existed:existed,backup_path:backup,rollback_performed:false,properties};}catch(error){if(mutated){try{if(existed&&backup){const previous=fs.readFileSync(backup);const tmp=target+'.rollback-'+process.pid+'-'+Date.now()+'.tmp';fs.writeFileSync(tmp,previous,{mode:0o644});fs.renameSync(tmp,target);}else{try{fs.unlinkSync(target)}catch(e){if(e.code!=='ENOENT')throw e;}}execSystemctl(['daemon-reload']);execSystemctl(['restart','prhm-agent-api.service']);if(!(await waitAgentApiHealthy()))throw new Error('agent_api_health_failed_after_v2_rollback');}catch(rb){throw new Error('host_action_v2_failed_and_rollback_failed:'+error.message+':'+rb.message);}}throw new Error('host_action_v2_failed_rolled_back:'+error.message);}}\n`;

const EXEC_ROUTES=`\n    if (req.method === 'POST' && req.url === '/v2/host-actions/request') {\n      const input=await readBody(req);\n      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1)throw new Error('invalid_host_action_v2_request');\n      const action=String(input.action||'');hostActionV2Spec(action);\n      const out=await callBase('/v2/host-actions/request','POST',{action});\n      const requestId=out?.request?.request_id;validateUuid(requestId);\n      const record={request_id:requestId,action,arguments_sha256:out.arguments_sha256||out?.request?.arguments_sha256||null,expires_at:out?.request?.expires_at||null,created_at:new Date().toISOString()};\n      if(!record.arguments_sha256||!SHA_RE.test(record.arguments_sha256))throw new Error('host_action_v2_arguments_hash_missing');\n      atomicJson(hostActionV2RequestFile(requestId),record);\n      return json(res,201,{ok:true,request:sanitize(out.request||{}),action,arguments_sha256:record.arguments_sha256,executor:'server-side-host-actions-v2',spec_fixed_server_side:true});\n    }\n\n    if (req.method === 'POST' && req.url === '/v2/host-actions/execute') {\n      const body=await readBody(req);const requestId=validateUuid(body.request_id);if(body.second_confirmation!==CONFIRMATION)throw new Error('Level-4 confirmation required');if(body.note!==undefined&&(typeof body.note!=='string'||body.note.length<3||body.note.length>1000))throw new Error('invalid_note');\n      const record=loadHostActionV2Request(requestId);const action=record.action;hostActionV2Spec(action);\n      if(fs.existsSync(hostActionV2JobFile(requestId))){const existing=readJson(hostActionV2JobFile(requestId));if(existing.status==='succeeded')return json(res,200,{ok:true,job:sanitize(existing)});if(['confirming','authorizing','applying'].includes(existing.status))throw new Error('host_action_v2_already_processing');throw new Error('host_action_v2_request_already_failed_create_new_request');}\n      writeHostActionV2Job(requestId,{action,status:'confirming',started_at:new Date().toISOString()});let confirmed=false,consumed=false;\n      try{const confirm=await callBase('/v2/host-actions/confirm','POST',{request_id:requestId,action,second_confirmation:body.second_confirmation,...(body.note?{note:body.note}:{})});const token=String(confirm.approval_token||'');if(token.length<32||token.length>16384)throw new Error('missing_server_side_host_action_v2_approval_token');confirmed=true;writeHostActionV2Job(requestId,{action,status:'authorizing',approval_id:confirm?.approval?.approval_id||null});const authz=await callBase('/v2/host-actions/authorize-consume','POST',{action,approval_token:token});if(authz.valid!==true||authz.consumed!==true)throw new Error('host_action_v2_authorization_failed');consumed=true;writeHostActionV2Job(requestId,{action,status:'applying'});const result=await applyHostActionV2(action);const job=writeHostActionV2Job(requestId,{action,status:'succeeded',confirmed,approval_consumed:consumed,finished_at:new Date().toISOString(),result});try{fs.unlinkSync(hostActionV2RequestFile(requestId))}catch{};return json(res,200,{ok:true,job:sanitize(job)});}catch(error){const job=writeHostActionV2Job(requestId,{action,status:'failed',confirmed,approval_consumed:consumed,finished_at:new Date().toISOString(),error:String(error?.message||error).slice(0,3000)});if(confirmed||consumed){try{fs.unlinkSync(hostActionV2RequestFile(requestId))}catch{}}return json(res,409,{ok:false,error:job.error,job:sanitize(job)});}\n    }\n\n    if (req.method === 'POST' && req.url === '/v2/host-actions/status') {const body=await readBody(req);const requestId=validateUuid(body.request_id);const file=hostActionV2JobFile(requestId);if(!fs.existsSync(file))return json(res,404,{ok:false,error:'host_action_v2_status_not_found'});return json(res,200,{ok:true,job:sanitize(readJson(file))});}\n`;

function patchExec(input){
  if(input.includes('HOST_ACTIONS_V2_EXEC_MARKER'))throw Error('exec_v2_already_patched');
  let out=replaceOnce(input,'const HOST_ACTIONS_V1_EXEC_MARKER = true;','const HOST_ACTIONS_V1_EXEC_MARKER = true;'+EXEC_CONSTANTS,'exec_v2_constants');
  out=replaceOnce(out,'async function handle(req, res) {',EXEC_HELPERS+'async function handle(req, res) {','exec_v2_helpers');
  const routeAnchor="    if (req.method === 'POST' && req.url === '/v1/request') {";
  out=replaceOnce(out,routeAnchor,EXEC_ROUTES+routeAnchor,'exec_v2_routes');
  out=replaceOnce(out,'ensureDir(HOST_ACTION_JOB_DIR, 0o700);','ensureDir(HOST_ACTION_JOB_DIR, 0o700);\nensureDir(HOST_ACTION_V2_REQUEST_DIR, 0o700);\nensureDir(HOST_ACTION_V2_JOB_DIR, 0o700);\nensureDir(HOST_ACTION_V2_BACKUP_DIR, 0o700);','exec_v2_dirs');
  const health="return json(res, 200, { ok: true, service: 'prhm-agent-selfmaint-exec', version: '1.1.1-host-actions-v1-compat', host_actions: [HOST_ACTION_NAME], base: sanitize(base) });";
  const health2="return json(res, 200, { ok: true, service: 'prhm-agent-selfmaint-exec', version: '1.2.0-host-actions-v2', host_actions: [HOST_ACTION_NAME], host_actions_v2: Object.keys(HOST_ACTION_V2_SPECS), base: sanitize(base) });";
  out=replaceOnce(out,health,health2,'exec_v2_health');
  return out;
}

function buildPlugin(){return `import http from 'node:http';\nimport { z } from 'zod';\nimport { textResult } from '../core/result.js';\nconst SOCKET='/run/prhm-agent-selfmaint-exec/exec.sock';\nconst MAX_RESPONSE=400000;\nconst Confirmation=z.literal('CONFIRM_LEVEL_4_CRITICAL');\nconst HostActionV2=z.enum(['agent_api_process_sandbox_v1','agent_api_filesystem_confinement_v1','agent_api_capability_minimize_v1']);\nconst RO={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};\nconst REQUEST={readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false};\nconst APPLY={readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false};\nfunction callExec(pathname,method='GET',body,timeoutMs=15000){return new Promise((resolve,reject)=>{const data=body===undefined?null:Buffer.from(JSON.stringify(body));const headers=data?{'content-type':'application/json','content-length':data.length}:{};const req=http.request({socketPath:SOCKET,path:pathname,method,headers},res=>{let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size<=MAX_RESPONSE)chunks.push(chunk)});res.on('end',()=>{if(size>MAX_RESPONSE)return reject(new Error('host_actions_v2_exec_response_too_large'));let out={};try{out=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{return reject(new Error('host_actions_v2_exec_invalid_response'))}if(res.statusCode<200||res.statusCode>=300||out.ok!==true)return reject(new Error(String(out.error||'host_actions_v2_exec_rejected_'+res.statusCode)));resolve(out)});});req.setTimeout(timeoutMs,()=>req.destroy(new Error('host_actions_v2_exec_timeout')));req.on('error',e=>reject(new Error('host_actions_v2_exec_bridge_error:'+e.message)));data?req.end(data):req.end();});}\nexport function registerHostActionsV2Plugin(mcp){mcp.registerTool('host_action_v2_request',{title:'Request Fixed Host Action v2 Approval',description:'Create a Level-4 request for one of three fixed staged Agent API hardening actions. No arbitrary command, path, or service input.',inputSchema:{action:HostActionV2},annotations:REQUEST},async args=>textResult(await callExec('/v2/host-actions/request','POST',args)));mcp.registerTool('host_action_v2_apply',{title:'Apply Approved Fixed Host Action v2 Stage',description:'Execute one previously approved fixed staged Agent API hardening action with stage-local automatic rollback.',inputSchema:{request_id:z.string().uuid(),second_confirmation:Confirmation,note:z.string().min(3).max(1000).optional()},annotations:APPLY},async args=>textResult(await callExec('/v2/host-actions/execute','POST',args,1200000)));mcp.registerTool('host_action_v2_status',{title:'Fixed Host Action v2 Status',description:'Read persisted status and verification evidence for a Host Actions v2 request.',inputSchema:{request_id:z.string().uuid()},annotations:RO},async args=>textResult(await callExec('/v2/host-actions/status','POST',args)));}\n`;}

function patchRegistry(input){
  if(input.includes('registerHostActionsV2Plugin')||input.includes('../plugins/hostActionsV2.js'))throw Error('registry_v2_already_patched');
  let out=replaceOnce(input,"import { registerHostActionsPlugin } from '../plugins/hostActions.js';","import { registerHostActionsPlugin } from '../plugins/hostActions.js';\nimport { registerHostActionsV2Plugin } from '../plugins/hostActionsV2.js';",'registry_v2_import');
  out=replaceOnce(out,'  registerHostActionsPlugin(mcp, context);','  registerHostActionsPlugin(mcp, context);\n  registerHostActionsV2Plugin(mcp, context);','registry_v2_call');
  return out;
}

function validateCandidate(patched){
  const p=JSON.parse(patched.policy);
  for(const [action,spec] of Object.entries(ACTIONS)){
    if(Number(p.operations?.[spec.operation]?.level)!==4)throw Error('policy_level_not_4:'+action);
    const scopes=p.typed_scopes.filter(x=>x&&x.tool==='host_action_v2_apply'&&x.action===action&&x.operation===spec.operation&&x.project==='control_plane'&&x.environment==='production'&&x.risk==='critical');
    if(scopes.length!==1)throw Error('policy_scope_count:'+action+':'+scopes.length);
  }
  const all=patched.exec+'\n'+patched.plugin;
  if(all.includes('MemoryDenyWriteExecute'))throw Error('MemoryDenyWriteExecute_forbidden');
  if(/\nUser=/.test(PROCESS_CONFIG+FILESYSTEM_CONFIG+CAPABILITY_CONFIG)||/\nGroup=/.test(PROCESS_CONFIG+FILESYSTEM_CONFIG+CAPABILITY_CONFIG))throw Error('User_Group_forbidden_in_v2');
  for(const a of Object.keys(ACTIONS))if(!patched.exec.includes(a)||!patched.plugin.includes(a))throw Error('action_missing:'+a);
  if(!patched.exec.includes("path.join(DATA_ROOT, 'host-action-v2-backups')"))throw Error('backup_not_in_executor_data_root');
  if(patched.exec.includes("'/var/backups/prhm-host-actions-v2'"))throw Error('backup_outside_executor_writable_state');
  return true;
}

function selftest(){
  const fakePolicy=JSON.stringify({schema_version:'prhm.approval-policy.v1',version:'x',operations:{'host_action.harden_agent_api_v1':{level:4}},typed_scopes:[]});
  const p=patchPolicy(fakePolicy);validateCandidate({policy:p,exec:EXEC_CONSTANTS+EXEC_HELPERS+EXEC_ROUTES,plugin:buildPlugin()});
  const baseFixture="const HOST_ACTIONS_V1_BASE_MARKER = true;\n    if (req.method === 'POST' && req.url === '/v1/apply') {";patchBase(baseFixture);
  const execFixture="const HOST_ACTIONS_V1_EXEC_MARKER = true;\nasync function handle(req, res) {\nreturn json(res, 200, { ok: true, service: 'prhm-agent-selfmaint-exec', version: '1.1.1-host-actions-v1-compat', host_actions: [HOST_ACTION_NAME], base: sanitize(base) });\n    if (req.method === 'POST' && req.url === '/v1/request') {\nensureDir(HOST_ACTION_JOB_DIR, 0o700);";patchExec(execFixture);
  const regFixture="import { registerHostActionsPlugin } from '../plugins/hostActions.js';\n  registerHostActionsPlugin(mcp, context);";patchRegistry(regFixture);
  return {ok:true,actions:Object.keys(ACTIONS),version:VERSION,offline_spec_sha256:'b85869c245e31655c0bdd1d1c2db67c25e4e945162b88d055d9fbbe996b7828d'};
}

function restore(file,backup){const st=fs.statSync(file);const data=fs.readFileSync(backup);const tmp=`${file}.rollback-${process.pid}-${Date.now()}.tmp`;fs.writeFileSync(tmp,data,{mode:st.mode&0o777});fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,file);}

function main(){
  if(process.argv.includes('--selftest-only')){console.log(JSON.stringify(selftest()));return;}
  const preflightOnly=process.argv.includes('--preflight-only');
  if(process.getuid&&process.getuid()!==0)throw Error('root_required');
  if(fs.existsSync(PATHS.marker))throw Error('host_actions_v2_bootstrap_marker_exists');
  for(const [label,file] of Object.entries({policy:PATHS.policy,base:PATHS.base,exec:PATHS.exec,registry:PATHS.registry,hostActionsV1:PATHS.hostActionsV1}))assertSha(label,file,EXPECTED[label]);
  if(fs.existsSync(PATHS.hostActionsV2))throw Error('host_actions_v2_plugin_already_exists');
  const originals={policy:read(PATHS.policy),base:read(PATHS.base),exec:read(PATHS.exec),registry:read(PATHS.registry)};
  const patched={policy:patchPolicy(originals.policy),base:patchBase(originals.base),exec:patchExec(originals.exec),registry:patchRegistry(originals.registry),plugin:buildPlugin()};
  validateCandidate(patched);
  const dir=`/tmp/prhm-host-actions-v2-preflight-${process.pid}`;fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const files={base:path.join(dir,'base-server.js'),exec:path.join(dir,'exec-server.js'),registry:path.join(dir,'registry.js'),plugin:path.join(dir,'hostActionsV2.js')};
  fs.writeFileSync(files.base,patched.base,{mode:0o600});fs.writeFileSync(files.exec,patched.exec,{mode:0o600});fs.writeFileSync(files.registry,patched.registry,{mode:0o600});fs.writeFileSync(files.plugin,patched.plugin,{mode:0o600});
  nodeCheck(files.base);nodeCheck(files.exec);nodeCheck(files.registry);nodeCheck(files.plugin);JSON.parse(patched.policy);
  const report={ok:true,preflight_only:preflightOnly,current_hashes:Object.fromEntries(Object.entries(EXPECTED)),candidate_hashes:{policy:shaText(patched.policy),base:shaText(patched.base),exec:shaText(patched.exec),registry:shaText(patched.registry),hostActionsV1:EXPECTED.hostActionsV1,hostActionsV2:shaText(patched.plugin)},actions:Object.keys(ACTIONS),policy_version:VERSION,backup_root:'DATA_ROOT/host-action-v2-backups'};
  if(preflightOnly){console.log(JSON.stringify(report));return;}
  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);const backupDir=`/var/backups/prhm-host-actions-v2-bootstrap-${stamp}`;fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
  const backups=[];const created=[];
  try{
    for(const f of [PATHS.policy,PATHS.base,PATHS.exec,PATHS.registry])backups.push([f,backupFile(f,backupDir)]);
    const stats=Object.fromEntries([PATHS.policy,PATHS.base,PATHS.exec,PATHS.registry].map(f=>[f,fs.statSync(f)]));
    writeAtomic(PATHS.policy,patched.policy,stats[PATHS.policy].mode&0o777,stats[PATHS.policy].uid,stats[PATHS.policy].gid);
    writeAtomic(PATHS.base,patched.base,stats[PATHS.base].mode&0o777,stats[PATHS.base].uid,stats[PATHS.base].gid);
    writeAtomic(PATHS.exec,patched.exec,stats[PATHS.exec].mode&0o777,stats[PATHS.exec].uid,stats[PATHS.exec].gid);
    writeAtomic(PATHS.registry,patched.registry,stats[PATHS.registry].mode&0o777,stats[PATHS.registry].uid,stats[PATHS.registry].gid);
    const pst=fs.statSync(path.dirname(PATHS.hostActionsV1));writeAtomic(PATHS.hostActionsV2,patched.plugin,0o644,pst.uid,pst.gid);created.push(PATHS.hostActionsV2);
    systemctl('restart','prhm-company-approval.service');systemctl('restart','prhm-agent-selfmaint.service');systemctl('restart','prhm-agent-selfmaint-exec.service');systemctl('restart','prhm-agent-mcp.service');
    const health=JSON.parse(waitFor(()=>curlUnix('/run/prhm-agent-selfmaint-exec/exec.sock','http://localhost/health')));for(const a of Object.keys(ACTIONS))if(!Array.isArray(health.host_actions_v2)||!health.host_actions_v2.includes(a))throw Error('v2_action_missing_from_health:'+a);
    fs.writeFileSync(PATHS.marker,JSON.stringify({...report,installed_at:new Date().toISOString(),backup_dir:backupDir})+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({...report,installed:true,backup_dir:backupDir}));
  }catch(error){const errs=[];for(const f of created.reverse())try{fs.unlinkSync(f)}catch(e){if(e.code!=='ENOENT')errs.push(e.message)}for(const [f,b] of backups.reverse())try{restore(f,b)}catch(e){errs.push(f+':'+e.message)}for(const s of ['prhm-company-approval.service','prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service','prhm-agent-mcp.service'])try{systemctl('restart',s)}catch(e){errs.push(s+':'+e.message)}if(errs.length)throw Error('v2_bootstrap_failed_and_rollback_failed:'+error.message+':'+errs.join('|'));throw Error('v2_bootstrap_failed_rolled_back:'+error.message);}
}

main();
