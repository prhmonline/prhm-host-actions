'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const cp = require('child_process');
const crypto = require('crypto');

const VERSION = '1.0.0-l4-fail-closed';
const SOCKET_DIR = '/run/prhm-agent-selfmaint';
const SOCKET_PATH = `${SOCKET_DIR}/selfmaint.sock`;
const APPROVAL_SOCKET = '/run/prhm-agent-approval/approval.sock';
const APPROVAL_CLIENT_ENV = '/etc/prhm-company-control-plane/approval-client.env';
const BACKUP_DIR = '/var/backups/prhm-agent-selfmaint';
const EVIDENCE_FILE = '/var/log/prhm-agent-selfmaint-evidence.jsonl';
const REGISTRY_SERVICE = 'prhm-company-registry.service';
const APPROVAL_HTTP = 'http://127.0.0.1:18133';
const MAX_BODY = 300000;
const CONFIRM_LITERAL = 'CONFIRM_LEVEL_4_CRITICAL';
const LEVEL3_CONFIRM_LITERAL = 'CONFIRM_LEVEL_3_PRODUCTION';
const OPERATION = 'selfmaint.patch_control_plane';
const HOST_ACTIONS_V1_BASE_MARKER = true;
const { registerCentralOffsiteApprovalRoutes } = require('./centralOffsiteApprovalRoutes.js');
const HOST_ACTIONS_V2_BASE_MARKER = true;
const HOST_ACTION_V2_SPECS = Object.freeze({
  agent_api_process_sandbox_v1: { operation: 'host_action.agent_api_process_sandbox_v1', rollback: 'host-action-v2:agent-api-process-sandbox:auto-backup' },
  agent_api_filesystem_confinement_v1: { operation: 'host_action.agent_api_filesystem_confinement_v1', rollback: 'host-action-v2:agent-api-filesystem-confinement:auto-backup' },
  agent_api_capability_minimize_v1: { operation: 'host_action.agent_api_capability_minimize_v1', rollback: 'host-action-v2:agent-api-capability-minimize:auto-backup' },
  leadops_language_gate_v1: { operation: 'host_action.leadops_language_gate_v1', rollback: 'host-action-v2:leadops-language-gate-v1:auto-backup' },
  mcp_candidate_schema_compare_v1: { operation: 'host_action.mcp_candidate_schema_compare_v1', rollback: 'host-action-v2:mcp-candidate-schema-compare-v1:auto-backup' },
  leadops_economics_inputs_foundation_v1: { operation: 'host_action.leadops_economics_inputs_foundation_v1', rollback: 'host-action-v2:leadops-economics-inputs-foundation-v1:auto-backup' },
  solo_company_selftest_v1: { operation: 'host_action.solo_company_selftest_v1', rollback: 'host-action-v2:solo-company-selftest-v1:synthetic-cleanup' },
  real_market_shadow_uat_v1: { operation: 'host_action.real_market_shadow_uat_v1', rollback: 'host-action-v2:real-market-shadow-uat-v1:temporary-decision-cleanup' },
  real_market_verified_economics_uat_v1: { operation: 'host_action.real_market_verified_economics_uat_v1', rollback: 'host-action-v2:real-market-verified-economics-uat-v1:no-mutation-fixture' },
  company_os_dashboard_v1: { operation: 'host_action.company_os_dashboard_v1', rollback: 'host-action-v2:company-os-dashboard-v1:backup-restore' },
  company_os_dashboard_credentials_reset_v1: { operation: 'host_action.company_os_dashboard_credentials_reset_v1', rollback: 'host-action-v2:company-os-dashboard-credentials-reset-v1:auth-restore' },
  company_os_dashboard_persian_v1: { operation: 'host_action.company_os_dashboard_persian_v1', rollback: 'host-action-v2:company-os-dashboard-persian-v1:app-restore' },
  leadops_parscoders_runtime_v3_restore_v1: { operation: 'host_action.leadops_parscoders_runtime_v3_restore_v1', rollback: 'host-action-v2:leadops-parscoders-runtime-v3-restore-v1:runtime-systemd-db-role-restore' },
  leadops_parscoders_selinux_exec_remediate_v1: { operation: 'host_action.leadops_parscoders_selinux_exec_remediate_v1', rollback: 'host-action-v2:leadops-parscoders-selinux-exec-remediate-v1:fcontext-timer-restore' },
  agent_zero_downtime_bootstrap_v1: { operation: 'host_action.agent_zero_downtime_bootstrap_v1', rollback: 'host-action-v2:agent-zero-downtime-bootstrap-v1:backup-restore' },
  honartik_iticket_dark_backend_batch1_v1: { operation: 'host_action.honartik_iticket_dark_backend_batch1_v1', rollback: 'host-action-v2:honartik-iticket-dark-backend-batch1-v1:worktree-file-rollback' },
  honartik_iticket_dark_backend_batch2_v1: { operation: 'host_action.honartik_iticket_dark_backend_batch2_v1', rollback: 'host-action-v2:honartik-iticket-dark-backend-batch2-v1:worktree-file-rollback' },
  honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1: { operation: 'host_action.honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1', rollback: 'host-action-v2:honartik-iticket-batch2-result-bridge-helper-refresh-v1:helper-file-rollback' },
  host_action_v2_installer_v1: { operation: 'host_action.host_action_v2_installer_v1', rollback: 'host-action-v2:host-action-v2-installer-v1:four-file-restore' },
  imotion_marketing_target_register_v1: { operation: 'host_action.imotion_marketing_target_register_v1', rollback: 'host-action-v2:imotion-marketing-target-register-v1:source-restore' },
  imotion_marketing_targets_register_v2: { operation: 'host_action.imotion_marketing_targets_register_v2', rollback: 'host-action-v2:imotion-marketing-targets-register-v2:source-restore' },
  control_plane_typed_bootstrap_transport_v1: { operation: 'host_action.control_plane_typed_bootstrap_transport_v1', rollback: 'host-action-v2:control-plane-typed-bootstrap-transport-v1:journal-restore' },
  selfmaint_exec_route_refresh_v1: { operation: 'host_action.selfmaint_exec_route_refresh_v1', rollback: 'host-action-v2:selfmaint-exec-route-refresh-v1:no-file-mutation' },
  drtarjomeh_security_containment_v1: { operation: 'host_action.drtarjomeh_security_containment_v1', rollback: 'host-action-v2:drtarjomeh-security-containment-v1:backup-restore' },
  agent_zdt_existing_topology_rolling_refresh_v1: { operation: 'host_action.agent_zdt_existing_topology_rolling_refresh_v1', rollback: 'host-action-v2:rolling-refresh-v1:evidence-restore' },
  agent_zdt_existing_topology_rolling_refresh_rollback_v1: { operation: 'host_action.agent_zdt_existing_topology_rolling_refresh_rollback_v1', rollback: 'host-action-v2:rolling-refresh-v1:evidence-restore' },
  agent_zdt_existing_topology_rolling_refresh_finalize_v1: { operation: 'host_action.agent_zdt_existing_topology_rolling_refresh_finalize_v1', rollback: 'host-action-v2:rolling-refresh-v1:evidence-restore' },
  control_plane_root_scripts_stage_transport_v1: { operation: 'host_action.control_plane_root_scripts_stage_transport_v1', rollback: 'host-action-v2:control-plane-root-scripts-stage-transport-v1:registration-only' },
  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' }
});


