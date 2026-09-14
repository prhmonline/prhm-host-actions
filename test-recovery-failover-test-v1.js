'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const EXPECTED_SHA = '5a8f3a391145452a9c70a7fbe227903e482829a409bc6c1a960bf4ce56d52472';

function loadAction() {
  return require('./recovery-failover-test-v1');
}

function baseline(overrides = {}) {
  return {
    recovery_reachable: true,
    blue_active: true,
    green_active: true,
    router_active: true,
    watchdog_active: true,
    active_lane: 8125,
    live_sha: EXPECTED_SHA,
    approved_backup_sha: EXPECTED_SHA,
    ...overrides,
  };
}

function fakeDeps(options = {}) {
  const events = [];
  let routerActive = true;
  let recoveryCalls = 0;
  const recoveryStates = options.recoveryStates || [baseline(), baseline({router_active:false}), baseline()];
  return {
    events,
    deps: {
      recoveryStatus() {
        events.push('recoveryStatus');
        const state = recoveryStates[Math.min(recoveryCalls, recoveryStates.length - 1)];
        recoveryCalls += 1;
        if (state instanceof Error) throw state;
        return state;
      },
      stopRouter() {
        events.push('stopRouter');
        if (options.stopError) throw options.stopError;
        routerActive = false;
      },
      restartRouter() {
        events.push('restartRouter');
        routerActive = true;
        if (options.restartError) throw options.restartError;
      },
      routerActive() {
        events.push('routerActive');
        return routerActive;
      },
      agent2Health() {
        events.push('agent2Health');
        if (options.agentHealthError) throw options.agentHealthError;
        return options.agentHealth || {ok:true, active_lane:8125, live_sha:EXPECTED_SHA};
      },
    },
  };
}

test('exports a fixed no-input recovery action and fixed router service', () => {
  const action = loadAction();
  assert.equal(action.ACTION, 'recovery_failover_test_v1');
  assert.deepEqual(action.SERVICES, Object.freeze({
    blue: 'prhm-agent-mcp-blue.service',
    green: 'prhm-agent-mcp-green.service',
    router: 'prhm-agent-mcp-router.service',
    watchdog: 'prhm-agent-mcp-watchdog.service',
  }));
  assert.equal(action.EXPECTED_SHA, EXPECTED_SHA);
  assert.equal(action.apply.length, 1, 'apply accepts only injected deps in tests; no service/path/command input');
});

test('preflight requires recovery, both lanes, router, watchdog, valid lane and SHA parity', () => {
  const action = loadAction();
  assert.doesNotThrow(() => action.assertPreflight(baseline()));
  for (const bad of [
    {recovery_reachable:false},
    {blue_active:false},
    {green_active:false},
    {router_active:false},
    {watchdog_active:false},
    {active_lane:9999},
    {live_sha:'0'.repeat(64)},
    {approved_backup_sha:'1'.repeat(64)},
  ]) {
    assert.throws(() => action.assertPreflight(baseline(bad)));
  }
});

test('happy path stops only router, proves independent recovery, restarts router, then verifies Agent 2 and SHA', () => {
  const action = loadAction();
  const {deps, events} = fakeDeps();
  const result = action.apply(deps);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'recovery_failover_test_v1');
  assert.equal(result.router_restarted, true);
  assert.equal(result.live_sha, EXPECTED_SHA);
  assert.equal(result.active_lane, 8125);
  assert.deepEqual(events, [
    'recoveryStatus',
    'stopRouter',
    'routerActive',
    'recoveryStatus',
    'restartRouter',
    'routerActive',
    'agent2Health',
    'recoveryStatus',
  ]);
});

test('fails closed if Recovery is not reachable after router stop and still restarts router', () => {
  const action = loadAction();
  const {deps, events} = fakeDeps({
    recoveryStates: [baseline(), baseline({recovery_reachable:false, router_active:false})],
  });
  assert.throws(() => action.apply(deps), /recovery_unreachable_after_router_stop/);
  assert.ok(events.includes('restartRouter'));
  assert.ok(events.indexOf('restartRouter') > events.indexOf('stopRouter'));
});

test('fails closed on final Agent 2 verification and still leaves router active', () => {
  const action = loadAction();
  const {deps, events} = fakeDeps({agentHealth:{ok:false, active_lane:8125, live_sha:EXPECTED_SHA}});
  assert.throws(() => action.apply(deps), /agent2_health_not_ok/);
  assert.ok(events.includes('restartRouter'));
  const lastRouterCheck = events.lastIndexOf('routerActive');
  assert.ok(lastRouterCheck > events.indexOf('restartRouter'));
});

test('fails closed if live SHA changes after restart', () => {
  const action = loadAction();
  const {deps, events} = fakeDeps({agentHealth:{ok:true, active_lane:8124, live_sha:'f'.repeat(64)}});
  assert.throws(() => action.apply(deps), /live_sha_changed/);
  assert.ok(events.includes('restartRouter'));
});

test('restart failure is surfaced as rollback failure', () => {
  const action = loadAction();
  const {deps} = fakeDeps({
    recoveryStates: [baseline(), baseline({recovery_reachable:false, router_active:false})],
    restartError: new Error('systemctl_restart_failed'),
  });
  assert.throws(() => action.apply(deps), /rollback_restart_failed/);
});
