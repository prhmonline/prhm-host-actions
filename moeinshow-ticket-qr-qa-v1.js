#!/usr/bin/env node
'use strict';

/**
 * Fixed, reviewed-source-only PRHM Host Action candidate.
 *
 * Action: moeinshow_ticket_qr_offline_qa_v1
 * Inputs: NONE. No caller path, command, repository, branch or token.
 *
 * This module is NOT automatically registered or deployed. An independently
 * reviewed, approval-bound Host Actions v2 adapter must invoke runFixed().
 * Direct CLI accepts only the nonmutating '--selftest' mode.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const ACTION = 'moeinshow_ticket_qr_offline_qa_v1';
const SOURCE_SHA = '7e670bc6f11267d8b955f1b3671787adecc65c93';
const BUNDLE = path.join(__dirname, 'qa/moeinshow-ticket-qr-qa-v1');
const SOURCE = path.join(BUNDLE, 'source');
const MANIFEST = path.join(BUNDLE, 'manifest.json');
const EMITTER = path.join(BUNDLE, 'EmitSyntheticArtifacts.php');
const PROD = '/home/moeinshow/domains/dashboard.moeinshow.com/public_html';
const PROD_VENDOR = PROD + '/vendor';
const RESULT_ROOT = '/var/cache/prhm-moeinshow-ticket-qr-qa-v1';
const TOKEN = 'MOEINSHOW-QA-TICKET-0001';
const EMITTER_BLOB_SHA = '176c611d11c1a68cc21fa36f7d140cce0e372a38';
const MAX_VENDOR_BYTES = 850000000;
const FILES = Object.freeze({
  'composer.json': '73654b0e1186103b70e4f70c268ee3b64c274749',
  'app/tests/contract/TicketQrContract.php': 'e16fce7ab7557f67157f7aeb4c2185e348a0541e',
  'app/views/admin-reserve/print-ticket-new.php': 'd51b8d96504b76c41d36e6a43992d67720eea4e6',
  'app/views/admin-reserve/_print-ticket-mpdf.php': '63679ed5e2d129f9fc30ef5bd95f9e89b4fb4900',
  'app/modules/api/views/public/print-ticket-new.php': 'cc9a89b7457d174b841b54c97af96bb107374d95',
  'scripts/verify-ticket-qr-offline.sh': '20206454a5614b113ba18c1445fa6c708275b9a2'
});

function fail(code) { throw new Error(code); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function gitBlobSha(bytes) {
  return crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}
function regular(file) {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || fs.realpathSync(file) !== file) fail('unsafe_file');
  return s;
}
function directory(dir) {
  const s = fs.lstatSync(dir);
  if (!s.isDirectory() || s.isSymbolicLink() || fs.realpathSync(dir) !== dir) fail('unsafe_directory');
  return s;
}
function runBinary(exe, args, options) {
  const result = cp.spawnSync(exe, args, {
    encoding: 'utf8', timeout: 150000, maxBuffer: 512000, shell: false,
    env: {PATH: '/usr/bin:/bin'}, ...options
  });
  if (result.error || result.status !== 0) fail('fixed_command_failed:' + path.basename(exe));
  return String(result.stdout || '');
}
function listPinnedTreeFiles(dir, prefix = '') {
  const found = [];
  for (const item of fs.readdirSync(dir, {withFileTypes: true})) {
    if (item.isSymbolicLink()) fail('unexpected_source_symlink');
    const rel = prefix ? prefix + '/' + item.name : item.name;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) found.push(...listPinnedTreeFiles(full, rel));
    else if (item.isFile()) found.push(rel);
    else fail('unexpected_source_item');
  }
  return found.sort();
}
function verifySource() {
  directory(BUNDLE);
  directory(SOURCE);
  regular(MANIFEST);
  regular(EMITTER);
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  if (m.schema !== 'prhm.moeinshow-ticket-qr-qa.v1'
    || m.action !== ACTION || m.source_commit !== SOURCE_SHA
    || m.fixed_test_token !== TOKEN
    || m.production_vendor_source !== PROD_VENDOR
    || JSON.stringify(m.source_files) !== JSON.stringify(FILES)) fail('manifest_pin_mismatch');
  const actualFiles = listPinnedTreeFiles(SOURCE);
  if (JSON.stringify(actualFiles) !== JSON.stringify(Object.keys(FILES).sort())) fail('unexpected_unpinned_source_file');
  const digests = {};
  for (const [name, pinned] of Object.entries(FILES)) {
    const full = path.join(SOURCE, name);
    regular(full);
    const bytes = fs.readFileSync(full);
    if (gitBlobSha(bytes) !== pinned) fail('git_blob_sha_mismatch:' + name);
    digests[name] = sha256(bytes);
  }
  const emitterBytes = fs.readFileSync(EMITTER);
  if (gitBlobSha(emitterBytes) !== EMITTER_BLOB_SHA) fail('emitter_source_sha_mismatch');
  if (!emitterBytes.includes(Buffer.from(TOKEN))) fail('emitter_token_mismatch');
  if (!emitterBytes.includes(Buffer.from('Zxing\\QrReader'))) fail('emitter_decoder_missing');
  return {
    ok: true, action: ACTION, source_sha: SOURCE_SHA,
    fixture_count: Object.keys(digests).length,
    verified_source_sha256: digests,
    network_required: false, production_writes: false
  };
}
function preflight() {
  const out = verifySource();
  const p = directory(PROD);
  directory(PROD_VENDOR);
  regular(path.join(PROD_VENDOR, 'autoload.php'));
  regular(path.join(PROD_VENDOR, 'composer/installed.json'));
  const needed = ['2amigos/qrcode-library', 'mpdf/mpdf', 'khanamiryan/qrcode-detector-decoder'];
  const installed = fs.readFileSync(path.join(PROD_VENDOR, 'composer/installed.json'), 'utf8');
  for (const pkg of needed) if (!installed.includes('"' + pkg + '"')) fail('missing_vendor_package:' + pkg);
  const size = Number(runBinary('/usr/bin/du', ['-sb', PROD_VENDOR]).trim().split(/\s+/)[0]);
  if (!Number.isFinite(size) || size < 10000 || size > MAX_VENDOR_BYTES) fail('vendor_size_outside_limit');
  const link = runBinary('/usr/bin/find', [PROD_VENDOR, '-type', 'l', '-print', '-quit']);
  if (link.trim() !== '') fail('vendor_symlink_rejected');
  return {
    ...out, vendor_ready: true, vendor_bytes: size,
    production_uid: p.uid, production_gid: p.gid,
    isolated_workspace: RESULT_ROOT,
    cpu_quota: '25%', memory_max: '512M', tasks_max: 32,
    php_runtime_seconds: 120
  };
}
function chownTree(root, uid, gid) {
  for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
    if (entry.isSymbolicLink()) fail('source_symlink_rejected');
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) chownTree(full, uid, gid);
    else if (!entry.isFile()) fail('source_not_regular');
    fs.chownSync(full, uid, gid);
  }
  fs.chownSync(root, uid, gid);
}
function buildSystemdArgs(stage, script) {
  return [
    '--wait', '--collect', '--pipe', '--quiet',
    '--unit=prhm-moeinshow-ticket-qr-qa-v1',
    '--property=Type=oneshot',
    '--property=TimeoutStartSec=120s',
    '--property=User=moeinshow',
    '--property=Group=moeinshow',
    '--property=NoNewPrivileges=yes',
    '--property=PrivateNetwork=yes',
    '--property=IPAddressDeny=any',
    '--property=RestrictAddressFamilies=AF_UNIX',
    '--property=PrivateTmp=yes',
    '--property=PrivateDevices=yes',
    '--property=ProtectSystem=strict',
    '--property=ProtectHome=tmpfs',
    '--property=ProtectKernelTunables=yes',
    '--property=ProtectKernelModules=yes',
    '--property=ProtectControlGroups=yes',
    '--property=CapabilityBoundingSet=',
    '--property=RestrictSUIDSGID=yes',
    '--property=LockPersonality=yes',
    '--property=UMask=0077',
    '--property=CPUQuota=25%',
    '--property=MemoryMax=512M',
    '--property=TasksMax=32',
    '--property=RuntimeMaxSec=120',
    '--property=InaccessiblePaths=-/var/lib/mysql -/run/mysqld -/run/postgresql',
    '--property=ReadWritePaths=' + stage,
    '--property=WorkingDirectory=' + path.join(stage, 'source'),
    '/bin/bash', script
  ];
}
function ensureResultRoot() {
  directory('/var');
  const resultParent = directory('/var/cache');
  if (resultParent.uid !== 0 || (resultParent.mode & 0o022) !== 0) fail('qa_parent_unsafe');
  if (!fs.existsSync(RESULT_ROOT)) fs.mkdirSync(RESULT_ROOT, {mode: 0o711});
  const resultStat = directory(RESULT_ROOT);
  if (resultStat.uid !== 0) fail('qa_result_not_root_owned');
  // Root controls this directory; QA service user may traverse, never list it.
  fs.chmodSync(RESULT_ROOT, 0o711);
}
function writeAtomic(file, payload) {
  const temp = file + '.tmp-' + process.pid;
  fs.writeFileSync(temp, payload, {mode: 0o600, flag: 'wx'});
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, file);
}
function runFixed() {
  if (process.getuid() !== 0) fail('registered_root_action_required');
  const before = preflight();
  ensureResultRoot();
  // Refuse overlapping QA operations rather than racing artifact state.
  const lock = path.join(RESULT_ROOT, '.run-lock');
  fs.mkdirSync(lock, {mode: 0o700});
  try {
  const latest = path.join(RESULT_ROOT, 'latest.json');
  writeAtomic(latest, JSON.stringify({
    ok: false, status: 'running', action: ACTION, source_sha: SOURCE_SHA
  }, null, 2) + '\n');
  const stage = fs.mkdtempSync(path.join(RESULT_ROOT, 'stage-'));
  fs.chownSync(stage, before.production_uid, before.production_gid);
  fs.chmodSync(stage, 0o700);
  try {
    directory(stage);
    const workspace = path.join(stage, 'source');
    fs.cpSync(SOURCE, workspace, {recursive: true, dereference: false, errorOnExist: true, force: false});
    fs.copyFileSync(EMITTER, path.join(workspace, 'app/tests/contract/EmitSyntheticArtifacts.php'));
    chownTree(workspace, before.production_uid, before.production_gid);
    const output = path.join(workspace, 'qa-output');
    fs.mkdirSync(output, {mode: 0o700});
    fs.chownSync(output, before.production_uid, before.production_gid);

    // Vendor dependencies only: NEVER copy app configs, env, database, logs or secrets.
    runBinary('/usr/bin/cp', ['-R', '--reflink=auto', '--no-preserve=ownership,mode', PROD_VENDOR, path.join(workspace, 'vendor')],
      {uid: before.production_uid, gid: before.production_gid});
    const wrapper = path.join(stage, 'run-fixed.sh');
    const shell = [
      '#!/bin/bash', 'set -euo pipefail', 'umask 077',
      'cd "' + workspace + '"',
      '/bin/bash scripts/verify-ticket-qr-offline.sh',
      '/usr/bin/php -d allow_url_fopen=0 -d memory_limit=256M',
      '  -d disable_functions=curl_exec,fsockopen,pfsockopen,stream_socket_client,exec,shell_exec,system,passthru,proc_open',
      '  app/tests/contract/EmitSyntheticArtifacts.php'
    ].join('\n').replace('\n  -d', ' -d').replace('\n  app/', ' app/') + '\n';
    fs.writeFileSync(wrapper, shell, {mode: 0o500});
    fs.chownSync(wrapper, before.production_uid, before.production_gid);
    const job = runBinary('/usr/bin/systemd-run', buildSystemdArgs(stage, wrapper), {timeout: 150000});
    const required = [
      'TICKET_QR_CONTRACT_PASS=10',
      'TICKET_QR_RUNTIME_PNG_PDF_PASS',
      'QR_SCAN_PASS', 'QR_PNG_PASS', 'PDF_RENDER_PASS',
      'MOEINSHOW_TICKET_QR_OFFLINE_PASS'
    ];
    for (const marker of required) if (!job.includes(marker)) fail('runtime_marker_missing:' + marker);
    const artifactRoot = path.join(RESULT_ROOT, 'artifacts');
    if (!fs.existsSync(artifactRoot)) fs.mkdirSync(artifactRoot, {mode: 0o700});
    directory(artifactRoot);
    fs.chmodSync(artifactRoot, 0o700);
    const hashes = {};
    for (const name of ['moeinshow-qa-qr.png', 'moeinshow-qa-ticket.pdf']) {
      const input = path.join(output, name);
      const buf = fs.readFileSync(input);
      regular(input);
      if (buf.length < 100 || buf.length > 3000000) fail('artifact_size_invalid');
      if (name.endsWith('.png') && !buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) fail('png_magic_invalid');
      if (name.endsWith('.pdf') && buf.subarray(0, 5).toString() !== '%PDF-') fail('pdf_magic_invalid');
      const dest = path.join(artifactRoot, name);
      writeAtomic(dest, buf);
      hashes[name] = {sha256: sha256(buf), bytes: buf.length};
    }
    const result = {
      ok: true, action: ACTION, source_sha: SOURCE_SHA,
      original_checkout_modified: false, database_access: false,
      sms_sent: false, payments_started: false, new_vm_created: false,
      sandbox_private_network: true,
      limits: {cpu: '25%', memory: '512M', tasks: 32, runtime_seconds: 120},
      test_markers: required, artifacts: hashes
    };
    writeAtomic(latest, JSON.stringify(result, null, 2) + '\n');
    return result;
  } catch (error) {
    writeAtomic(latest, JSON.stringify({
      ok: false, status: 'failed', action: ACTION, source_sha: SOURCE_SHA,
      error_code: String(error && error.message || 'unexpected_failure').slice(0, 160),
      production_mutation: false
    }, null, 2) + '\n');
    throw error;
  } finally {
    if (!stage.startsWith(RESULT_ROOT + path.sep)) fail('unsafe_stage_cleanup');
    fs.rmSync(stage, {recursive: true, force: true});
  }
  } finally {
    fs.rmdirSync(lock);
  }
}
if (require.main === module) {
  if (process.argv.length !== 3 || process.argv[2] !== '--selftest') fail('direct_execution_not_permitted');
  const v = verifySource();
  const args = buildSystemdArgs(RESULT_ROOT + '/stage-example',
    RESULT_ROOT + '/stage-example/run-fixed.sh');
  if (!args.includes('--property=PrivateNetwork=yes') ||
      !args.includes('--property=MemoryMax=512M') ||
      args.some(x => x.includes('127.0.0.1:3306'))) fail('sandbox_contract_failed');
  console.log(JSON.stringify({selftest_pass: true, ...v}));
}
module.exports = {verifySource, preflight, buildSystemdArgs, runFixed};