const HOST_ACTION_V2_LEVEL3 = new Set(["leadops_language_gate_v1","mcp_candidate_schema_compare_v1","leadops_economics_inputs_foundation_v1","solo_company_selftest_v1","real_market_shadow_uat_v1","real_market_verified_economics_uat_v1","company_os_dashboard_v1","company_os_dashboard_persian_v1","leadops_parscoders_runtime_v3_restore_v1","honartik_iticket_dark_backend_batch1_v1","honartik_iticket_dark_backend_batch2_v1","honartik_iticket_dark_backend_batch2_result_bridge_helper_refresh_v1","imotion_marketing_target_register_v1","imotion_marketing_targets_register_v2","agent_zero_downtime_bootstrap_v1","host_action_v2_installer_v1","control_plane_typed_bootstrap_transport_v1","selfmaint_exec_route_refresh_v1","agent_zdt_existing_topology_rolling_refresh_v1","agent_zdt_existing_topology_rolling_refresh_rollback_v1","agent_zdt_existing_topology_rolling_refresh_finalize_v1","control_plane_root_scripts_stage_transport_v1"]);

function hostActionV2ApprovalMeta(action) {
  const spec = HOST_ACTION_V2_SPECS[String(action || '')];

  if (!spec) {
    throw Object.assign(
      new Error('host_action_v2_not_allowed'),
      { status: 400 }
    );
  }

  const level = HOST_ACTION_V2_LEVEL3.has(String(action || '')) ? 3 : 4;

  return {
    spec,
    level,
    risk: level === 3 ? 'high' : 'critical',
    ttl_seconds: level === 3 ? 300 : 180
  };
}

