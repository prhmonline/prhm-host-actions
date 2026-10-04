#!/usr/local/bin/prhm-node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const ALLOWED_MODES = ['--preflight-only', '--apply', '--status', '--session-ensure', '--qr', '--rollback'];
const SPEC = Object.freeze({
  action: 'waha_student_bridge_install_v1',
  root: '/opt/prhm-whatsapp-student-bridge',
  sessions: '/opt/prhm-whatsapp-student-bridge/sessions',
  compose: '/opt/prhm-whatsapp-student-bridge/compose.yml',
  env: '/opt/prhm-whatsapp-student-bridge/.env',
  key: '/opt/prhm-whatsapp-student-bridge/api-key.secret',
  marker: '/opt/prhm-whatsapp-student-bridge/.prhm-waha-bridge-v1.json',
  result: '/opt/prhm-whatsapp-student-bridge/install-result.json',
  image: 'devlikeapro/waha:gows-2026.9.2@sha256:b4a6d545b069b642cc3743d91801c0e98c9dcd6247b029a275bfb3b295ed9e4d',
  imageTag: 'gows-2026.9.2',
  imageDigest: 'sha256:b4a6d545b069b642cc3743d91801c0e98c9dcd6247b029a275bfb3b295ed9e4d',
  host: '127.0.0.1',
  port: 3105,
  containerPort: 3000,
  container: 'prhm-whatsapp-student-bridge',
  session: 'student-outreach',
});

function buildCompose() {
  return `services:\n  waha:\n    image: ${SPEC.image}\n    container_name: ${SPEC.container}\n    restart: unless-stopped\n    env_file:\n      - .env\n    ports:\n      - \"${SPEC.host}:${SPEC.port}:${SPEC.containerPort}\"\n    volumes:\n      - \"./sessions:/app/.sessions\"\n`;
}

function buildEnv(apiKeyHash) {
  if (!/^[a-f0-9]{128}$/.test(apiKeyHash)) throw new Error('invalid_api_key_hash');
  return [
    `WAHA_API_KEY=sha512:${apiKeyHash}`,
    'WAHA_DASHBOARD_ENABLED=false',
    'WHATSAPP_SWAGGER_ENABLED=false',
    'WHATSAPP_DEFAULT_ENGINE=GOWS',
    'WAHA_API_KEY_EXCLUDE_PATH=health,ping',
    'WAHA_CLIENT_DEVICE_NAME=DrTarjomeh Student Outreach',
    'WAHA_CLIENT_BROWSER_NAME=Desktop',
    '',
  ].join('\n');
}

function sessionPath() {
  return `/api/sessions/${SPEC.session}`;
}

function sessionStartPath() {
  return `${sessionPath()}/start`;
}

function qrPath() {
  return `/api/${SPEC.session}/auth/qr`;
}

function sanitizeQrPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('qr_payload_invalid');
  const mimetype = String(payload.mimetype || payload.mimeType || '');
  const data = String(payload.data || payload.value || payload.qr || '');
  if (!/^image\/(png|jpeg)$/.test(mimetype)) throw new Error('qr_mimetype_invalid');
  if (!data || data.length > 300000) throw new Error('qr_payload_invalid');
  return { mimetype, data };
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function exec(file, args, opts = {}) {
  const r = cp.spawnSync(file, args, {
    encoding: 'utf8',
    timeout: opts.timeout || 120000,
    maxBuffer: 1024 * 1024,
    env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C', HOME: '/root' },
  });
  if (r.error) throw r.error;
  if (r.status !== 0 && !opts.allowFailure) {
    throw new Error(`${path.basename(file)}_failed:${String(r.stderr || r.stdout || '').trim().slice(0, 1200)}`);
  }
  return r;
}

function commandPath(name) {
  const r = exec('/usr/bin/env', ['which', name], { allowFailure: true, timeout: 10000 });
  if (r.status !== 0) throw new Error(`required_command_missing:${name}`);
  const value = String(r.stdout || '').trim();
  if (!value.startsWith('/')) throw new Error(`required_command_invalid:${name}`);
  return value;
}

function portInUse() {
  const ss = commandPath('ss');
  const r = exec(ss, ['-ltnH'], { timeout: 10000 });
  return String(r.stdout || '').split(/\n/).some(line => line.includes(`:${SPEC.port}`));
}

function containerExists() {
  const docker = commandPath('docker');
  const r = exec(docker, ['container', 'inspect', SPEC.container], { allowFailure: true, timeout: 15000 });
  return r.status === 0;
}

function apiStatus(pathname, apiKey) {
  const curl = commandPath('curl');
  const args = ['--silent', '--show-error', '--output', '/dev/null', '--write-out', '%{http_code}', '--max-time', '5'];
  if (apiKey) args.push('-H', `X-Api-Key: ${apiKey}`);
  args.push(`http://${SPEC.host}:${SPEC.port}${pathname}`);
  const r = exec(curl, args, { allowFailure: true, timeout: 10000 });
  return { exit: r.status, code: String(r.stdout || '').trim() };
}

