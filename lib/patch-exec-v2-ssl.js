#!/usr/bin/env node
'use strict';

const fs=require('fs');
const ACTION='repair_node1_ssl_deploy_v1';

function fail(message){throw new Error(message);}
function count(text,needle){let n=0,p=0;while((p=text.indexOf(needle,p))!==-1){n++;p+=needle.length;}return n;}
function replaceOnce(text,oldText,newText,label){const n=count(text,oldText);if(n!==1)fail(label+'_cardinality:'+n);return text.replace(oldText,newText);}
function replaceRange(text,startAnchor,endAnchor,replacement,label){
  const ns=count(text,startAnchor),ne=count(text,endAnchor);if(ns!==1||ne!==1)fail(label+'_anchor_cardinality:'+ns+':'+ne);
  const s=text.indexOf(startAnchor),e=text.indexOf(endAnchor,s);if(e<=s)fail(label+'_anchor_order');return text.slice(0,s)+replacement+text.slice(e);
}

const SSL_RUNTIME=String.raw`
const NODE1_SSL_ACTION='repair_node1_ssl_deploy_v1';
const NODE1_SSL_HOST='185.191.76.138';
const NODE1_SSL_PORT=22;
const NODE1_SSL_TARGET_PATH='/usr/local/sbin/prhm-edge-cert-deploy';
const NODE1_SSL_HELPER_VERSION='prhm.node1.ssl-helper.v1';
const NODE1_SSL_KEY='/etc/prhm-host-actions/node1_ssl_ed25519';
const NODE1_SSL_KNOWN_HOSTS='/etc/prhm-host-actions/known_hosts';

function canonicalJsonLocal(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonicalJsonLocal).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJsonLocal(value[k])).join(',')+'}';}
function sha256Local(value){return crypto.createHash('sha256').update(typeof value==='string'?value:canonicalJsonLocal(value),'utf8').digest('hex');}
function knownHostKeySha256(){
  const text=fs.readFileSync(NODE1_SSL_KNOWN_HOSTS,'utf8');
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'));
  if(lines.length!==1)throw new Error('node1_known_hosts_cardinality:'+lines.length);
  const fields=lines[0].split(/\s+/);
  if(fields.length<3)throw new Error('node1_known_hosts_invalid');
  if(![NODE1_SSL_HOST,'['+NODE1_SSL_HOST+']:'+NODE1_SSL_PORT].includes(fields[0]))throw new Error('node1_known_hosts_target_mismatch');
  if(fields[1]!=='ecdsa-sha2-nistp256')throw new Error('node1_known_hosts_keytype_mismatch:'+fields[1]);
  let blob;try{blob=Buffer.from(fields[2],'base64');}catch{throw new Error('node1_known_hosts_key_invalid');}
  if(!blob.length)throw new Error('node1_known_hosts_key_empty');
  return crypto.createHash('sha256').update(blob).digest('hex');
}
function runNode1Ssl(command,timeout=120000){
  if(typeof command!=='string'||command.length<1||command.length>300||/[\r\n\0]/.test(command))throw new Error('node1_ssl_command_invalid');
  if(!fs.existsSync(NODE1_SSL_KEY)||!fs.statSync(NODE1_SSL_KEY).isFile())throw new Error('node1_ssl_key_missing');
  if(!fs.existsSync(NODE1_SSL_KNOWN_HOSTS)||!fs.statSync(NODE1_SSL_KNOWN_HOSTS).isFile())throw new Error('node1_ssl_known_hosts_missing');
  const args=['-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+NODE1_SSL_KNOWN_HOSTS,'-o','ConnectTimeout=8','-i',NODE1_SSL_KEY,'-p',String(NODE1_SSL_PORT),'root@'+NODE1_SSL_HOST,command];
  const r=cp.spawnSync('/usr/bin/ssh',args,{encoding:'utf8',timeout,maxBuffer:400000});
  if(r.error)throw new Error('node1_ssl_ssh_error:'+r.error.message);
  const stdout=String(r.stdout||'').slice(0,250000),stderr=String(r.stderr||'').slice(0,20000);
  if(r.status!==0)throw new Error('node1_ssl_remote_failed:'+r.status+':'+(stderr||stdout).slice(0,3000));
  return {stdout,stderr};
}
function parseNode1SslObserve(text){
  const out={};
  for(const raw of String(text||'').split(/\r?\n/)){const line=raw.trim();if(!line)continue;const m=/^(HELPER_VERSION|ACTIVE_SHA256|PAYLOAD_SHA256)=([^\s]+)$/.exec(line);if(!m)throw new Error('node1_ssl_observe_unexpected_output:'+line.slice(0,120));if(out[m[1]]!==undefined)throw new Error('node1_ssl_observe_duplicate:'+m[1]);out[m[1]]=m[2];}
  if(out.HELPER_VERSION!==NODE1_SSL_HELPER_VERSION)throw new Error('node1_ssl_helper_version_mismatch');
  for(const k of ['ACTIVE_SHA256','PAYLOAD_SHA256'])if(!SHA_RE.test(String(out[k]||'')))throw new Error('node1_ssl_observe_sha_invalid:'+k);
  return out;
}
function observeNode1Ssl(){const observed=parseNode1SslObserve(runNode1Ssl('ssl-observe',30000).stdout);return {...observed,HOST_KEY_SHA256:knownHostKeySha256()};}
function node1SslApprovalArgs(){const o=observeNode1Ssl();return {action:NODE1_SSL_ACTION,target_host:NODE1_SSL_HOST,target_port:NODE1_SSL_PORT,target_path:NODE1_SSL_TARGET_PATH,expected_target_sha256:o.ACTIVE_SHA256,payload_sha256:o.PAYLOAD_SHA256,helper_version:o.HELPER_VERSION,host_key_sha256:o.HOST_KEY_SHA256};}
function validateNode1SslRecord(record){
  if(!record||record.action!==NODE1_SSL_ACTION||!record.arguments||typeof record.arguments!=='object'||Array.isArray(record.arguments))throw new Error('node1_ssl_request_record_invalid');
  const a=record.arguments;
  if(a.action!==NODE1_SSL_ACTION||a.target_host!==NODE1_SSL_HOST||Number(a.target_port)!==NODE1_SSL_PORT||a.target_path!==NODE1_SSL_TARGET_PATH||a.helper_version!==NODE1_SSL_HELPER_VERSION)throw new Error('node1_ssl_request_fixed_binding_mismatch');
  for(const k of ['expected_target_sha256','payload_sha256','host_key_sha256'])if(!SHA_RE.test(String(a[k]||'')))throw new Error('node1_ssl_request_sha_invalid:'+k);
  const localHash=sha256Local(a);if(localHash!==record.arguments_sha256)throw new Error('node1_ssl_request_arguments_hash_mismatch');
  return a;
}
function preflightApprovedNode1Ssl(record){
  const a=validateNode1SslRecord(record),o=observeNode1Ssl();
  if(o.ACTIVE_SHA256!==a.expected_target_sha256)throw new Error('node1_ssl_target_drift:'+o.ACTIVE_SHA256);
  if(o.PAYLOAD_SHA256!==a.payload_sha256)throw new Error('node1_ssl_payload_drift:'+o.PAYLOAD_SHA256);
  if(o.HELPER_VERSION!==a.helper_version)throw new Error('node1_ssl_helper_drift');
  if(o.HOST_KEY_SHA256!==a.host_key_sha256)throw new Error('node1_ssl_host_key_drift:'+o.HOST_KEY_SHA256);
  const cmd='ssl-preflight '+a.expected_target_sha256+' '+a.payload_sha256;
  const r=runNode1Ssl(cmd,120000);
  if(!/ACTION_PREFLIGHT=OK(?:\r?\n|$)/.test(r.stdout))throw new Error('node1_ssl_preflight_marker_missing');
  return {arguments:a,observe:o,preflight_stdout:r.stdout.slice(0,60000)};
}
function parseNode1SslApply(text){const out={};for(const raw of String(text||'').split(/\r?\n/)){const line=raw.trim();const m=/^(ACTION_APPLIED|OLD_SHA256|NEW_SHA256|BACKUP|ROLLBACK_PERFORMED)=(.*)$/.exec(line);if(m)out[m[1]]=m[2];}return out;}
function applyNode1SslAction(record){
  const checked=preflightApprovedNode1Ssl(record),a=checked.arguments;
  const r=runNode1Ssl('ssl-apply '+a.expected_target_sha256+' '+a.payload_sha256,180000);
  const result=parseNode1SslApply(r.stdout);
  if(result.ACTION_APPLIED!=='YES')throw new Error('node1_ssl_apply_marker_missing');
  if(result.OLD_SHA256!==a.expected_target_sha256)throw new Error('node1_ssl_apply_old_sha_mismatch');
  if(result.NEW_SHA256!==a.payload_sha256)throw new Error('node1_ssl_apply_new_sha_mismatch');
  if(result.ROLLBACK_PERFORMED!=='NO')throw new Error('node1_ssl_apply_reported_rollback');
  const after=observeNode1Ssl();
  if(after.ACTIVE_SHA256!==a.payload_sha256)throw new Error('node1_ssl_post_apply_sha_mismatch:'+after.ACTIVE_SHA256);
  if(after.PAYLOAD_SHA256!==a.payload_sha256||after.HOST_KEY_SHA256!==a.host_key_sha256||after.HELPER_VERSION!==a.helper_version)throw new Error('node1_ssl_post_apply_binding_drift');
  return {ok:true,action:NODE1_SSL_ACTION,target:NODE1_SSL_HOST,target_path:NODE1_SSL_TARGET_PATH,old_sha256:a.expected_target_sha256,new_sha256:after.ACTIVE_SHA256,payload_sha256:a.payload_sha256,helper_version:a.helper_version,host_key_sha256:a.host_key_sha256,backup_path:String(result.BACKUP||'').slice(0,500),rollback_performed:false,preflight_verified:true,post_apply_verified:true};
}
`;

