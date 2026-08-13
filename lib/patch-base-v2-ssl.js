#!/usr/bin/env node
'use strict';

const fs = require('fs');
const ACTION='repair_node1_ssl_deploy_v1';
const OPERATION='host_action.repair_node1_ssl_deploy_v1';
const TARGET_HOST='185.191.76.138';
const TARGET_PORT=22;
const TARGET_PATH='/usr/local/sbin/prhm-edge-cert-deploy';
const HELPER_VERSION='prhm.node1.ssl-helper.v1';
const SHA_RE=/^[a-f0-9]{64}$/;

function fail(message){throw new Error(message);}
function count(text,needle){let n=0,p=0;while((p=text.indexOf(needle,p))!==-1){n++;p+=needle.length;}return n;}
function replaceOnce(text,oldText,newText,label){const n=count(text,oldText);if(n!==1)fail(label+'_cardinality:'+n);return text.replace(oldText,newText);}

const SSL_HELPER = String.raw`
function hostActionV2RequestArgs(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(new Error('invalid_host_action_v2_request'),{status:400});
  const action=String(input.action||'');
  if(action==='repair_node1_ssl_deploy_v1'){
    const exact=['action','target_host','target_port','target_path','expected_target_sha256','payload_sha256','helper_version','host_key_sha256'];
    const keys=Object.keys(input).sort(),wanted=[...exact].sort();
    if(keys.length!==wanted.length||keys.some((k,i)=>k!==wanted[i]))throw Object.assign(new Error('invalid_ssl_host_action_request_fields'),{status:400});
  }else{
    if(Object.keys(input).length!==1||!Object.prototype.hasOwnProperty.call(input,'action'))throw Object.assign(new Error('invalid_legacy_host_action_v2_request_fields'),{status:400});
  }
  return hostActionV2ApprovalArgs(input);
}
function hostActionV2ApprovalArgs(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(new Error('invalid_host_action_v2_input'),{status:400});
  const action=String(input.action||'');
  const spec=HOST_ACTION_V2_SPECS[action];
  if(!spec)throw Object.assign(new Error('host_action_v2_not_allowed'),{status:400});
  if(action!=='repair_node1_ssl_deploy_v1'){
    const allowed=new Set(['action','request_id','second_confirmation','note','approval_token']);
    for(const key of Object.keys(input))if(!allowed.has(key))throw Object.assign(new Error('host_action_v2_field_not_allowed:'+key),{status:400});
    return {action};
  }
  const allowed=new Set(['action','target_host','target_port','target_path','expected_target_sha256','payload_sha256','helper_version','host_key_sha256','request_id','second_confirmation','note','approval_token']);
  for(const key of Object.keys(input))if(!allowed.has(key))throw Object.assign(new Error('ssl_host_action_field_not_allowed:'+key),{status:400});
  const args={
    action,
    target_host:String(input.target_host||''),
    target_port:Number(input.target_port),
    target_path:String(input.target_path||''),
    expected_target_sha256:String(input.expected_target_sha256||''),
    payload_sha256:String(input.payload_sha256||''),
    helper_version:String(input.helper_version||''),
    host_key_sha256:String(input.host_key_sha256||'')
  };
  if(args.target_host!=='185.191.76.138')throw Object.assign(new Error('ssl_target_host_mismatch'),{status:400});
  if(args.target_port!==22)throw Object.assign(new Error('ssl_target_port_mismatch'),{status:400});
  if(args.target_path!=='/usr/local/sbin/prhm-edge-cert-deploy')throw Object.assign(new Error('ssl_target_path_mismatch'),{status:400});
  if(args.helper_version!=='prhm.node1.ssl-helper.v1')throw Object.assign(new Error('ssl_helper_version_mismatch'),{status:400});
  for(const name of ['expected_target_sha256','payload_sha256','host_key_sha256'])if(!/^[a-f0-9]{64}$/.test(args[name]))throw Object.assign(new Error('ssl_'+name+'_invalid'),{status:400});
  return args;
}
`;

