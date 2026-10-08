'use strict';

const ACTION='node1_backup_implementation_v1';
const LEVEL=4;
const RISK='critical';
const OPERATION='host_action.node1_backup_implementation_v1';
const HELPER_SHA256='9b82c9a69d872b33fce8bb66da1e0e45f5140a199e1c6f6b2267928737bb9ed0';
const EXPECTED_BASE_SHA256='6ae89522f439babd3b6a9679336aea0fb12bb74993d33234095f872d38ad8cc6';
const EXPECTED_EXEC_SHA256='409b63bd48b3363eaec2b3921f77ece2767dff93f6143923bdb754fe8f4cf69c';
const EXPECTED_POLICY_SHA256='9672e88b8c5033b7107e921d25bd4911216e86a8fe593ee67ac2330e0a75bab2';
const EXPECTED_MCP_SHA256='703a8f8ee0726fac47d008a69c759e3f52254c980cf551ea3f2660cc46321283';
const HELPER_SOURCE='/home/prhm/worktrees/prhm-host-actions-zdt-installer-v2/node1-backup-implementation-v1.js';
const HELPER_TARGET='/opt/prhm-agent-selfmaint-exec/actions/node1-backup-implementation-v1.js';
const ROLLBACK='host-action-v2:node1-backup-implementation-v1:registration-and-helper-restore';

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
    arbitrary_host:false,
    arbitrary_path:false,
    arbitrary_command:false,
    zero_input:true,
    service_dependency:'prhm-node1-backup-assurance.service',
    evidence_dependency:'/var/lib/prhm-backup/node1/latest.json',
    requires_level4:true
  });
}

module.exports={
  ACTION,LEVEL,RISK,OPERATION,HELPER_SHA256,
  EXPECTED_BASE_SHA256,EXPECTED_EXEC_SHA256,EXPECTED_POLICY_SHA256,EXPECTED_MCP_SHA256,
  HELPER_SOURCE,HELPER_TARGET,ROLLBACK,registrationPlan
};

if(require.main===module){
  process.stdout.write(JSON.stringify(registrationPlan())+'\n');
}
