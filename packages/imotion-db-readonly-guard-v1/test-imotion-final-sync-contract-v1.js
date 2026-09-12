'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const BINDING = path.join(ROOT, 'final-sync-binding.json');
const HELPER = path.join(ROOT, 'imotion-directadmin-final-sync-v1.js');
const PROGRAM = path.join(ROOT, 'imotion-directadmin-final-sync-program-v1.sh');

const LEGACY_RESUME_SHA = 'f227a5ee6d7f2267c65989ba323767bacdb5fa54af8d7662b7e690d70de24774';

test('legacy cutover provenance is SHA-bound and explicitly rejected', () => {
  const binding = JSON.parse(fs.readFileSync(BINDING, 'utf8'));
  assert.equal(binding.schema_version, 'prhm.imotion-final-sync-binding.v1');
  assert.equal(binding.status, 'legacy_rejected_replacement_required');
  assert.equal(binding.production_source.private_ip, '10.71.0.118');
  assert.equal(binding.desired_directadmin_target, '10.71.0.10');
  const resume = binding.legacy_programs.find(x => x.path === '/root/imotion-level4-cutover-resume-v2.sh');
  assert.ok(resume, 'resume-v2 provenance missing');
  assert.equal(resume.sha256, LEGACY_RESUME_SHA);
  assert.equal(resume.accepted_for_v1, false);
  assert.equal(binding.root_cause_evidence.direct_readonly_on, true);
  assert.equal(binding.root_cause_evidence.success_path_disables_rollback_trap, true);
});

test('Git-owned final-sync helper and program exist', () => {
  assert.equal(fs.existsSync(HELPER), true, 'final-sync Host Action helper missing');
  assert.equal(fs.existsSync(PROGRAM), true, 'Git-owned final-sync program missing');
});

test('final-sync program cannot directly enable MariaDB read_only', () => {
  const source = fs.readFileSync(PROGRAM, 'utf8');
  assert.doesNotMatch(source, /SET\s+GLOBAL\s+read_only\s*=\s*(ON|1)/i);
  assert.match(source, /imotion-db-readonly-window/);
  assert.match(source, /directadmin-final-cutover/);
});

test('Host Action surface is fixed-input and Level-4 oriented', () => {
  const h = require(HELPER);
  assert.equal(h.ACTION, 'imotion_directadmin_final_sync_v1');
  assert.equal(h.NODE1, 'server-185-191-76-138');
  assert.equal(h.SOURCE, '10.71.0.118');
  assert.equal(h.TARGET, '10.71.0.10');
  assert.equal(h.ARBITRARY_COMMAND_INPUT, false);
  assert.equal(h.ARBITRARY_SQL_INPUT, false);
  assert.equal(h.ARBITRARY_HOST_INPUT, false);
  assert.equal(h.LEVEL, 4);
});

test('final-sync helper rejects the unsafe legacy resume program', () => {
  const source = fs.readFileSync(HELPER, 'utf8');
  assert.match(source, /f227a5ee6d7f2267c65989ba323767bacdb5fa54af8d7662b7e690d70de24774/);
  assert.match(source, /legacy.*reject|reject.*legacy/is);
});

test('target gates occur before any production read-only window', () => {
  const source = fs.readFileSync(PROGRAM, 'utf8');
  const targetGate = source.indexOf('TARGET_PREFLIGHT=PASS');
  const wrapper = source.indexOf('imotion-db-readonly-window');
  assert.ok(targetGate >= 0, 'target preflight marker missing');
  assert.ok(wrapper > targetGate, 'wrapper must not start before target gate');
});
