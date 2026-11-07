'use strict';
// Issue #246 / M03. Read-only diagnostic; NOT a deployer, writer, or approval.
const cp = require('node:child_process');
const path = require('node:path');

const TARGET = Object.freeze({
  project: 'moeinshow_front_prod',
  root: '/home/moeinshow/domains/moeinshow.com/public_html',
  productionHead: '87c9cfbe0117ab5c102ba21e7a30fa83e9761d0d',
  sourceCommit: 'b9b03e6036703a3cb12fd83d895efa53b9b4faf4'
});
const PATCH_PATHS = Object.freeze([
  'src/app/layout.tsx',
  'src/components/GoftinoWidget.tsx',
  'src/clients/home/sectionSliderHome/index.tsx',
  'src/clients/home/sectionSliderHome/style.scss',
  'src/ui/assets/styles/globals.scss',
  'src/ui/layout/header/index.tsx',
  'src/ui/layout/header/style.module.scss'
]);

function validatePatchPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > PATCH_PATHS.length) {
    throw new Error('m03_invalid_patch_size');
  }
  if (new Set(paths).size !== paths.length) throw new Error('m03_duplicate_patch_path');
  for (const item of paths) {
    if (typeof item !== 'string' || !PATCH_PATHS.includes(item)) {
      throw new Error('m03_patch_path_not_allowlisted');
    }
  }
  return true;
}
function parseAgentUnits(text) {
  const services = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z0-9_.@-]+\.service)\s/);
    if (!match) continue;
    const name = match[1];
    if (/^(?:prhm[-.]|ssh-agent[-.])/.test(name) && /(agent|mcp|api)/i.test(name)) {
      services.add(name);
    }
  }
  return [...services].sort().slice(0, 16);
}
function parseUnitProperties(text) {
  const allowed = new Set(['Id','ActiveState','SubState','ProtectSystem','ProtectHome','ReadWritePaths']);
  const obj = {};
  for (const line of String(text).split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index);
    if (allowed.has(key)) obj[key] = line.slice(index + 1);
  }
  return obj;
}
function coversRoot(writePath, targetRoot = TARGET.root) {
  if (typeof writePath !== 'string') return false;
  const raw = writePath.startsWith('-') ? writePath.slice(1) : writePath;
  if (!path.posix.isAbsolute(raw)) return false;
  const normalized = path.posix.normalize(raw);
  // A path outside ROOT is reported as a broad allowance, not automatically authorized.
  const relative = path.posix.relative(normalized, targetRoot);
  return relative === '' || (relative !== '..' && !relative.startsWith('../') && !path.posix.isAbsolute(relative));
}
function analyzeUnit(unit, properties) {
  if (!/^[A-Za-z0-9_.@-]+\.service$/.test(unit)) throw new Error('m03_invalid_service_name');
  const props = parseUnitProperties(properties);
  const rw = String(props.ReadWritePaths || '').trim().split(/\s+/).filter(Boolean);
  return {
    unit,
    active: props.ActiveState === 'active',
    protect_system: props.ProtectSystem || 'unknown',
    protect_home: props.ProtectHome || 'unknown',
    declared_root_rw: rw.some(p => coversRoot(p)),
    // Read-only inspection does not prove actual filesystem writability.
    write_test_performed: false
  };
}
function runReadOnly(binary, args) {
  return cp.execFileSync(binary, args, {
    encoding: 'utf8', timeout: 12000, maxBuffer: 160000,
    stdio: ['ignore','pipe','pipe']
  }).trim();
}
function runPreflight() {
  const report = {
    schema: 'prhm.moeinshow.m03.readonly-preflight.v1',
    project: TARGET.project,
    expected_production_sha: TARGET.productionHead,
    source_sha: TARGET.sourceCommit,
    read_only: true,
    production_mutation: false,
    release_authorized: false,
    filesystem_write_verified: false
  };
  try {
    const branch = runReadOnly('/usr/bin/git', ['-C', TARGET.root, 'branch', '--show-current']);
    const head = runReadOnly('/usr/bin/git', ['-C', TARGET.root, 'rev-parse', 'HEAD']);
    const dirty = runReadOnly('/usr/bin/git', ['-C', TARGET.root, 'status', '--porcelain=v1', '--untracked-files=no']);
    report.git = {
      branch, head,
      pinned: branch === 'main' && head === TARGET.productionHead,
      tracked_clean: dirty === ''
    };
    const rawUnits = runReadOnly('/usr/bin/systemctl',
      ['list-units', '--type=service', '--state=running', '--no-legend', '--no-pager']);
    const candidates = parseAgentUnits(rawUnits);
    report.units = candidates.map(unit => {
      const raw = runReadOnly('/usr/bin/systemctl', ['show', unit,
        '-p', 'Id', '-p', 'ActiveState', '-p', 'ProtectSystem',
        '-p', 'ProtectHome', '-p', 'ReadWritePaths']);
      return analyzeUnit(unit, raw);
    });
    report.gate = !report.git.pinned ? 'production_sha_or_branch_drift'
      : !report.git.tracked_clean ? 'production_tracked_files_dirty'
      : report.units.length === 0 ? 'active_agent_unit_not_discovered'
      : 'requires_signed_host_action_and_isolated_write_test';
    report.ok = Boolean(report.git.pinned && report.git.tracked_clean && report.units.length);
  } catch (e) {
    report.ok = false;
    report.gate = 'read_only_preflight_failed';
    // Never expose raw stderr, environment or service secrets.
    report.error_class = e && e.code ? String(e.code).slice(0, 40) : 'execution_error';
  }
  return report;
}
if (require.main === module) {
  const output = runPreflight();
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  if (!output.ok) process.exitCode = 1;
}
module.exports = {
  TARGET, PATCH_PATHS, validatePatchPaths, parseAgentUnits,
  parseUnitProperties, coversRoot, analyzeUnit, runPreflight
};
