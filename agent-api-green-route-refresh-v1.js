'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const http = require('node:http');

const ACTION = 'agent_api_green_route_refresh_v1';
const SCHEMA_VERSION = 'prhm.agent-api-green-route-refresh-result.v1';
const SERVICE = 'prhm-agent-api-green.service';
const SOURCE = '/home/agent/ssh-agent-api/opsExecutorRoutes.js';
const SOURCE_SHA256 = '1ab03973db68cb54156a579db5a8b26f0e58f5e940805633a467a0a9f28ada15';
const ROUTE_MARKER = 'CONTROL_PLANE_CURRENT_OWNER_BOOTSTRAP_WORKTREE_PREPARE_V1';
const HEALTH_URL = 'http://127.0.0.1:8102/health';
const PORT = 8102;

function fail(message) { throw new Error(message); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function defaultDeps() {
  return {
    lstat: p => fs.lstatSync(p),
    realpath: p => fs.realpathSync(p),
    readFile: p => fs.readFileSync(p),
    systemctlShow: service => {
      const out = cp.execFileSync('/usr/bin/systemctl', ['show', service, '-p', 'ActiveState', '-p', 'SubState', '-p', 'MainPID', '--value'], {encoding:'utf8', timeout:10000});
      const lines = out.trim().split(/\r?\n/);
      return { active: lines[0] || '', sub: lines[1] || '', pid: Number(lines[2] || 0) };
    },
    restart: service => cp.execFileSync('/usr/bin/systemctl', ['restart', service], {encoding:'utf8', timeout:90000}),
    sha256,
    health: () => new Promise((resolve) => {
      const req = http.get(HEALTH_URL, {timeout: 3000}, res => {
        let body='';
        res.setEncoding('utf8');
        res.on('data', c => { if (body.length < 4096) body += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(false);
          try { const j = JSON.parse(body); resolve(j && j.ok === true); } catch { resolve(false); }
        });
      });
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.on('error', () => resolve(false));
    }),
    sleep,
  };
}

function createRunner(overrides={}) {
  const d = {...defaultDeps(), ...overrides};

  function preflight() {
    const st = d.lstat(SOURCE);
    if (!st.isFile() || st.isSymbolicLink()) fail('green_refresh_source_invalid');
    if (d.realpath(SOURCE) !== SOURCE) fail('green_refresh_source_realpath_mismatch');
    const bytes = d.readFile(SOURCE);
    const actual = d.sha256(bytes);
    if (actual !== SOURCE_SHA256) fail('green_refresh_source_sha_mismatch');
    if (!bytes.toString('utf8').includes(ROUTE_MARKER)) fail('green_refresh_route_marker_missing');
    const svc = d.systemctlShow(SERVICE);
    if (svc.active !== 'active' || svc.sub !== 'running') fail('green_refresh_service_not_active');
    if (!Number.isInteger(svc.pid) || svc.pid <= 0) fail('green_refresh_pre_pid_invalid');
    return { source_sha256: actual, before_pid: svc.pid };
  }

  async function apply() {
    const pf = preflight();
    d.restart(SERVICE);
    let after = null;
    let healthOk = false;
    for (let i=0; i<40; i++) {
      const s = d.systemctlShow(SERVICE);
      if (s.active === 'active' && s.sub === 'running' && Number.isInteger(s.pid) && s.pid > 0) {
        after = s;
        if (s.pid !== pf.before_pid) {
          healthOk = await d.health();
          if (healthOk) break;
        }
      }
      d.sleep(250);
    }
    if (!after || after.active !== 'active' || after.sub !== 'running') fail('green_refresh_service_recovery_failed');
    if (after.pid === pf.before_pid) fail('green_refresh_pid_unchanged');
    if (!healthOk) fail('green_refresh_health_failed');
    return {
      ok: true,
      schema_version: SCHEMA_VERSION,
      action: ACTION,
      service: SERVICE,
      source_sha256: pf.source_sha256,
      before_pid: pf.before_pid,
      after_pid: after.pid,
      service_active: true,
      health_ok: true,
      pid_changed: true,
      port: PORT,
      blue_service_mutation: false,
      mcp_service_mutation: false,
      database_mutation: false,
      application_tree_mutation: false,
      dns_mutation: false,
      tls_mutation: false,
      rollback_performed: false,
    };
  }

  return { runPreflight: preflight, runApply: apply };
}

const runner = createRunner();
module.exports = {
  ACTION, SCHEMA_VERSION, SERVICE, SOURCE, SOURCE_SHA256, ROUTE_MARKER, HEALTH_URL, PORT,
  createRunner,
  runPreflight: runner.runPreflight,
  runApply: runner.runApply,
};
