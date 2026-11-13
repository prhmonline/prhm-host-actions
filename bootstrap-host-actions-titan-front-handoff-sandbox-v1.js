'use strict';

const ACTION='titan_front_handoff_sandbox_v1';
const LEVEL=4;
const RISK='critical';
const OPERATION='host_action.titan_front_handoff_sandbox_v1';
const HELPER_SHA256='d876f5700260cf9133b1568369b23fde779e70a8ba19ab1884226603bcf0c691';
const EXPECTED_BASE_SHA256='a23b4fec52123f8ad484f31576281c2f1933f24a3c811cd98c28e764a292e315';
const EXPECTED_EXEC_SHA256='451c5a4762a4c7a04d64d526a79cf6e86b0cf7c978c559cf303d874e0f08fc48';
const EXPECTED_POLICY_SHA256='494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70';
const EXPECTED_MCP_SHA256='c9d4b7037d7fd6f7b6f0ad18e32aa801709e4faf0b0692eb462f2acc4ae858f0';
const HELPER_SOURCE='/home/prhm/worktrees/prhm-host-actions-zdt-installer-v2/titan-front-handoff-sandbox-v1.js';
const HELPER_TARGET='/opt/prhm-agent-selfmaint-exec/actions/titan-front-handoff-sandbox-v1.js';
const ROLLBACK='host-action-v2:titan-front-handoff-sandbox-v1:registration-and-helper-restore';

function registrationPlan(){
  return Object.freeze({
    schema_version:'prhm.host-action-bootstrap-plan.v1',
    action:ACTION,
    operation:OPERATION,
    level:LEVEL,
    risk:RISK,
    helper_source:HELPER_SOURCE,
    helper_target:HELPER_TARGET,
    helper_sha256:HELPER_SHA256,
    expected_sha256:{
      base:EXPECTED_BASE_SHA256,
      exec:EXPECTED_EXEC_SHA256,
      policy:EXPECTED_POLICY_SHA256,
      mcp:EXPECTED_MCP_SHA256
    },
    typed_scope:{
      tool:'host_action_v2_apply',
      project:'control_plane',
      environment:'production',
      action:ACTION,
      risk:RISK,
      operation:OPERATION,
      principal_id:'mohammad',
      role:'mcp-operator'
    },
    rollback_reference:ROLLBACK,
    production_application_mutation:false,
    database_mutation:false,
    arbitrary_path:false,
    arbitrary_command:false,
    requires_level4:true
  });
}

module.exports={
  ACTION,LEVEL,RISK,OPERATION,HELPER_SHA256,EXPECTED_BASE_SHA256,
  EXPECTED_EXEC_SHA256,EXPECTED_POLICY_SHA256,EXPECTED_MCP_SHA256,
  HELPER_SOURCE,HELPER_TARGET,ROLLBACK,registrationPlan
};

if(require.main===module){
  process.stdout.write(JSON.stringify(registrationPlan())+'\n');
}