function apiRequest(method, pathname, apiKey, body) {
  const curl = commandPath('curl');
  const args = ['--silent', '--show-error', '--write-out', '\n%{http_code}', '--max-time', '10', '-X', method, '-H', 'Accept: application/json'];
  if (apiKey) args.push('-H', `X-Api-Key: ${apiKey}`);
  if (body !== undefined) args.push('-H', 'Content-Type: application/json', '--data', JSON.stringify(body));
  args.push(`http://${SPEC.host}:${SPEC.port}${pathname}`);
  const r = exec(curl, args, { allowFailure: true, timeout: 15000 });
  const raw = String(r.stdout || '');
  const split = raw.lastIndexOf('\n');
  return {
    exit: r.status,
    body: split >= 0 ? raw.slice(0, split) : '',
    code: split >= 0 ? raw.slice(split + 1).trim() : '',
  };
}

function compose(args, opts = {}) {
  const docker = commandPath('docker');
  return exec(docker, ['compose', '-f', SPEC.compose, ...args], opts);
}

function secureWrite(file, content, mode) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, content, { flag: 'wx', mode });
  fs.chmodSync(tmp, mode);
  fs.chownSync(tmp, 0, 0);
  fs.renameSync(tmp, file);
}

function requireApiKey() {
  if (!fs.existsSync(SPEC.key)) throw new Error('waha_api_key_missing');
  const apiKey = fs.readFileSync(SPEC.key, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(apiKey)) throw new Error('waha_api_key_invalid');
  return apiKey;
}

function baseEvidence() {
  return {
    schema_version: 'prhm.waha-student-bridge-result.v1',
    action: SPEC.action,
    image_tag: SPEC.imageTag,
    image_digest: SPEC.imageDigest,
    host: SPEC.host,
    port: SPEC.port,
    session: SPEC.session,
    dashboard_enabled: false,
    swagger_enabled: false,
    public_listener: false,
    database_mutation: false,
  };
}

function preflight() {
  if (process.getuid && process.getuid() !== 0) throw new Error('root_required');
  commandPath('docker');
  commandPath('curl');
  commandPath('ss');
  const composeVersion = compose(['version'], { timeout: 15000 });
  if (!String(composeVersion.stdout || '').toLowerCase().includes('docker compose')) throw new Error('docker_compose_unverified');
  if (fs.existsSync(SPEC.root)) throw new Error('target_root_already_exists');
  if (containerExists()) throw new Error('container_name_conflict');
  if (portInUse()) throw new Error('port_conflict');
  return { ok: true, ...baseEvidence(), preflight_only: true, target_absent: true, port_available: true, container_absent: true };
}

