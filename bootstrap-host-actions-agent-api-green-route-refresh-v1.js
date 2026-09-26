'use strict';

const ACTION = 'agent_api_green_route_refresh_v1';
const OPERATION = 'host_action.agent_api_green_route_refresh_v1';
const HELPER_SHA256 = '975b8d0064c7be4cdae7624354f2b80fe6233577d7433e35fc894b81f0b89dc2';
const HELPER_SOURCE = '/home/agent/ssh-agent-api/agent-api-green-route-refresh-v1.js';
const HELPER_TARGET = '/opt/prhm-agent-selfmaint-exec/actions/agent-api-green-route-refresh-v1.js';
const RESULT_PATH = '/var/lib/prhm-agent-selfmaint-exec/agent-api-green-route-refresh-v1/latest.json';

function registrationPlan() {
  return Object.freeze({
    schema_version: 'prhm.host-action-bootstrap-plan.v1',
    action: ACTION,
    operation: OPERATION,
    helper_source: HELPER_SOURCE,
    helper_target: HELPER_TARGET,
    helper_sha256: HELPER_SHA256,
    result_path: RESULT_PATH,
    typed_scope: {
      tool: 'host_action_v2_apply',
      project: 'control_plane',
      environment: 'production',
      action: ACTION,
      operation: OPERATION,
      principal_id: 'mohammad',
      role: 'mcp-operator'
    },
    policy_classification: 'compute_at_install',
    minimum_risk: 'high',
    accepts_user_payload: false,
    arbitrary_command: false,
    arbitrary_path: false,
    arbitrary_service: false,
    arbitrary_port: false,
    arbitrary_pid: false,
    arbitrary_source_sha: false,
    database_mutation: false,
    application_tree_mutation: false,
    dns_mutation: false,
    tls_mutation: false,
    blue_service_mutation: false,
    mcp_service_mutation: false,
    legacy_api_service_mutation: false,
    target_service: 'prhm-agent-api-green.service',
    target_port: 8102
  });
}

module.exports = {ACTION,OPERATION,HELPER_SHA256,HELPER_SOURCE,HELPER_TARGET,RESULT_PATH,registrationPlan};
if (require.main === module) process.stdout.write(JSON.stringify(registrationPlan())+'\n');
