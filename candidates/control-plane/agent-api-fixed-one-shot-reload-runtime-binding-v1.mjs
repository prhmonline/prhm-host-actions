export const FIXED=Object.freeze({
  action:'agent_api_fixed_one_shot_reload_v1',
  operation:'host_action.agent_api_fixed_one_shot_reload_v1',
  primitive_sha256:'3a1489b7f9a579095c82f5d7c40fec94262298da2517448ad9b11b5faf135659',
  second_confirmation:'CONFIRM_LEVEL_4_CRITICAL',
  executor:Object.freeze({
    path:'/opt/prhm-agent-selfmaint-exec/server.js',
    expected_sha256:'5a6049218c74d4c640b5e270848ea43b7dbb59f5c7e81446dcb179156b8e640a'
  }),
  mcp:Object.freeze({
    path:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
    expected_sha256:'44520b67bb352ab243698c5cf50b39d09a65c833fee9cfd3ebc5a50379ecaa71'
  }),
  policy:Object.freeze({
    path:'/opt/prhm-company-control-plane/config/approval-policy.json',
    expected_sha256:'4352ead2c0ec651c85e6206ae034b72e7be355c279ce1e0070626539725843fd'
  })
});

export function requestToolSchema(){return {}}
export function applyToolSchema(){return {request_id:'uuid',second_confirmation:FIXED.second_confirmation}}

export function bindingPlan(){
  return [
    Object.freeze({target:'executor',path:FIXED.executor.path,expected_sha256:FIXED.executor.expected_sha256,change:'register fixed action spec and dispatcher only',arbitrary_path:false,arbitrary_content:false,rollback_required:true}),
    Object.freeze({target:'mcp',path:FIXED.mcp.path,expected_sha256:FIXED.mcp.expected_sha256,change:'append fixed action enum value only',arbitrary_path:false,arbitrary_content:false,rollback_required:true}),
    Object.freeze({target:'policy',path:FIXED.policy.path,expected_sha256:FIXED.policy.expected_sha256,change:'add level-4 operation and fixed tool scopes only',arbitrary_path:false,arbitrary_content:false,rollback_required:true})
  ];
}

export function validateBaselines(actual){
  if(!actual||typeof actual!=='object')throw new Error('baseline_set_missing');
  if(String(actual.executor||'')!==FIXED.executor.expected_sha256)throw new Error('executor_baseline_mismatch');
  if(String(actual.mcp||'')!==FIXED.mcp.expected_sha256)throw new Error('mcp_baseline_mismatch');
  if(String(actual.policy||'')!==FIXED.policy.expected_sha256)throw new Error('policy_baseline_mismatch');
  return true;
}