const REQUEST_ROUTE=String.raw`    if (req.method === 'POST' && req.url === '/v2/host-actions/request') {
      const body=await readBody(req);
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1)throw new Error('invalid_host_action_v2_request');
      const action=String(body.action||'');
      hostActionV2Spec(action);
      const approvalArgs=action===NODE1_SSL_ACTION?node1SslApprovalArgs():{action};
      const expectedHash=sha256Local(approvalArgs);
      const out=await callBase('/v2/host-actions/request','POST',approvalArgs);
      const requestId=out?.request?.request_id;validateUuid(requestId);
      const returnedHash=out.arguments_sha256||out?.request?.arguments_sha256||null;
      if(returnedHash!==expectedHash)throw new Error('host_action_v2_arguments_hash_mismatch');
      const record={request_id:requestId,action,arguments:approvalArgs,arguments_sha256:returnedHash,expires_at:out?.request?.expires_at||null,created_at:new Date().toISOString()};
      if(!record.arguments_sha256||!SHA_RE.test(record.arguments_sha256))throw new Error('host_action_v2_arguments_hash_missing');
      atomicJson(hostActionV2RequestFile(requestId),record);
      return json(res,201,{ok:true,request:sanitize(out.request||{}),action,arguments_sha256:record.arguments_sha256,executor:'server-side-host-actions-v2',spec_fixed_server_side:true});
    }

`;

