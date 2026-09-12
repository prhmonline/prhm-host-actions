'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = __dirname;
const files = [
  'imotion-db-writability-guard',
  'imotion-db-readonly-window',
  'imotion-db-writability-guard.service',
  'imotion-db-writability-guard.timer',
  'imotion-db-forensics.rules'
];
const destinations = [
  '/usr/local/sbin/imotion-db-writability-guard',
  '/usr/local/sbin/imotion-db-readonly-window',
  '/etc/systemd/system/imotion-db-writability-guard.service',
  '/etc/systemd/system/imotion-db-writability-guard.timer',
  '/etc/audit/rules.d/imotion-db-forensics.rules'
];
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

test('all five canonical payloads and manifest exist', () => {
  for (const f of files) assert.equal(fs.existsSync(path.join(ROOT, f)), true, `missing ${f}`);
  assert.equal(fs.existsSync(path.join(ROOT, 'manifest.json')), true, 'missing manifest');
});

test('guard contract is fail-closed and never enables read-only', () => {
  const s = fs.readFileSync(path.join(ROOT, 'imotion-db-writability-guard'), 'utf8');
  assert.match(s, /EXPECTED_SERVER_ID="1"/);
  assert.match(s, /GRACE_SECONDS=10/);
  assert.match(s, /imotion-db-readonly-authorized/);
  assert.match(s, /SHOW SLAVE STATUS/);
  assert.match(s, /SET GLOBAL read_only=OFF/);
  assert.doesNotMatch(s, /SET GLOBAL read_only=ON/);
});

test('maintenance wrapper creates lease before ON and restores on signals', () => {
  const s = fs.readFileSync(path.join(ROOT, 'imotion-db-readonly-window'), 'utf8');
  assert.match(s, /TTL_MUST_BE_30_TO_3600/);
  assert.match(s, /trap cleanup EXIT ERR INT TERM HUP/);
  assert.match(s, /SET GLOBAL read_only=ON/);
  assert.match(s, /SET GLOBAL read_only=OFF/);
  assert.ok(s.indexOf('cat >"$LEASE"') < s.indexOf("dbq 'SET GLOBAL read_only=ON;'"), 'lease must exist before ON');
});

test('systemd and audit payloads are fixed', () => {
  const service = fs.readFileSync(path.join(ROOT, 'imotion-db-writability-guard.service'), 'utf8');
  const timer = fs.readFileSync(path.join(ROOT, 'imotion-db-writability-guard.timer'), 'utf8');
  const audit = fs.readFileSync(path.join(ROOT, 'imotion-db-forensics.rules'), 'utf8');
  assert.match(service, /ExecStart=\/usr\/local\/sbin\/imotion-db-writability-guard/);
  assert.match(timer, /OnBootSec=30s/);
  assert.match(timer, /OnUnitActiveSec=30s/);
  assert.match(audit, /arch=b64/);
  assert.match(audit, /arch=b32/);
  assert.match(audit, /exe=\/usr\/bin\/docker/);
  assert.match(audit, /auid=0/);
  assert.match(audit, /imotion-db-docker-root/);
});

test('manifest binds exact destinations and exact payload SHA256', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(m.schema_version, 'prhm.imotion-db-readonly-guard-manifest.v1');
  assert.equal(m.payloads.length, 5);
  assert.deepEqual(m.payloads.map(x => x.destination), destinations);
  for (const p of m.payloads) {
    const bytes = fs.readFileSync(path.join(ROOT, p.source));
    assert.equal(p.sha256, sha(bytes), `sha mismatch ${p.source}`);
    assert.match(p.sha256, /^[a-f0-9]{64}$/);
  }
});
