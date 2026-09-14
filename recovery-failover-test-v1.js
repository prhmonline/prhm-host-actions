'use strict';

const ACTION = 'recovery_failover_test_v1';
const EXPECTED_SHA = '5a8f3a391145452a9c70a7fbe227903e482829a409bc6c1a960bf4ce56d52472';
const VALID_LANES = Object.freeze([8124, 8125]);
const SERVICES = Object.freeze({
  blue: 'prhm-agent-mcp-blue.service',
  green: 'prhm-agent-mcp-green.service',
  router: 'prhm-agent-mcp-router.service',
  watchdog: 'prhm-mcp-watchdog.service',
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertLane(value, code = 'invalid_active_lane') {
  if (!VALID_LANES.includes(Number(value))) fail(code);
}

function assertSha(value, code) {
  if (value !== EXPECTED_SHA) fail(code);
}

function assertService(status, key, expectedName, expectedActive, code) {
  const service = status && status.services && status.services[key];
  if (!service || service.service !== expectedName || service.active !== expectedActive) fail(code);
}

function assertPreflight(status) {
  if (!status || status.ok !== true) fail('recovery_unreachable');
  assertService(status, 'blue', SERVICES.blue, true, 'blue_not_active');
  assertService(status, 'green', SERVICES.green, true, 'green_not_active');
  assertService(status, 'router', SERVICES.router, true, 'router_not_active');
  assertService(status, 'watchdog', SERVICES.watchdog, true, 'watchdog_not_active');
  assertLane(status.active_lane);
  assertSha(status.live_sha256, 'live_sha_mismatch');
  assertSha(status.approved_backup_sha256, 'approved_backup_sha_mismatch');
  return true;
}

function assertPostStop(status) {
  if (!status || status.ok !== true) fail('recovery_unreachable_after_router_stop');
  assertService(status, 'blue', SERVICES.blue, true, 'blue_not_active_after_router_stop');
  assertService(status, 'green', SERVICES.green, true, 'green_not_active_after_router_stop');
  assertService(status, 'router', SERVICES.router, false, 'router_still_active_after_stop');
  assertService(status, 'watchdog', SERVICES.watchdog, true, 'watchdog_not_active_after_router_stop');
  assertLane(status.active_lane, 'invalid_active_lane_after_router_stop');
  assertSha(status.live_sha256, 'live_sha_changed_after_router_stop');
  assertSha(status.approved_backup_sha256, 'approved_backup_sha_changed_after_router_stop');
  return true;
}

function assertFinal(agentHealth, recoveryStatus) {
  if (!agentHealth || agentHealth.ok !== true) fail('agent2_health_not_ok');
  if (!recoveryStatus || recoveryStatus.ok !== true) fail('recovery_unreachable_final');
  assertService(recoveryStatus, 'blue', SERVICES.blue, true, 'blue_not_active_final');
  assertService(recoveryStatus, 'green', SERVICES.green, true, 'green_not_active_final');
  assertService(recoveryStatus, 'router', SERVICES.router, true, 'router_not_active_final');
  assertService(recoveryStatus, 'watchdog', SERVICES.watchdog, true, 'watchdog_not_active_final');
  assertLane(recoveryStatus.active_lane, 'invalid_final_active_lane');
  assertSha(recoveryStatus.live_sha256, 'live_sha_changed');
  assertSha(recoveryStatus.approved_backup_sha256, 'approved_backup_sha_changed');
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

  try {
    const preflight = deps.recoveryStatus();
    assertPreflight(preflight);

    deps.stopRouter();
    if (deps.routerActive() !== false) fail('router_still_active_after_stop');

    const postStop = deps.recoveryStatus();
    assertPostStop(postStop);

    deps.restartRouter();
    if (deps.routerActive() !== true) fail('router_not_active_after_restart');

    const agentHealth = deps.agent2Health();
    const finalRecovery = deps.recoveryStatus();
    assertFinal(agentHealth, finalRecovery);

    return Object.freeze({
      ok: true,
      action: ACTION,
      router_restarted: true,
      active_lane: Number(finalRecovery.active_lane),
      live_sha: finalRecovery.live_sha256,
      rollback_performed: false,
    });
  } catch (error) {
    safeRestart(deps, error);
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