const EXECUTE_ROUTE=String.raw`    if (req.method === 'POST' && req.url === '/v2/host-actions/execute') {
      const body=await readBody(req),requestId=validateUuid(body.request_id);
      if(body.second_confirmation!==CONFIRMATION)throw new Error('Level-4 confirmation required');
      if(body.note!==undefined&&(typeof body.note!=='string'||body.note.length<3||body.note.length>1000))throw new Error('invalid_note');
      const record=loadHostActionV2Request(requestId),action=record.action;
      if(!record.arguments||sha256Local(record.arguments)!==record.arguments_sha256)throw new Error('host_action_v2_stored_arguments_invalid');
      if(fs.existsSync(hostActionV2JobFile(requestId))){const existing=readJson(hostActionV2JobFile(requestId));if(existing.status==='succeeded')return json(res,200,{ok:true,job:sanitize(existing)});if(['confirming','preflighting','authorizing','applying'].includes(existing.status))throw new Error('host_action_v2_already_processing');throw new Error('host_action_v2_request_already_failed_create_new_request');}
      writeHostActionV2Job(requestId,{action,status:'confirming',started_at:new Date().toISOString(),arguments_sha256:record.arguments_sha256});
      let confirmed=false,consumed=false;
      try{
        const confirmPayload={...record.arguments,request_id:requestId,second_confirmation:body.second_confirmation,...(body.note?{note:body.note}:{})};
        const confirm=await callBase('/v2/host-actions/confirm','POST',confirmPayload);
        const token=String(confirm.approval_token||'');
        if(token.length<32||token.length>16384)throw new Error('missing_server_side_host_action_v2_approval_token');
        if(confirm?.approval?.arguments_sha256&&confirm.approval.arguments_sha256!==record.arguments_sha256)throw new Error('host_action_v2_confirm_arguments_hash_mismatch');
        confirmed=true;
        if(action===NODE1_SSL_ACTION){writeHostActionV2Job(requestId,{action,status:'preflighting',approval_id:confirm?.approval?.approval_id||null});preflightApprovedNode1Ssl(record);}
        writeHostActionV2Job(requestId,{action,status:'authorizing',approval_id:confirm?.approval?.approval_id||null});
        const authz=await callBase('/v2/host-actions/authorize-consume','POST',{...record.arguments,approval_token:token});
        if(authz.valid!==true||authz.consumed!==true||authz.arguments_sha256!==record.arguments_sha256)throw new Error('host_action_v2_authorization_failed');
        consumed=true;writeHostActionV2Job(requestId,{action,status:'applying'});
        const result=await applyHostActionV2(action,record);
        const job=writeHostActionV2Job(requestId,{action,status:'succeeded',confirmed,approval_consumed:consumed,finished_at:new Date().toISOString(),result});
        try{fs.unlinkSync(hostActionV2RequestFile(requestId))}catch{}
        return json(res,200,{ok:true,job:sanitize(job)});
      }catch(error){const job=writeHostActionV2Job(requestId,{action,status:'failed',confirmed,approval_consumed:consumed,finished_at:new Date().toISOString(),error:String(error?.message||error).slice(0,3000)});if(confirmed||consumed){try{fs.unlinkSync(hostActionV2RequestFile(requestId))}catch{}}return json(res,409,{ok:false,error:job.error,job:sanitize(job)});}
    }

`;

