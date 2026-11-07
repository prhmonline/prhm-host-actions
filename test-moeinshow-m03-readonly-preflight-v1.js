'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const gate = require('./moeinshow-m03-readonly-preflight-v1.js');

test('production identity and M03 source SHA are pinned', () => {
  assert.equal(gate.TARGET.project, 'moeinshow_front_prod');
  assert.equal(gate.TARGET.root, '/home/moeinshow/domains/moeinshow.com/public_html');
  assert.equal(gate.TARGET.productionHead, '87c9cfbe0117ab5c102ba21e7a30fa83e9761d0d');
  assert.equal(gate.TARGET.sourceCommit, 'b9b03e6036703a3cb12fd83d895efa53b9b4faf4');
});
test('patch gate accepts only narrowly scoped M03 files', () => {
  assert.equal(gate.validatePatchPaths([
    'src/ui/layout/header/index.tsx',
    'src/ui/layout/header/style.module.scss',
    'src/clients/home/sectionSliderHome/style.scss',
    'src/app/layout.tsx'
  ]), true);
  for (const invalid of [
    ['src/app/seat-selection/[id]/page.tsx'],
    ['src/app/pay-info/page.tsx'],
    ['src/ui/layout/header/index.tsx', 'src/ui/layout/header/index.tsx'],
    ['../src/app/layout.tsx'], ['/etc/systemd/system/my.service'], [], null
  ]) assert.throws(() => gate.validatePatchPaths(invalid));
  assert.ok(gate.PATCH_PATHS.length <= 7);
});
test('systemd unit discovery ignores unrelated services and is deterministic', () => {
  const sample = `
  prhm-agent-mcp-blue.service loaded active running MCP Blue
  prhm-agent-api-green.service loaded active running API Green
  sshd.service loaded active running OpenSSH
  nginx.service loaded active running Nginx
  prhm-agent-mcp-blue.service loaded active running MCP Blue
`;
  assert.deepEqual(gate.parseAgentUnits(sample),
    ['prhm-agent-api-green.service', 'prhm-agent-mcp-blue.service']);
  assert.deepEqual(gate.parseAgentUnits(''), []);
});
test('properties are sanitized and root write scope is not overclaimed', () => {
  const u = gate.analyzeUnit('prhm-agent-api-green.service',
    'Id=prhm-agent-api-green.service\nActiveState=active\nProtectSystem=strict\nProtectHome=read-only\nReadWritePaths=/var/log /tmp\nEnvironment=SECRET=NEVER_SHOW\n');
  assert.equal(u.active, true);
  assert.equal(u.protect_system, 'strict');
  assert.equal(u.protect_home, 'read-only');
  assert.equal(u.declared_root_rw, false);
  assert.equal(u.write_test_performed, false);
  assert.equal('Environment' in u, false);
  const v = gate.analyzeUnit('prhm-agent-api-blue.service',
    'ActiveState=active\nReadWritePaths=/var/log /home/moeinshow/domains/moeinshow.com/public_html\n');
  assert.equal(v.declared_root_rw, true);
  assert.equal(v.write_test_performed, false);
  assert.throws(() => gate.analyzeUnit('../../test.service', 'ActiveState=active'));
});
test('relative paths or siblings do not qualify as writable project', () => {
  assert.equal(gate.coversRoot('/home/moeinshow/domains/moeinshow.com/public_html'), true);
  assert.equal(gate.coversRoot('/home/moeinshow/domains/moeinshow.com/public_html/src'), false);
  assert.equal(gate.coversRoot('/home/moeinshow/domains/other.com/public_html'), false);
  assert.equal(gate.coversRoot('public_html'), false);
  assert.equal(gate.coversRoot('/home/moeinshow/domains/moeinshow.com/public_html-other'), false);
});
test('implementation remains read-only and does not implement an unapproved mutation route', () => {
  const source = fs.readFileSync(path.join(__dirname, 'moeinshow-m03-readonly-preflight-v1.js'), 'utf8');
  for (const forbidden of [
    'writeFileSync', 'renameSync', 'chmodSync', 'chownSync', 'systemd-run',
    'git push', 'git reset', 'git checkout', 'git merge', 'git cherry-pick',
    'rm -rf', 'eval(', 'spawn(', 'execSync('
  ]) assert.equal(source.includes(forbidden), false, forbidden);
  assert.match(source, /release_authorized: false/);
  assert.match(source, /filesystem_write_verified: false/);
  assert.match(source, /--untracked-files=no/);
});
