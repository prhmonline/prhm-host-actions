'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const TARGET = '/opt/prhm-agent-selfmaint-exec/server.js';
const EXPECTED_SHA256 = 'c85394fcaa857413bb7918cb55ed2210890f5431be8c9b58e67e93c12898f6ce';
const SERVICE = 'prhm-agent-selfmaint-exec.service';
const SOCKET = '/run/prhm-agent-selfmaint-exec/exec.sock';
const MARKER = '/var/lib/prhm-agent-selfmaint-exec/host-actions-v1-1-repair.json';

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function read(file) {
  return fs.readFileSync(file, 'utf8');
}
function replaceOnce(text, search, replacement, label) {
  const count = text.split(search).length - 1;
  if (count !== 1) throw new Error(`anchor_${label}_count_${count}`);
  return text.replace(search, replacement);
}
function writeAtomic(file, text, st) {
  const tmp = `${file}.repair-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, { flag: 'wx', mode: st.mode & 0o777 });
  fs.chmodSync(tmp, st.mode & 0o777);
  fs.chownSync(tmp, st.uid, st.gid);
  fs.renameSync(tmp, file);
}
function execFile(file, args, timeout = 30000) {
  return cp.execFileSync(file, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout
  }).trim();
}
function wait(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function waitExecHealth(attempts = 30) {
  let last = '';
  for (let i = 0; i < attempts; i++) {
    try {
      const out = execFile('curl', [
        '--fail', '--silent', '--show-error', '--max-time', '2',
        '--unix-socket', SOCKET,
        'http://localhost/health'
      ], 5000);
      const body = JSON.parse(out);
      if (body.ok === true && body.version === '1.1.1-host-actions-v1-compat') return body;
      last = out;
    } catch (e) {
      last = String(e.message || e);
    }
    wait(500);
  }
  throw new Error(`executor_health_not_ready:${last.slice(0, 500)}`);
}

function patch(input) {
  let out = input;

  out = replaceOnce(
    out,
    "  'ProtectKernelLogs=yes',\n",
    '',
    'remove_unsupported_protect_kernel_logs_config'
  );

  const oldHealth = `function agentApiHealth() {
  return new Promise(resolve => {
    const q = http.get({ hostname: '127.0.0.1', port: 8099, path: '/health', timeout: 2500 }, r => {
      let data = '';
      r.on('data', c => { if (data.length < 65536) data += c; });
      r.on('end', () => {
        let body = {};
        try { body = JSON.parse(data || '{}'); } catch {}
        resolve(r.statusCode === 200 && body.ok === true);
      });
    });
    q.on('timeout', () => { q.destroy(); resolve(false); });
    q.on('error', () => resolve(false));
  });
}

async function waitAgentApiHealthy() {
  for (let i = 0; i < 40; i++) {
    if (await agentApiHealth()) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}`;

  const newHealth = `function agentApiReady() {
  try {
    if (execSystemctl(['is-active', 'prhm-agent-api.service'], 10000) !== 'active') return false;
    const pid = Number(systemdProp('MainPID'));
    if (!Number.isInteger(pid) || pid <= 0) return false;

    const socketInodes = new Set();
    const fdDir = \`/proc/\${pid}/fd\`;
    for (const name of fs.readdirSync(fdDir)) {
      try {
        const link = fs.readlinkSync(path.join(fdDir, name));
        const m = /^socket:\\[(\\d+)\\]$/.exec(link);
        if (m) socketInodes.add(m[1]);
      } catch {}
    }
    if (!socketInodes.size) return false;

    for (const procFile of ['/proc/net/tcp', '/proc/net/tcp6']) {
      let text = '';
      try { text = fs.readFileSync(procFile, 'utf8'); } catch { continue; }
      const lines = text.trim().split(/\\n/).slice(1);
      for (const line of lines) {
        const cols = line.trim().split(/\\s+/);
        if (cols.length < 10) continue;
        const local = cols[1] || '';
        const state = cols[3] || '';
        const inode = cols[9] || '';
        const port = (local.split(':')[1] || '').toUpperCase();
        if (state === '0A' && port === '1FA3' && socketInodes.has(inode)) return true;
      }
    }
  } catch {}
  return false;
}

async function waitAgentApiHealthy() {
  for (let i = 0; i < 60; i++) {
    if (agentApiReady()) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}`;

  out = replaceOnce(out, oldHealth, newHealth, 'networkless_agent_api_readiness');

  out = replaceOnce(
    out,
    "    ProtectKernelLogs: 'yes',\n",
    '',
    'remove_unsupported_protect_kernel_logs_verify'
  );

  out = replaceOnce(
    out,
    'fs.constants.COPYFILE_EXCLS',
    'fs.constants.COPYFILE_EXCL',
    'copyfile_excl_typo'
  );

  out = replaceOnce(
    out,
    "version: '1.1.0-host-actions-v1'",
    "version: '1.1.1-host-actions-v1-compat'",
    'executor_version'
  );

  return out;
}

function main() {
  const preflightOnly = process.argv.includes('--preflight-only');
  const current = fs.readFileSync(TARGET);
  const currentSha = sha(current);

  if (fs.existsSync(MARKER)) {
    const marker = JSON.parse(read(MARKER));
    if (marker && marker.candidate_sha256 && currentSha === marker.candidate_sha256) {
      console.log(JSON.stringify({ ok: true, already_repaired: true, marker, current_sha256: currentSha }));
      return;
    }
    throw new Error('repair_marker_present_but_target_hash_mismatch');
  }

  if (currentSha !== EXPECTED_SHA256) {
    throw new Error(`target_sha_mismatch:${currentSha}:${EXPECTED_SHA256}`);
  }

  const patched = patch(current.toString('utf8'));
  const candidateSha = sha(Buffer.from(patched));

  const tmpCheck = `/tmp/prhm-host-actions-v1-1-${process.pid}.js`;
  fs.writeFileSync(tmpCheck, patched, { mode: 0o600 });
  try {
    execFile('/usr/local/bin/prhm-node', ['--check', tmpCheck], 10000);
  } finally {
    try { fs.unlinkSync(tmpCheck); } catch {}
  }

  if (preflightOnly) {
    console.log(JSON.stringify({
      ok: true,
      preflight_only: true,
      target: TARGET,
      expected_sha256: EXPECTED_SHA256,
      candidate_sha256: candidateSha,
      fixes: [
        'remove_unsupported_ProtectKernelLogs',
        'networkless_MainPID_socket_readiness',
        'fix_COPYFILE_EXCL_typo',
        'executor_version_1.1.1'
      ]
    }));
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const backupDir = `/var/backups/prhm-host-actions/repair-v1-1-${stamp}`;
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backup = path.join(backupDir, 'server.js.bak');
  fs.copyFileSync(TARGET, backup, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backup, 0o600);

  const st = fs.statSync(TARGET);
  let mutated = false;
  try {
    writeAtomic(TARGET, patched, st);
    mutated = true;
    execFile('/usr/local/bin/prhm-node', ['--check', TARGET], 10000);
    execFile('systemctl', ['restart', SERVICE], 30000);
    const health = waitExecHealth();
    const installedSha = sha(fs.readFileSync(TARGET));
    if (installedSha !== candidateSha) throw new Error(`installed_sha_mismatch:${installedSha}:${candidateSha}`);

    const result = {
      ok: true,
      schema_version: 'prhm.host-actions-repair.v1',
      repaired_at: new Date().toISOString(),
      backup_dir: backupDir,
      target: TARGET,
      previous_sha256: currentSha,
      candidate_sha256: candidateSha,
      executor_health: health,
      rollback_performed: false
    };
    fs.mkdirSync(path.dirname(MARKER), { recursive: true, mode: 0o700 });
    fs.writeFileSync(MARKER, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(result));
  } catch (error) {
    if (mutated) {
      try {
        const prior = fs.readFileSync(backup);
        writeAtomic(TARGET, prior, st);
        execFile('/usr/local/bin/prhm-node', ['--check', TARGET], 10000);
        execFile('systemctl', ['restart', SERVICE], 30000);
      } catch (rollbackError) {
        throw new Error(`repair_failed_and_rollback_failed:${error.message}:${rollbackError.message}`);
      }
    }
    throw new Error(`repair_failed_rolled_back:${error.message}`);
  }
}

main();