const HOST_ACTION_OPERATION = 'host_action.harden_agent_api_v1';
const HOST_ACTION_NAME = 'harden_agent_api_v1';
const HOST_ACTION_ROLLBACK = 'host-action:harden-agent-api-v1:auto-backup';

const TARGETS = {
  agent_api: {
    root: '/home/agent/ssh-agent-api',
    service: 'prhm-agent-api.service',
    health: { host: '127.0.0.1', port: 8099, path: '/health' },
    allowed: new Set([
      'server.js',
      'selfmaintRoutes.js',
      'opsExecutorRoutes.js',
      'fileBasicRoutes.js',
      'fileCore.js'
    ])
  },
  agent_mcp: {
    root: '/home/agent/ssh-mcp-server',
    service: 'prhm-agent-mcp.service',
    health: { host: '127.0.0.1', port: 8123, path: '/health' },
    allowed: new Set([
      'server.js',
      'src/core/registry.js',
      'src/plugins/project.js',
      'src/plugins/safeFiles.js',
      'src/plugins/selfmaint.js',
      'src/plugins/hostActionsV2.js'
    ])
  }
};

function nowIso() { return new Date().toISOString(); }
function sha256Buffer(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function sha256Text(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex'); }
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}
function argumentsSha256(args) { return sha256Text(canonicalJson(args)); }

function readEnvFile(file) {
  const out = {};
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function appendEvidence(record) {
  const item = { schema_version: 'prhm.selfmaint-evidence.v1', evidence_id: crypto.randomUUID(), timestamp: nowIso(), ...record };
  fs.appendFileSync(EVIDENCE_FILE, JSON.stringify(item) + '\n', { mode: 0o600 });
  return item;
}

function send(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length });
  res.end(body);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('payload_too_large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}

function resolveSpec(input) {
  const allowedKeys = new Set(['target','path','expected_sha256','new_content','reason']);
  for (const key of Object.keys(input || {})) if (!allowedKeys.has(key)) throw Object.assign(new Error(`unknown_argument:${key}`), { status: 400 });
  const target = String(input.target || '');
  const cfg = TARGETS[target];
  if (!cfg) throw Object.assign(new Error('target_not_allowlisted'), { status: 403 });
  const rel = String(input.path || '');
  if (!cfg.allowed.has(rel)) throw Object.assign(new Error('path_not_allowlisted'), { status: 403 });
  const expected = String(input.expected_sha256 || '');
  if (!/^[a-f0-9]{64}$/.test(expected)) throw Object.assign(new Error('expected_sha256_required'), { status: 400 });
  if (typeof input.new_content !== 'string' || Buffer.byteLength(input.new_content) > 120000) throw Object.assign(new Error('invalid_new_content'), { status: 400 });
  const reason = String(input.reason || '').trim();
  if (reason.length < 3 || reason.length > 1000) throw Object.assign(new Error('reason_required'), { status: 400 });
  const absolute = path.join(cfg.root, rel);
  const normalized = path.normalize(absolute);
  const rootPrefix = path.normalize(cfg.root + path.sep);
  if (!normalized.startsWith(rootPrefix)) throw Object.assign(new Error('path_escape_blocked'), { status: 403 });
  return { target, path: rel, expected_sha256: expected, new_content: input.new_content, reason };
}

function registryPid() {
  const x = cp.execFileSync('systemctl', ['show', REGISTRY_SERVICE, '-p', 'MainPID', '--value'], { encoding: 'utf8' }).trim();
  if (!/^\d+$/.test(x) || x === '0') throw new Error('registry_pid_unavailable');
  return x;
}

function approvalHttp(method, pathname, token, payload) {
  const args = ['-sS', '--max-time', '8', '-X', method, '-H', `Authorization: Bearer ${token}`];
  if (payload !== undefined) args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(payload));
  args.push(`${APPROVAL_HTTP}${pathname}`);
  const r = cp.spawnSync('/usr/bin/curl', args, { encoding: 'utf8', timeout: 10000 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`approval_http_transport_failed:${String(r.stderr || '').trim().slice(0,300)}`);
  let out = {};
  try { out = JSON.parse(r.stdout || '{}'); } catch { throw new Error('approval_http_invalid_json'); }
  if (out.ok !== true) throw Object.assign(new Error(String(out.error || 'approval_http_rejected')), { status: 409 });
  return out;
}

function approvalBridge(pathname, payload) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload));
    const q = http.request({ socketPath: APPROVAL_SOCKET, path: pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': data.length } }, r => {
      let size = 0; const chunks = [];
      r.on('data', c => { size += c.length; if (size <= 65536) chunks.push(c); });
      r.on('end', () => {
        if (size > 65536) return reject(new Error('approval_bridge_response_too_large'));
        let out = {}; try { out = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return reject(new Error('approval_bridge_invalid_json')); }
        if (r.statusCode < 200 || r.statusCode >= 300 || out.ok !== true) return reject(Object.assign(new Error(String(out.error || `approval_bridge_rejected_${r.statusCode}`)), { status: 409 }));
        resolve(out);
      });
    });
    q.setTimeout(5000, () => q.destroy(new Error('approval_bridge_timeout')));
    q.on('error', reject);
    q.end(data);
  });
}