function transform(text){
  if(text.includes("repair_node1_ssl_deploy_v1") && text.includes('hostActionV2ApprovalArgs')){
    if(count(text,"repair_node1_ssl_deploy_v1")<2)fail('existing_ssl_base_incomplete');
    return text;
  }
  const oldSpec="  agent_api_capability_minimize_v1: { operation: 'host_action.agent_api_capability_minimize_v1', rollback: 'host-action-v2:agent-api-capability-minimize:auto-backup' }\n});";
  const newSpec="  agent_api_capability_minimize_v1: { operation: 'host_action.agent_api_capability_minimize_v1', rollback: 'host-action-v2:agent-api-capability-minimize:auto-backup' },\n  repair_node1_ssl_deploy_v1: { operation: 'host_action.repair_node1_ssl_deploy_v1', rollback: 'host-action-v2:repair-node1-ssl-deploy:auto-backup' }\n});";
  let out=replaceOnce(text,oldSpec,newSpec,'base_v2_spec');
  const helperAnchor="\nconst HOST_ACTION_OPERATION = 'host_action.harden_agent_api_v1';";
  out=replaceOnce(out,helperAnchor,SSL_HELPER+helperAnchor,'base_ssl_helper_anchor');

  const reqOld=`      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1) throw Object.assign(new Error('invalid_host_action_v2_request'), { status: 400 });\n      const action = String(input.action || '');\n      const spec = HOST_ACTION_V2_SPECS[action];\n      if (!spec) throw Object.assign(new Error('host_action_v2_not_allowed'), { status: 400 });\n      const env = readEnvFile(APPROVAL_CLIENT_ENV);\n      if (!env.APPROVAL_REQUEST_TOKEN) throw new Error('approval_request_token_missing');\n      const args = { action };\n      const argHash = argumentsSha256(args);`;
  const reqNew=`      const args = hostActionV2ApprovalArgs(input);\n      const action = args.action;\n      const spec = HOST_ACTION_V2_SPECS[action];\n      const env = readEnvFile(APPROVAL_CLIENT_ENV);\n      if (!env.APPROVAL_REQUEST_TOKEN) throw new Error('approval_request_token_missing');\n      const argHash = argumentsSha256(args);`;
  out=replaceOnce(out,reqOld,reqNew,'base_v2_request_args');

  const confirmAllowedOld="      const allowed = new Set(['request_id','action','second_confirmation','note']);";
  const confirmAllowedNew="      const allowed = new Set(['request_id','action','second_confirmation','note','target_host','target_port','target_path','expected_target_sha256','payload_sha256','helper_version','host_key_sha256']);";
  out=replaceOnce(out,confirmAllowedOld,confirmAllowedNew,'base_v2_confirm_allowed');
  const confirmHashOld="      const argHash=argumentsSha256({action});";
  const confirmHashNew="      const approvalArgs=hostActionV2ApprovalArgs(input);\n      const argHash=argumentsSha256(approvalArgs);";
  out=replaceOnce(out,confirmHashOld,confirmHashNew,'base_v2_confirm_hash');

  const authBodyOld="      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['action','approval_token'].includes(k)))throw Object.assign(new Error('invalid_host_action_v2_authorize_body'),{status:400});";
  const authBodyNew="      if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(new Error('invalid_host_action_v2_authorize_body'),{status:400});\n      const authAllowed=new Set(['action','approval_token','target_host','target_port','target_path','expected_target_sha256','payload_sha256','helper_version','host_key_sha256']);\n      for(const k of Object.keys(input))if(!authAllowed.has(k))throw Object.assign(new Error('invalid_host_action_v2_authorize_field:'+k),{status:400});";
  out=replaceOnce(out,authBodyOld,authBodyNew,'base_v2_authorize_body');
  const authHashOld="      const argHash=argumentsSha256({action});";
  const authHashNew="      const approvalArgs=hostActionV2ApprovalArgs(input);\n      const argHash=argumentsSha256(approvalArgs);";
  out=replaceOnce(out,authHashOld,authHashNew,'base_v2_authorize_hash');

  if(count(out,'hostActionV2ApprovalArgs(input)')!==3)fail('base_ssl_helper_call_cardinality_invalid:'+count(out,'hostActionV2ApprovalArgs(input)'));
  if(count(out,'hostActionV2RequestArgs(input)')!==2)fail('base_ssl_request_helper_cardinality_invalid:'+count(out,'hostActionV2RequestArgs(input)'));
  if(!out.includes(OPERATION)||!out.includes(ACTION))fail('base_ssl_action_missing_after_transform');
  return out;
}
if(require.main===module){const file=process.argv[2];if(!file||process.argv.length!==3)fail('usage: patch-base-v2-ssl.js FILE');process.stdout.write(transform(fs.readFileSync(file,'utf8')));}
module.exports={transform};
