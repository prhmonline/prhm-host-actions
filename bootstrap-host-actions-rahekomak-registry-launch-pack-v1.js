'use strict';

const ACTION = 'rahekomak_registry_launch_pack_v1';
const OPERATION = 'host_action.rahekomak_registry_launch_pack_v1';
const HELPER_SHA256 = 'b8e73d7bb50a7ea11eedbff38f6832430aa940f960df1ecd5a3e12b5a3b79880';
const HELPER_SOURCE = '/home/prhm/worktrees/prhm-host-actions-rahekomak-registry-launch-pack-v1/rahekomak-registry-launch-pack-v1.js';
const HELPER_TARGET = '/opt/prhm-agent-selfmaint-exec/actions/rahekomak-registry-launch-pack-v1.js';
const RESULT_PATH = '/var/lib/prhm-agent-selfmaint-exec/rahekomak-registry-launch-pack-v1/latest.json';

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
    arbitrary_sql: false,
    production_application_deploy: false,
    dns_mutation: false,
    tls_mutation: false,
    database_mutation: true,
    transaction_owned_by_application: true
  });
}

module.exports = {
  ACTION, OPERATION, HELPER_SHA256, HELPER_SOURCE, HELPER_TARGET, RESULT_PATH, registrationPlan
};

if (require.main === module) process.stdout.write(JSON.stringify(registrationPlan()) + '\n');
