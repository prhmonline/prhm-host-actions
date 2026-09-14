'use strict';

const ACTION = 'recovery_failover_test_v1';
const EXPECTED_SHA = '5a8f3a391145452a9c70a7fbe227903e482829a409bc6c1a960bf4ce56d52472';
const VALID_LANES = Object.freeze([8124, 8125]);
const SERVICES = Object.freeze({
  blue: 'prhm-agent-mcp-blue.service',
  green: 'prhm-agent-mcp-green.service',
  router: 'prhm-agent-mcp-router.service',
  watchdog: 'prhm-agent-mcp-watchdog.service',
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertBooleanTrue(value, code) {
  if (value !== true) fail(code);
}

function assertLane(value, code = 'invalid_active_lane') {
  if (!VALID_LANES.includes(Number(value))) fail(code);
}

function assertSha(value, code) {
  if (value !== EXPECTED_SHA) fail(code);
}

function assertPreflight(status) {
  if (!status || typeof status !== 'object') fail('preflight_status_missing');
  assertBooleanTrue(status.recovery_reachable, 'recovery_unreachable');
  assertBooleanTrue(status.blue_active, 'blue_not_active');
  assertBooleanTrue(status.green_active, 'green_not_active');
  assertBooleanTrue(status.router_active, 'router_not_active');
  assertBooleanTrue(status.watchdog_active, 'watchdog_not_active');
  assertLane(status.active_lane);
  assertSha(status.live_sha, 'live_sha_mismatch');
  assertSha(status.approved_backup_sha, 'approved_backup_sha_mismatch');
  return true;
}

function assertPostStop(status) {
  if (!status || typeof status !== 'object') fail('post_stop_status_missing');
  assertBooleanTrue(status.recovery_reachable, 'recovery_unreachable_after_router_stop');
  if (status.router_active !== false) fail('router_still_active_after_stop');
  assertBooleanTrue(status.blue_active, 'blue_not_active_after_router_stop');
  assertBooleanTrue(status.green_active, 'green_not_active_after_router_stop');
  assertBooleanTrue(status.watchdog_active, 'watchdog_not_active_after_router_stop');
  assertLane(status.active_lane, 'invalid_active_lane_after_router_stop');
  assertSha(status.live_sha, 'live_sha_changed_after_router_stop');
  assertSha(status.approved_backup_sha, 'approved_backup_sha_changed_after_router_stop');
  return true;
}

function assertFinal(agentHealth, recoveryStatus) {
  if (!agentHealth || agentHealth.ok !== true) fail('agent2_health_not_ok');
  assertLane(agentHealth.active_lane, 'invalid_final_active_lane');
  assertSha(agentHealth.live_sha, 'live_sha_changed');

  if (!recoveryStatus || typeof recoveryStatus !== 'object') fail('final_recovery_status_missing');
  assertBooleanTrue(recoveryStatus.recovery_reachable, 'recovery_unreachable_final');
  assertBooleanTrue(recoveryStatus.blue_active, 'blue_not_active_final');
  assertBooleanTrue(recoveryStatus.green_active, 'green_not_active_final');
  assertBooleanTrue(recoveryStatus.router_active, 'router_not_active_final');
  assertBooleanTrue(recoveryStatus.watchdog_active, 'watchdog_not_active_final');
  assertLane(recoveryStatus.active_lane, 'invalid_recovery_final_lane');
  assertSha(recoveryStatus.live_sha, 'recovery_live_sha_changed');
  assertSha(recoveryStatus.approved_backup_sha, 'recovery_backup_sha_changed');
  return true;
}

function safeRestart(deps, originalError) {
  try {
    deps.restartRouter();
  } catch (restartError) {
    const error = new Error(`rollback_restart_failed:${String(restartError && restartError.message || restartError)}:original:${String(originalError && originalError.message || originalError)}`);
    error.code = 'rollback_restart_failed';
    throw error;
  }
}

function apply(deps) {
  if (!deps || typeof deps !== 'object') fail('deps_required');
  for (const name of ['recoveryStatus', 'stopRouter', 'restartRouter', 'routerActive', 'agent2Health']) {
    if (typeof deps[name] !== 'function') fail(`missing_dep:${name}`);
  }

  const preflight = deps.recoveryStatus();
  assertPreflight(preflight);
  let routerWasStopped = false;

  try {
    deps.stopRouter();
    routerWasStopped = true;

    if (deps.routerActive() !== false) fail('router_still_active_after_stop');
    const postStop = deps.recoveryStatus();
    assertPostStop({...postStop, router_active:false});

    deps.restartRouter();
    routerWasStopped = false;

    if (deps.routerActive() !== true) fail('router_not_active_after_restart');
    const agentHealth = deps.agent2Health();
    const finalRecovery = deps.recoveryStatus();
    assertFinal(agentHealth, finalRecovery);

    return Object.freeze({
      ok: true,
      action: ACTION,
      router_restarted: true,
      active_lane: Number(agentHealth.active_lane),
      live_sha: agentHealth.live_sha,
      rollback_performed: false,
    });
  } catch (error) {
    if (routerWasStopped) safeRestart(deps, error);
    throw error;
  }
}

module.exports = Object.freeze({
  ACTION,
  EXPECTED_SHA,
  VALID_LANES,
  SERVICES,
  assertPreflight,
  assertPostStop,
  assertFinal,
  apply,
});
