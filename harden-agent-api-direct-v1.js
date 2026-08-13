'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const http = require('http');

const SERVICE = 'prhm-agent-api.service';
const DROPIN_DIR = '/etc/systemd/system/prhm-agent-api.service.d';
const DROPIN = path.join(DROPIN_DIR, '90-prhm-hardening.conf');
const BACKUP_ROOT = '/var/backups/prhm-host-actions';
const MARKER_DIR = '/var/lib/prhm-host-actions';
const MARKER = path.join(MARKER_DIR, 'harden-agent-api-direct-v1.json');
const HEALTH_HOST = '127.0.0.1';
const HEALTH_PORT = 8099;
const HEALTH_PATH = '/health';

const CONFIG = [
  '[Service]',
  'NoNewPrivileges=yes',
  'PrivateTmp=yes',
  'ProtectSystem=full',
  'ProtectHome=read-only',
  'ProtectKernelTunables=yes',
  'ProtectKernelModules=yes',
  'ProtectControlGroups=yes',
  'RestrictNamespaces=yes',
  'RestrictSUIDSGID=yes',
  'LockPersonality=yes',
  'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
  'CapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_DAC_READ_SEARCH CAP_FOWNER CAP_FSETID CAP_KILL CAP_SETGID CAP_SETUID CAP_NET_BIND_SERVICE',
  'AmbientCapabilities=',
  'ReadWritePaths=-/home/agent/ssh-agent-api -/home/agent/ssh-agent-runtime -/home/prhm -/home/honartik -/home/drtarjomeh -/mnt/imotion-prod-vm',
  ''
].join('\n');

const REQUIRED = {
  NoNewPrivileges: 'yes',
  PrivateTmp: 'yes',
  ProtectSystem: 'full',
  ProtectHome: 'read-only',
  ProtectKernelTunables: 'yes',
  ProtectKernelModules: 'yes',
  ProtectControlGroups: 'yes',
  RestrictNamespaces: 'yes',
  RestrictSUIDSGID: 'yes',
  LockPersonality: 'yes'
};

const BLOCKED_CAPS = [
  'cap_sys_admin',
  'cap_net_admin',
  'cap_sys_module',
  'cap_bpf',
  'cap_sys_ptrace'
];

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function execFile(file, args, timeout = 30000) {
  return cp.execFileSync(file, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout
  }).trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function systemdProp(name) {
  return execFile('systemctl', ['show', SERVICE, '-p', name, '--value'], 10000);
}