function waitHealthy(apiKey) {
  const started = Date.now();
  while (Date.now() - started < 120000) {
    const health = apiStatus('/health');
    if (health.exit === 0 && health.code === '200') {
      const unauth = apiStatus('/api/sessions');
      const auth = apiStatus('/api/sessions', apiKey);
      if (unauth.code === '401' && auth.code === '200') return { health: true, api_auth_verified: true };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error('waha_health_timeout');
}

function apply() {
  preflight();
  const docker = commandPath('docker');
  let rootCreated = false;
  let composeStarted = false;
  try {
    exec(docker, ['pull', SPEC.image], { timeout: 900000 });
    fs.mkdirSync(SPEC.root, { mode: 0o700 });
    rootCreated = true;
    fs.chownSync(SPEC.root, 0, 0);
    fs.mkdirSync(SPEC.sessions, { mode: 0o700 });
    fs.chmodSync(SPEC.sessions, 0o700);
    fs.chownSync(SPEC.sessions, 0, 0);

    const apiKey = crypto.randomBytes(32).toString('hex');
    const apiHash = crypto.createHash('sha512').update(apiKey).digest('hex');
    secureWrite(SPEC.compose, buildCompose(), 0o644);
    secureWrite(SPEC.env, buildEnv(apiHash), 0o600);
    secureWrite(SPEC.key, apiKey + '\n', 0o600);

    compose(['config', '--quiet'], { timeout: 30000 });
    compose(['up', '-d', '--no-build'], { timeout: 180000 });
    composeStarted = true;

    const checks = waitHealthy(apiKey);
    const marker = { ...baseEvidence(), installed_at: new Date().toISOString(), compose_sha256: digest(fs.readFileSync(SPEC.compose)), env_sha256: digest(fs.readFileSync(SPEC.env)) };
    secureWrite(SPEC.marker, JSON.stringify(marker) + '\n', 0o600);
    const result = { ok: true, ...baseEvidence(), installed: true, health: checks.health, api_auth_verified: checks.api_auth_verified, session_storage_persistent: true, rollback_performed: false };
    secureWrite(SPEC.result, JSON.stringify(result) + '\n', 0o600);
    return result;
  } catch (error) {
    let rollbackError = null;
    try {
      if (composeStarted && fs.existsSync(SPEC.compose)) compose(['down', '--remove-orphans'], { allowFailure: true, timeout: 120000 });
      if (rootCreated && fs.existsSync(SPEC.root)) fs.rmSync(SPEC.root, { recursive: true, force: true });
    } catch (e) { rollbackError = String(e && e.message || e); }
    if (rollbackError) throw new Error(`apply_failed_rollback_failed:${String(error && error.message || error)}:${rollbackError}`);
    throw new Error(`apply_failed_rolled_back:${String(error && error.message || error)}`);
  }
}

function status() {
  if (!fs.existsSync(SPEC.marker) || !fs.existsSync(SPEC.key)) return { ok: true, ...baseEvidence(), installed: false };
  const apiKey = requireApiKey();
  const health = apiStatus('/health');
  const auth = apiStatus('/api/sessions', apiKey);
  const docker = commandPath('docker');
  const inspect = exec(docker, ['container', 'inspect', '-f', '{{.State.Status}}', SPEC.container], { allowFailure: true, timeout: 15000 });
  return { ok: true, ...baseEvidence(), installed: true, container_status: String(inspect.stdout || '').trim() || 'unknown', health: health.code === '200', api_auth_verified: auth.code === '200' };
}

function ensureSession() {
  const current = status();
  if (current.installed !== true || current.health !== true || current.api_auth_verified !== true) throw new Error('waha_not_ready');
  const apiKey = requireApiKey();
  const existing = apiRequest('GET', sessionPath(), apiKey);
  let created = false;
  if (existing.code === '404') {
    const create = apiRequest('POST', '/api/sessions', apiKey, { name: SPEC.session, start: true });
    if (!['200', '201', '202'].includes(create.code)) throw new Error(`session_create_failed_http_${create.code}`);
    created = true;
  } else if (existing.code === '200') {
    const start = apiRequest('POST', sessionStartPath(), apiKey);
    if (!['200', '201', '202', '409'].includes(start.code)) throw new Error(`session_start_failed_http_${start.code}`);
  } else {
    throw new Error(`session_lookup_failed_http_${existing.code}`);
  }
  const finalState = apiRequest('GET', sessionPath(), apiKey);
  if (finalState.code !== '200') throw new Error(`session_verify_failed_http_${finalState.code}`);
  let sessionStatus = 'unknown';
  try {
    const parsed = JSON.parse(finalState.body || '{}');
    sessionStatus = String(parsed.status || parsed.state || 'unknown').slice(0, 80);
  } catch {}
  return { ok: true, ...baseEvidence(), installed: true, session_ensured: true, session_created: created, session_status: sessionStatus };
}

function qr() {
  const current = status();
  if (current.installed !== true || current.health !== true || current.api_auth_verified !== true) throw new Error('waha_not_ready');
  const apiKey = requireApiKey();
  const response = apiRequest('GET', qrPath(), apiKey);
  if (response.code !== '200') throw new Error(`qr_failed_http_${response.code}`);
  let payload;
  try { payload = JSON.parse(response.body); }
  catch { throw new Error('qr_invalid_json'); }
  return { ok: true, ...baseEvidence(), qr_available: true, ...sanitizeQrPayload(payload) };
}

function rollback() {
  if (process.getuid && process.getuid() !== 0) throw new Error('root_required');
  if (!fs.existsSync(SPEC.root)) return { ok: true, ...baseEvidence(), installed: false, rollback_performed: false, sessions_preserved: true };
  if (fs.existsSync(SPEC.compose)) compose(['down', '--remove-orphans'], { allowFailure: true, timeout: 120000 });
  return { ok: true, ...baseEvidence(), installed: false, rollback_performed: true, sessions_preserved: true, runtime_files_preserved: true };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !ALLOWED_MODES.includes(args[0])) throw new Error('unexpected_arguments');
  let out;
  if (args[0] === '--preflight-only') out = preflight();
  else if (args[0] === '--apply') out = apply();
  else if (args[0] === '--status') out = status();
  else if (args[0] === '--session-ensure') out = ensureSession();
  else if (args[0] === '--qr') out = qr();
  else out = rollback();
  process.stdout.write(JSON.stringify(out) + '\n');
}

module.exports = { SPEC, ALLOWED_MODES, buildCompose, buildEnv, sessionPath, sessionStartPath, qrPath, sanitizeQrPayload, preflight, apply, status, ensureSession, qr, rollback };
if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(JSON.stringify({ ok: false, action: SPEC.action, error: String(error && error.message || error) }) + '\n');
    process.exit(1);
  }
}