function healthCheck(cfg) {
  return new Promise(resolve => {
    const q = http.get({ ...cfg.health, timeout: 3000 }, r => {
      let d = '';
      r.on('data', c => { if (d.length < 65536) d += c; });
      r.on('end', () => {
        let x = {}; try { x = JSON.parse(d || '{}'); } catch {}
        resolve(r.statusCode === 200 && x.ok === true);
      });
    });
    q.on('timeout', () => { q.destroy(); resolve(false); });
    q.on('error', () => resolve(false));
  });
}

async function waitHealthy(cfg) {
  for (let i = 0; i < 30; i++) {
    if (await healthCheck(cfg)) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

function preflightSyntax(target, tempPath) {
  const bin = target === 'agent_mcp' ? '/usr/local/bin/prhm-node' : '/usr/local/bin/prhm-node';
  const r = cp.spawnSync(bin, ['--check', tempPath], { encoding: 'utf8', timeout: 10000 });
  if (r.status !== 0) throw new Error(`javascript_syntax_invalid:${String(r.stderr || r.stdout || '').trim().slice(0,1000)}`);
}

async function applySpec(spec, approvalToken) {
  const cfg = TARGETS[spec.target];
  const absolute = path.join(cfg.root, spec.path);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw Object.assign(new Error('target_file_missing'), { status: 409 });
  const old = fs.readFileSync(absolute);
  const actual = sha256Buffer(old);
  if (actual !== spec.expected_sha256) throw Object.assign(new Error(`expected_sha256_mismatch:${actual}`), { status: 409 });
  const argHash = argumentsSha256(spec);
  const approval = {
    approval_token: approvalToken,
    principal_id: 'mohammad', role: 'mcp-operator', tool: 'selfmaint_apply', project: spec.target,
    environment: 'production', action: 'write', risk: 'high', operation: OPERATION,
    arguments_sha256: argHash, consumer: 'selfmaint'
  };
  await approvalBridge('/v1/validate', approval);
  await approvalBridge('/v1/consume', approval);

  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);
  const backup = path.join(BACKUP_DIR, `${spec.target}-${spec.path.replace(/\//g,'_')}-${stamp}-${actual}.bak`);
  fs.writeFileSync(backup, old, { flag: 'wx', mode: 0o600 });

  const st = fs.statSync(absolute);
  const temp = `${absolute}.selfmaint-${crypto.randomUUID()}.js`;
  const next = Buffer.from(spec.new_content, 'utf8');
  let mutated = false;
  try {
    fs.writeFileSync(temp, next, { flag: 'wx', mode: st.mode & 0o777 });
    fs.chownSync(temp, st.uid, st.gid);
    preflightSyntax(spec.target, temp);
    fs.renameSync(temp, absolute);
    mutated = true;
    cp.execFileSync('systemctl', ['restart', cfg.service], { timeout: 20000, stdio: 'pipe' });
    if (!(await waitHealthy(cfg))) throw new Error('service_health_failed_after_restart');
    const newSha = sha256Buffer(fs.readFileSync(absolute));
    const ev = appendEvidence({ ok: true, target: spec.target, path: spec.path, service: cfg.service, old_sha256: actual, new_sha256: newSha, arguments_sha256: argHash, backup_path: backup });
    return { ok: true, target: spec.target, path: spec.path, service: cfg.service, old_sha256: actual, new_sha256: newSha, backup_path: backup, evidence_id: ev.evidence_id };
  } catch (e) {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
    if (mutated) {
      try {
        const rb = `${absolute}.rollback-${crypto.randomUUID()}.tmp`;
        fs.writeFileSync(rb, old, { flag: 'wx', mode: st.mode & 0o777 });
        fs.chownSync(rb, st.uid, st.gid);
        fs.renameSync(rb, absolute);
        cp.execFileSync('systemctl', ['restart', cfg.service], { timeout: 20000, stdio: 'pipe' });
        await waitHealthy(cfg);
      } catch (rbErr) {
        appendEvidence({ ok: false, rollback_failed: true, target: spec.target, path: spec.path, error: e.message, rollback_error: rbErr.message, backup_path: backup });
        throw new Error(`apply_failed_and_rollback_failed:${e.message}:${rbErr.message}`);
      }
    }
    appendEvidence({ ok: false, rollback_failed: false, target: spec.target, path: spec.path, error: e.message, backup_path: backup });
    throw e;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const centralOffsiteApproval = registerCentralOffsiteApprovalRoutes({readBody,send,readEnvFile,approvalHttp,approvalBridge,approvalClientEnv:APPROVAL_CLIENT_ENV,confirmLiteral:CONFIRM_LITERAL});
    if (await centralOffsiteApproval(req,res)) return;
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, service: 'prhm-agent-selfmaint', version: VERSION, transport: 'AF_UNIX', approval_operation: OPERATION });
    if (req.method === 'POST' && req.url === '/v1/request') {
      const spec = resolveSpec(await readBody(req));
      const env = readEnvFile(APPROVAL_CLIENT_ENV);
      if (!env.APPROVAL_REQUEST_TOKEN) throw new Error('approval_request_token_missing');
      const result = approvalHttp('POST', '/v1/requests', env.APPROVAL_REQUEST_TOKEN, {
        principal_id: 'mohammad', role: 'mcp-operator', tool: 'selfmaint_apply', project: spec.target,
        environment: 'production', action: 'write', risk: 'high', operation: OPERATION,
        arguments: spec, ttl_seconds: 300, rollback_reference: 'selfmaint:auto-backup-on-apply'
      });
      return send(res, 201, { ok: true, request: result.request });
    }
    if (req.method === 'POST' && req.url === '/v1/confirm') {
      const input = await readBody(req);
      const requestId = String(input.request_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw Object.assign(new Error('invalid_request_id'), { status: 400 });
      if (String(input.second_confirmation || '') !== LEVEL3_CONFIRM_LITERAL) throw Object.assign(new Error('level3_second_confirmation_required'), { status: 409 });
      const env = readEnvFile(APPROVAL_CLIENT_ENV);
      if (!env.APPROVAL_DECISION_TOKEN) throw new Error('approval_decision_token_missing');
      const result = approvalHttp('POST', `/v1/requests/${requestId}/decision`, env.APPROVAL_DECISION_TOKEN, {
        decision: 'accept', note: String(input.note || 'Approved Level-3 self-maintenance change'),
        second_confirmation: LEVEL3_CONFIRM_LITERAL, rollback_reference: 'selfmaint:auto-backup-on-apply'
      });
      return send(res, 200, { ok: true, request: result.request, approval: result.approval, approval_token: result.approval_token });
    }
    if (req.method === 'POST' && req.url === '/v1/host-actions/request') {
      const input = await readBody(req);
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).length !== 1 || String(input.action || '') !== HOST_ACTION_NAME) {
        throw Object.assign(new Error('host_action_not_allowed'), { status: 400 });
      }
      const env = readEnvFile(APPROVAL_CLIENT_ENV);
      if (!env.APPROVAL_REQUEST_TOKEN) throw new Error('approval_request_token_missing');
      const args = { action: HOST_ACTION_NAME };
      const argHash = argumentsSha256(args);
      const result = approvalHttp('POST', '/v1/requests', env.APPROVAL_REQUEST_TOKEN, {
        principal_id: 'mohammad',
        role: 'mcp-operator',
        tool: 'host_action_apply',
        project: 'control_plane',
        environment: 'production',
        action: HOST_ACTION_NAME,
        risk: 'critical',
        operation: HOST_ACTION_OPERATION,
        arguments: args,
        arguments_sha256: argHash,
        ttl_seconds: 180,
        rollback_reference: HOST_ACTION_ROLLBACK
      });
      const request = result.request || {};
      if (!request.request_id ||
          Number(request.level) !== 4 ||
          String(request.action || '') !== HOST_ACTION_NAME ||
          String(request.arguments_sha256 || '') !== argHash) {
        throw Object.assign(new Error('host_action_request_binding_mismatch'), { status: 409 });
      }
      return send(res, 201, {
        ok: true,
        request,
        action: HOST_ACTION_NAME,
        arguments_sha256: argHash
      });
    }

    if (req.method === 'POST' && req.url === '/v1/host-actions/confirm') {
      const input = await readBody(req);
      const allowed = new Set(['request_id', 'action', 'second_confirmation', 'note']);
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw Object.assign(new Error('invalid_host_action_confirm_body'), { status: 400 });
      }
      for (const key of Object.keys(input)) {
        if (!allowed.has(key)) throw Object.assign(new Error('host_action_confirm_field_not_allowed:' + key), { status: 400 });
      }
      const requestId = String(input.request_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw Object.assign(new Error('invalid_request_id'), { status: 400 });
      if (String(input.action || '') !== HOST_ACTION_NAME) throw Object.assign(new Error('host_action_not_allowed'), { status: 400 });
      if (String(input.second_confirmation || '') !== CONFIRM_LITERAL) {
        throw Object.assign(new Error('critical_second_confirmation_required'), { status: 409 });
      }
      const env = readEnvFile(APPROVAL_CLIENT_ENV);
      if (!env.APPROVAL_DECISION_TOKEN) throw new Error('approval_decision_token_missing');
      const result = approvalHttp(
        'POST',
        '/v1/requests/' + requestId + '/decision',
        env.APPROVAL_DECISION_TOKEN,
        {
          decision: 'accept',
          second_confirmation: CONFIRM_LITERAL,
          rollback_reference: HOST_ACTION_ROLLBACK,
          note: String(input.note || 'Approved fixed Host Actions v1 hardening action')
        }
      );
      const approval = result.approval || {};
      const token = String(result.approval_token || result.token || approval.token || '');
      const argHash = argumentsSha256({ action: HOST_ACTION_NAME });
      if (token.length < 32 || token.length > 16384) throw Object.assign(new Error('approval_token_not_returned'), { status: 502 });
      if (approval.execution_authorized !== true) throw Object.assign(new Error('approval_not_execution_authorized'), { status: 409 });
      if (approval.action && String(approval.action) !== HOST_ACTION_NAME) throw Object.assign(new Error('approval_action_mismatch'), { status: 409 });
      if (approval.arguments_sha256 && String(approval.arguments_sha256) !== argHash) throw Object.assign(new Error('approval_arguments_hash_mismatch'), { status: 409 });
      return send(res, 200, {
        ok: true,
        request: result.request,
        approval,
        approval_token: token
      });
    }

    if (req.method === 'POST' && req.url === '/v1/host-actions/authorize-consume') {
      const input = await readBody(req);
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).some(k => !['action', 'approval_token'].includes(k))) {
        throw Object.assign(new Error('invalid_host_action_authorize_body'), { status: 400 });
      }
      if (String(input.action || '') !== HOST_ACTION_NAME) throw Object.assign(new Error('host_action_not_allowed'), { status: 400 });
      const token = String(input.approval_token || '');
      if (token.length < 32 || token.length > 16384) throw Object.assign(new Error('approval_token_required'), { status: 400 });
      const argHash = argumentsSha256({ action: HOST_ACTION_NAME });
      const binding = {
        approval_token: token,
        principal_id: 'mohammad',
        role: 'mcp-operator',
        tool: 'host_action_apply',
        project: 'control_plane',
        environment: 'production',
        action: HOST_ACTION_NAME,
        risk: 'critical',
        operation: HOST_ACTION_OPERATION,
        arguments_sha256: argHash
      };
      const validated = await approvalBridge('/v1/validate', binding);
      if (validated.valid !== true) throw Object.assign(new Error('host_action_approval_validation_failed'), { status: 409 });
      const consumed = await approvalBridge('/v1/consume', {
        ...binding,
        consumer: 'prhm-agent-selfmaint-exec-host-actions-v1'
      });
      if (consumed.consumed !== true) throw Object.assign(new Error('host_action_approval_consume_failed'), { status: 409 });
      return send(res, 200, {
        ok: true,
        valid: true,
        consumed: true,
        action: HOST_ACTION_NAME,
        arguments_sha256: argHash,
        token_exposed: false
      });
    }

    if (req.method === 'POST' && req.url === '/v2/host-actions/request') {
      const input = await readBody(req);
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1) throw Object.assign(new Error('invalid_host_action_v2_request'), { status: 400 });
      const action = String(input.action || '');
      const { spec, level, risk, ttl_seconds } = hostActionV2ApprovalMeta(action);
      const env = readEnvFile(APPROVAL_CLIENT_ENV);
      if (!env.APPROVAL_REQUEST_TOKEN) throw new Error('approval_request_token_missing');
      const args = { action };
      const argHash = argumentsSha256(args);
      const result = approvalHttp('POST', '/v1/requests', env.APPROVAL_REQUEST_TOKEN, {
        principal_id:'mohammad', role:'mcp-operator', tool:'host_action_v2_apply', project:'control_plane', environment:'production', action, risk, operation:spec.operation, arguments:args, arguments_sha256:argHash, ttl_seconds, rollback_reference:spec.rollback
      });
      const request = result.request || {};
      if (!request.request_id || Number(request.level)!==level || String(request.action||'')!==action || String(request.arguments_sha256||'')!==argHash) throw Object.assign(new Error('host_action_v2_request_binding_mismatch'), { status:409 });
      return send(res,201,{ok:true,request,action,arguments_sha256:argHash});
    }

    if (req.method === 'POST' && req.url === '/v2/host-actions/confirm') {
      const input = await readBody(req);
      const allowed = new Set(['request_id','action','second_confirmation','note']);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('invalid_host_action_v2_confirm_body'), { status:400 });
      for (const key of Object.keys(input)) if (!allowed.has(key)) throw Object.assign(new Error('host_action_v2_confirm_field_not_allowed:'+key), { status:400 });
      const requestId=String(input.request_id||'');
      if(!/^[0-9a-f-]{36}$/i.test(requestId))throw Object.assign(new Error('invalid_request_id'),{status:400});
      const action=String(input.action||'');
      const { spec, level, risk, ttl_seconds } = hostActionV2ApprovalMeta(action);
      const confirmation=String(input.second_confirmation||'');if(level===4&&confirmation!==CONFIRM_LITERAL)throw Object.assign(new Error('critical_second_confirmation_required'),{status:409});if(level===3&&confirmation!==LEVEL3_CONFIRM_LITERAL)throw Object.assign(new Error('production_confirmation_required'),{status:409});
      const env=readEnvFile(APPROVAL_CLIENT_ENV);
      if(!env.APPROVAL_DECISION_TOKEN)throw new Error('approval_decision_token_missing');
      const decision={decision:'accept',rollback_reference:spec.rollback,note:String(input.note||'Approved fixed Host Actions v2 stage')};if(level===4)decision.second_confirmation=CONFIRM_LITERAL;const result=approvalHttp('POST','/v1/requests/'+requestId+'/decision',env.APPROVAL_DECISION_TOKEN,decision);
      const approval=result.approval||{};
      const token=String(result.approval_token||result.token||approval.token||'');
      const argHash=argumentsSha256({action});
      if(token.length<32||token.length>16384)throw Object.assign(new Error('approval_token_not_returned'),{status:502});
      if(approval.execution_authorized!==true)throw Object.assign(new Error('approval_not_execution_authorized'),{status:409});
      if(approval.action&&String(approval.action)!==action)throw Object.assign(new Error('approval_action_mismatch'),{status:409});
      if(approval.arguments_sha256&&String(approval.arguments_sha256)!==argHash)throw Object.assign(new Error('approval_arguments_hash_mismatch'),{status:409});
      return send(res,200,{ok:true,request:result.request,approval,approval_token:token});
    }

    if (req.method === 'POST' && req.url === '/v2/host-actions/authorize-consume') {
      const input=await readBody(req);
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['action','approval_token'].includes(k)))throw Object.assign(new Error('invalid_host_action_v2_authorize_body'),{status:400});
      const action=String(input.action||'');
      const { spec, level, risk, ttl_seconds } = hostActionV2ApprovalMeta(action);
      const token=String(input.approval_token||'');
      if(token.length<32||token.length>16384)throw Object.assign(new Error('approval_token_required'),{status:400});
      const argHash=argumentsSha256({action});
      const binding={approval_token:token,principal_id:'mohammad',role:'mcp-operator',tool:'host_action_v2_apply',project:'control_plane',environment:'production',action,risk,operation:spec.operation,arguments_sha256:argHash};
      const validated=await approvalBridge('/v1/validate',binding);
      if(validated.valid!==true)throw Object.assign(new Error('host_action_v2_approval_validation_failed'),{status:409});
      const consumed=await approvalBridge('/v1/consume',{...binding,consumer:'prhm-agent-selfmaint-exec-host-actions-v2'});
      if(consumed.consumed!==true)throw Object.assign(new Error('host_action_v2_approval_consume_failed'),{status:409});
      return send(res,200,{ok:true,valid:true,consumed:true,action,arguments_sha256:argHash,token_exposed:false});
    }
    if (req.method === 'POST' && req.url === '/v1/apply') {
      const input = await readBody(req);
      const token = String(input.approval_token || '');
      if (token.length < 32 || token.length > 16384) throw Object.assign(new Error('approval_token_required'), { status: 400 });
      const spec = resolveSpec(input.spec || {});
      const result = await applySpec(spec, token);
      return send(res, 200, result);
    }
    return send(res, 404, { ok: false, error: 'not_found' });
  } catch (e) {
    return send(res, Number(e.status || 500), { ok: false, error: e.message });
  }
});

fs.mkdirSync(SOCKET_DIR, { recursive: true, mode: 0o700 });
try { fs.chmodSync(SOCKET_DIR, 0o700); } catch {}
if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);
server.listen(SOCKET_PATH, () => {
  fs.chmodSync(SOCKET_PATH, 0o600);
});
