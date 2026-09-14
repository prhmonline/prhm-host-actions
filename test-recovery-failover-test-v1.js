'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const EXPECTED_SHA = '5a8f3a391145452a9c70a7fbe227903e482829a409bc6c1a960bf4ce56d52472';

function loadAction() {
  delete require.cache[require.resolve('./recovery-failover-test-v1')];
  return require('./recovery-failover-test-v1');
}

function baseline(overrides = {}) {
  const services = {
    blue: {active:true, service:'prhm-agent-mcp-blue.service', state:'active'},
    green: {active:true, service:'prhm-agent-mcp-green.service', state:'active'},
    router: {active:true, service:'prhm-agent-mcp-router.service', state:'active'},
    watchdog: {active:true, service:'prhm-mcp-watchdog.service', state:'active'},
    ...(overrides.services || {}),
  };
  return {
    ok: true,
    active_lane: 8125,
    live_sha256: EXPECTED_SHA,
    approved_backup_sha256: EXPECTED_SHA,
    ...overrides,
    services,
  };
}

function fakeDeps(options = {}) {
  const events = [];
  let routerActive = true;
  let recoveryCalls = 0;
  const recoveryStates = options.recoveryStates || [
    baseline(),
    baseline({services:{router:{active:false, service:'prhm-agent-mcp-router.service', state:'inactive'}}}),
    baseline(),
  ];
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
        return options.agentHealth || {ok:true, service:'ssh-agent-api'};
      },
    },
  };
}

test('exports fixed service identities matching live Recovery status', () => {
  const action = loadAction();
  assert.equal(action.ACTION, 'recovery_failover_test_v1');
  assert.deepEqual(action.SERVICES, Object.freeze({
    blue: 'prhm-agent-mcp-blue.service',
    green: 'prhm-agent-mcp-green.service',
    router: 'prhm-agent-mcp-router.service',
    watchdog: 'prhm-mcp-watchdog.service',
  }));
  assert.equal(action.EXPECTED_SHA, EXPECTED_SHA);
  assert.equal(action.apply.length, 1, 'apply accepts only injected deps in tests; no service/path/command input');
});

test('preflight accepts the exact live recovery_status schema and rejects drift', () => {
  const action = loadAction();
  assert.doesNotThrow(() => action.assertPreflight(baseline()));
  const cases = [
    baseline({ok:false}),
    baseline({services:{blue:{active:false, service:'prhm-agent-mcp-blue.service', state:'inactive'}}}),
    baseline({services:{green:{active:false, service:'prhm-agent-mcp-green.service', state:'inactive'}}}),
    baseline({services:{router:{active:false, service:'prhm-agent-mcp-router.service', state:'inactive'}}}),
    baseline({services:{watchdog:{active:false, service:'prhm-mcp-watchdog.service', state:'inactive'}}}),
    baseline({active_lane:9999}),
    baseline({live_sha256:'0'.repeat(64)}),
    baseline({approved_backup_sha256:'1'.repeat(64)}),
  ];
  for (const bad of cases) assert.throws(() => action.assertPreflight(bad));
});

test('happy path stops only router, proves independent Recovery, restarts router, verifies Agent 2 health and final SHA/lane', () => {
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

test('fails closed if independent Recovery is unreachable after router stop and still restarts router', () => {
  const action = loadAction();
  const {deps, events} = fakeDeps({
    recoveryStates: [
      baseline(),
      baseline({ok:false, services:{router:{active:false, service:'prhm-agent-mcp-router.service', state:'inactive'}}}),
    ],
  });
  assert.throws(() => action.apply(deps), /recovery_unreachable_after_router_stop/);
  assert.ok(events.includes('restartRouter'));
  assert.ok(events.indexOf('restartRouter') > events.indexOf('stopRouter'));
});

test('fails closed on Agent 2 health failure and still restores router', () => {
  const action = loadAction();
  const {deps, events} = fakeDeps({agentHealth:{ok:false, service:'ssh-agent-api'}});
  assert.throws(() => action.apply(deps), /agent2_health_not_ok/);
  assert.ok(events.includes('restartRouter'));
  assert.ok(events.lastIndexOf('routerActive') > events.indexOf('restartRouter'));
});

test('fails closed if final recovery_status reports a changed live SHA', () => {
  const action = loadAction();
  const {deps, events} = fakeDeps({
    recoveryStates: [
      baseline(),
      baseline({services:{router:{active:false, service:'prhm-agent-mcp-router.service', state:'inactive'}}}),
      baseline({active_lane:8124, live_sha256:'f'.repeat(64)}),
    ],
  });
  assert.throws(() => action.apply(deps), /live_sha_changed/);
  assert.ok(events.includes('restartRouter'));
});

test('restart failure is surfaced as rollback failure', () => {
  const action = loadAction();
  const {deps} = fakeDeps({
    recoveryStates: [
      baseline(),
      baseline({ok:false, services:{router:{active:false, service:'prhm-agent-mcp-router.service', state:'inactive'}}}),
    ],
    restartError: new Error('systemctl_restart_failed'),
  });
  assert.throws(() => action.apply(deps), /rollback_restart_failed/);
});
