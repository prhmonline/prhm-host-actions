'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const action = require('./recovery-failover-test-v1');

const SHA = '5a8f3a391145452a9c70a7fbe227903e482829a409bc6c1a960bf4ce56d52472';

function badPreflight() {
  return {
    ok: false,
    active_lane: 8125,
    live_sha256: SHA,
    approved_backup_sha256: SHA,
    services: {
      blue: {active:true, service:'prhm-agent-mcp-blue.service'},
      green: {active:true, service:'prhm-agent-mcp-green.service'},
      router: {active:true, service:'prhm-agent-mcp-router.service'},
      watchdog: {active:true, service:'prhm-mcp-watchdog.service'},
    },
  };
}

test('any preflight failure forces fixed router restart before surfacing failure', () => {
  const events = [];
  const deps = {
    recoveryStatus() { events.push('recoveryStatus'); return badPreflight(); },
    stopRouter() { events.push('stopRouter'); },
    restartRouter() { events.push('restartRouter'); },
    routerActive() { events.push('routerActive'); return true; },
    agent2Health() { events.push('agent2Health'); return {ok:true}; },
  };
  assert.throws(() => action.apply(deps), /recovery_unreachable/);
  assert.deepEqual(events, ['recoveryStatus', 'restartRouter']);
});