function atomicWrite(file, text, mode = 0o644) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, { flag: 'wx', mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

function healthOnce() {
  return new Promise(resolve => {
    const req = http.get({
      hostname: HEALTH_HOST,
      port: HEALTH_PORT,
      path: HEALTH_PATH,
      timeout: 2500
    }, res => {
      let body = '';
      res.on('data', chunk => { if (body.length < 65536) body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          resolve({ ok: res.statusCode === 200 && parsed.ok === true, status: res.statusCode, body: parsed });
        } catch {
          resolve({ ok: false, status: res.statusCode, body: null });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', error => resolve({ ok: false, error: String(error.code || error.message || error) }));
  });
}

async function waitHealthy(attempts = 60) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = await healthOnce();
    if (last.ok) return last;
    await sleep(500);
  }
  throw new Error(`agent_api_health_not_ready:${JSON.stringify(last).slice(0, 500)}`);
}

function verifyHardening() {
  const actual = {};
  for (const [name, expected] of Object.entries(REQUIRED)) {
    actual[name] = systemdProp(name);
    if (actual[name] !== expected) {
      throw new Error(`hardening_property_mismatch:${name}:${actual[name]}:${expected}`);
    }
  }

  actual.CapabilityBoundingSet = systemdProp('CapabilityBoundingSet').toLowerCase();
  const caps = new Set(actual.CapabilityBoundingSet.split(/\s+/).filter(Boolean));
  for (const blocked of BLOCKED_CAPS) {
    if (caps.has(blocked)) throw new Error(`dangerous_capability_present:${blocked}`);
  }

  actual.AmbientCapabilities = systemdProp('AmbientCapabilities');
  if (actual.AmbientCapabilities.trim() !== '') throw new Error('ambient_capabilities_not_empty');

  actual.ActiveState = systemdProp('ActiveState');
  actual.SubState = systemdProp('SubState');
  if (actual.ActiveState !== 'active' || actual.SubState !== 'running') {
    throw new Error(`service_not_running:${actual.ActiveState}:${actual.SubState}`);
  }

  return actual;
}

function baseline() {
  const exists = fs.existsSync(DROPIN);
  const current = exists ? fs.readFileSync(DROPIN) : null;
  return {
    service_active: execFile('systemctl', ['is-active', SERVICE], 10000),
    dropin_exists: exists,
    dropin_sha256: current ? sha256(current) : null,
    candidate_sha256: sha256(Buffer.from(CONFIG))
  };
}

async function rollback(previous, existed, backup, reason) {
  try {
    if (existed) {
      atomicWrite(DROPIN, previous, 0o644);
    } else {
      try { fs.unlinkSync(DROPIN); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    execFile('systemctl', ['daemon-reload'], 30000);
    execFile('systemctl', ['restart', SERVICE], 30000);
    const health = await waitHealthy(60);
    return { rollback_performed: true, rollback_health: health, original_error: reason };
  } catch (rollbackError) {
    throw new Error(`hardening_failed_and_rollback_failed:${reason}:${rollbackError.message}`);
  }
}

async function main() {
  const preflightOnly = process.argv.includes('--preflight-only');
  const candidateSha = sha256(Buffer.from(CONFIG));
  const before = baseline();
  const beforeHealth = await healthOnce();

  if (preflightOnly) {
    console.log(JSON.stringify({
      ok: true,
      preflight_only: true,
      service: SERVICE,
      dropin: DROPIN,
      baseline: before,
      baseline_health: beforeHealth,
      candidate_sha256: candidateSha,
      unsupported_directives_omitted: ['ProtectKernelLogs'],
      rollback: 'automatic'
    }));
    return;
  }

  fs.mkdirSync(DROPIN_DIR, { recursive: true, mode: 0o755 });
  fs.mkdirSync(BACKUP_ROOT, { recursive: true, mode: 0o700 });
  fs.mkdirSync(MARKER_DIR, { recursive: true, mode: 0o700 });

  const existed = fs.existsSync(DROPIN);
  const previous = existed ? fs.readFileSync(DROPIN) : null;

  if (existed && sha256(previous) === candidateSha) {
    const health = await waitHealthy(60);
    const properties = verifyHardening();
    const result = {
      ok: true,
      already_applied: true,
      applied_at: new Date().toISOString(),
      candidate_sha256: candidateSha,
      health,
      properties,
      rollback_performed: false
    };
    atomicWrite(MARKER, JSON.stringify(result, null, 2) + '\n', 0o600);
    console.log(JSON.stringify(result));
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const backupDir = path.join(BACKUP_ROOT, `agent-api-hardening-direct-v1-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  let backup = null;
  if (existed) {
    backup = path.join(backupDir, '90-prhm-hardening.conf.bak');
    fs.copyFileSync(DROPIN, backup, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(backup, 0o600);
  }

  let mutated = false;
  try {
    atomicWrite(DROPIN, CONFIG, 0o644);
    mutated = true;
    execFile('systemctl', ['daemon-reload'], 30000);
    execFile('systemctl', ['restart', SERVICE], 30000);
    const health = await waitHealthy(60);
    const properties = verifyHardening();
    const installedSha = sha256(fs.readFileSync(DROPIN));
    if (installedSha !== candidateSha) throw new Error(`installed_sha_mismatch:${installedSha}:${candidateSha}`);

    const result = {
      ok: true,
      schema_version: 'prhm.agent-api-hardening.direct.v1',
      applied_at: new Date().toISOString(),
      service: SERVICE,
      dropin: DROPIN,
      previous_dropin_existed: existed,
      backup_path: backup,
      candidate_sha256: candidateSha,
      installed_sha256: installedSha,
      health,
      properties,
      rollback_performed: false
    };
    atomicWrite(MARKER, JSON.stringify(result, null, 2) + '\n', 0o600);
    console.log(JSON.stringify(result));
  } catch (error) {
    if (mutated) {
      const rollbackResult = await rollback(previous, existed, backup, error.message);
      console.error(JSON.stringify({ ok: false, ...rollbackResult }));
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: String(error.message || error) }));
  process.exitCode = 1;
});
