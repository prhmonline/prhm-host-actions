'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const FILE='waha-student-bridge-registration-surface-v37.mjs';
const src=fs.readFileSync(FILE,'utf8');
const literal=name=>{
  const m=src.match(new RegExp(`const ${name}='([^']+)'`));
  assert.ok(m,`missing ${name}`);
  return m[1];
};

test('surface pins exact base and v37 state helper SHAs',()=>{
  assert.equal(literal('BASE_SHA'),'fdcceca36c46c5b0f45d8c6376c74260d8ceb88a0b791f7b379189c9eeb9217a');
  assert.equal(literal('CURRENT_STATE_SHA'),'b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e');
  assert.equal(literal('TARGET_STATE_SHA'),'b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb');
});

test('surface performs only the exact reviewed state-script rewrite',()=>{
  assert.match(src,/function patchInstallerRefreshState\(bytes\)/);
  assert.match(src,/sha\(bytes\)!==BASE_SHA/);
  assert.match(src,/sha\(Buffer\.from\(current,'utf8'\)\)!==CURRENT_STATE_SHA/);
  assert.match(src,/current\.split\(CURRENT_TMP_EXPR\)\.length-1/);
  assert.match(src,/current\.replace\(CURRENT_TMP_EXPR,TARGET_TMP_EXPR\)/);
  assert.match(src,/sha\(Buffer\.from\(target,'utf8'\)\)!==TARGET_STATE_SHA/);
  assert.match(src,/return patchInstallerRefreshState\(bytes\)/);
});

test('patched base is materialized atomically without modifying backup source',()=>{
  assert.match(src,/const expected=sha\(bytes\)/);
  assert.match(src,/mode:0o600,flag:'wx'/);
  assert.match(src,/fs\.renameSync\(tmp,BASE\)/);
  assert.match(src,/v37_materialized_base_sha_mismatch/);
  assert.doesNotMatch(src,/writeFileSync\(path\.join\(BACK/);
  assert.doesNotMatch(src,/renameSync\([^,]+,\s*path\.join\(BACK/);
});

test('surface imports only the patched local base and preserves fixed WAHA tools',()=>{
  assert.match(src,/const PATCHED_BASE_SHA=ensureBase\(\)/);
  assert.match(src,/waha-registration-v37='\+PATCHED_BASE_SHA/);
  assert.equal(literal('PREFLIGHT'),'waha_student_bridge_registration_preflight_v1');
  assert.equal(literal('APPLY'),'waha_student_bridge_registration_apply_v1');
  assert.equal(literal('CONFIRM'),'CONFIRM_LEVEL_4_CRITICAL');
});

test('surface accepts no caller-selected path command host or mode',()=>{
  assert.doesNotMatch(src,/caller(Content|Path|Command|Mode|Host|Url|URL|Session)/);
  assert.doesNotMatch(src,/args\.(command|path|host|url|mode|session)/);
  assert.doesNotMatch(src,/process\.env\.(TARGET|PATH_OVERRIDE|COMMAND|HOST)/);
});
