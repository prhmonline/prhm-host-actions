export const FIXED = Object.freeze({
  action: 'selfmaint_base_fixed_refresh_v1',
  operation: 'host_action.selfmaint_base_fixed_refresh_v1',
  service: 'prhm-agent-selfmaint.service',
  target_sha256: 'a23b4fec52123f8ad484f31576281c2f1933f24a3c811cd98c28e764a292e315',
  arbitrary_input: false,
  file_mutation: false
});

export function requestToolSchema() {
  return {};
}

export function applyToolSchema() {
  return {
    request_id: 'uuid',
    second_confirmation: 'CONFIRM_LEVEL_3_PRODUCTION'
  };
}

export function verifyRefreshResult(result) {
  if (!result || typeof result !== 'object') throw new Error('refresh_result_invalid');
  if (!Number.isInteger(result.before_pid) || !Number.isInteger(result.after_pid)) throw new Error('refresh_pid_invalid');
  if (result.before_pid <= 0 || result.after_pid <= 0 || result.before_pid === result.after_pid) throw new Error('refresh_pid_not_changed');
  if (result.service_active !== true) throw new Error('refresh_service_not_active');
  if (result.health_ok !== true) throw new Error('refresh_health_not_ok');
  if (result.runtime_sha256 !== FIXED.target_sha256) throw new Error('refresh_runtime_sha_mismatch');
  return true;
}
