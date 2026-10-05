'use strict';

const ACTION='control_plane_preimage_evidence_installer_v1';
const TARGET_ACTION='control_plane_preimage_evidence_v1';
const EXECUTOR_PATH='/opt/prhm-agent-selfmaint-exec/server.js';
const POLICY_PATH='/opt/prhm-company-control-plane/config/approval-policy.json';
const EXECUTOR_SHA='409b63bd48b3363eaec2b3921f77ece2767dff93f6143923bdb754fe8f4cf69c';
const POLICY_SHA='9672e88b8c5033b7107e921d25bd4911216e86a8fe593ee67ac2330e0a75bab2';
const REQUIRED_LIVE_PATHS=Object.freeze([
  '/opt/prhm-agent-selfmaint/server.js',
  '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'
]);

function preflight(io){
  if(!io||typeof io.sha!=='function')throw new Error('invalid_dependencies');
  const executor=String(io.sha(EXECUTOR_PATH)||'');
  const policy=String(io.sha(POLICY_PATH)||'');
  if(executor!==EXECUTOR_SHA)throw new Error('executor_sha_mismatch');
  if(policy!==POLICY_SHA)throw new Error('policy_sha_mismatch');
  return {ok:true,action:ACTION,target_action:TARGET_ACTION,requires_privileged_live_evidence:true,required_live_paths:[...REQUIRED_LIVE_PATHS]};
}

function plan(){return {action:ACTION,target_action:TARGET_ACTION,registration_scope:'fixed',rollback:true,production_application_mutation:false,database_mutation:false};}

module.exports={ACTION,TARGET_ACTION,EXECUTOR_PATH,POLICY_PATH,EXECUTOR_SHA,POLICY_SHA,REQUIRED_LIVE_PATHS,preflight,plan};