function transform(text){
  if(text.includes('NODE1_SSL_ACTION')&&text.includes("repair_node1_ssl_deploy_v1")){if(count(text,'NODE1_SSL_ACTION')<5)fail('existing_ssl_executor_incomplete');return text;}
  let out=replaceOnce(text,"const cp = require('child_process');","const cp = require('child_process');\nconst crypto = require('crypto');",'exec_crypto_import');
  const oldSpec="  agent_api_capability_minimize_v1:{operation:'host_action.agent_api_capability_minimize_v1',dropin:'93-prhm-capability-minimize.conf',depends:['agent_api_process_sandbox_v1','agent_api_filesystem_confinement_v1'],config:\"[Service]\\nCapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_DAC_READ_SEARCH CAP_FOWNER CAP_FSETID CAP_KILL CAP_SETGID CAP_SETUID CAP_NET_BIND_SERVICE\\nAmbientCapabilities=\\n\"}\n});";
  const newSpec="  agent_api_capability_minimize_v1:{operation:'host_action.agent_api_capability_minimize_v1',dropin:'93-prhm-capability-minimize.conf',depends:['agent_api_process_sandbox_v1','agent_api_filesystem_confinement_v1'],config:\"[Service]\\nCapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_DAC_READ_SEARCH CAP_FOWNER CAP_FSETID CAP_KILL CAP_SETGID CAP_SETUID CAP_NET_BIND_SERVICE\\nAmbientCapabilities=\\n\"},\n  repair_node1_ssl_deploy_v1:{operation:'host_action.repair_node1_ssl_deploy_v1',kind:'node1_ssl'}\n});";
  out=replaceOnce(out,oldSpec,newSpec,'exec_v2_spec');
  const runtimeAnchor="\nconst HOST_ACTION_NAME = 'harden_agent_api_v1';";
  out=replaceOnce(out,runtimeAnchor,SSL_RUNTIME+runtimeAnchor,'exec_ssl_runtime_anchor');
  out=replaceOnce(out,"async function applyHostActionV2(action){const spec=hostActionV2Spec(action);","async function applyHostActionV2(action,requestRecord){if(action===NODE1_SSL_ACTION)return applyNode1SslAction(requestRecord);const spec=hostActionV2Spec(action);",'exec_apply_special_case');
  const requestAnchor="    if (req.method === 'POST' && req.url === '/v2/host-actions/request') {";
  const executeAnchor="    if (req.method === 'POST' && req.url === '/v2/host-actions/execute') {";
  const statusAnchor="    if (req.method === 'POST' && req.url === '/v2/host-actions/status')";
  out=replaceRange(out,requestAnchor,executeAnchor,REQUEST_ROUTE,'exec_request_route');
  out=replaceRange(out,executeAnchor,statusAnchor,EXECUTE_ROUTE,'exec_execute_route');
  if(!out.includes("repair_node1_ssl_deploy_v1")||count(out,'preflightApprovedNode1Ssl(record)')<2)fail('exec_ssl_extension_missing');
  return out;
}
if(require.main===module){const file=process.argv[2];if(!file||process.argv.length!==3)fail('usage: patch-exec-v2-ssl.js FILE');process.stdout.write(transform(fs.readFileSync(file,'utf8')));}
module.exports={transform};
