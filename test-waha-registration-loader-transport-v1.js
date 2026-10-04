'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const FILE='waha-registration-loader-transport-v1.mjs';
const src=fs.readFileSync(FILE,'utf8');
const lit=n=>{const m=src.match(new RegExp(`const ${n}='([^']+)'`));assert.ok(m,`missing ${n}`);return m[1]};

test('transport pins current safeFiles base and reviewed loader',()=>{
  assert.equal(lit('BASE_SHA'),'fdcceca36c46c5b0f45d8c6376c74260d8ceb88a0b791f7b379189c9eeb9217a');
  assert.equal(lit('LOADER_SHA'),'a08c2da3dd7effd5a75b5e75c484bc9148e7cae4c88449e9b67f4cac3d2ac1ec');
  assert.match(src,/const LOADER_BYTES=17560/);
  assert.match(src,/const CHUNK_SIZES=Object\.freeze\(\[3000,3000,3000,3000,3000,2560\]\)/);
});

test('transport exposes only fixed stage status chunk and critical apply',()=>{
  assert.equal(lit('STATUS'),'waha_registration_loader_transport_status_v1');
  assert.equal(lit('CHUNK'),'waha_registration_loader_transport_chunk_v1');
  assert.equal(lit('APPLY'),'waha_registration_loader_transport_apply_v1');
  assert.equal(lit('CONFIRM'),'CONFIRM_LEVEL_4_CRITICAL');
  assert.match(src,/sequence:z\.number\(\)\.int\(\)\.min\(0\)\.max\(5\)/);
  assert.match(src,/chunk_base64:z\.string\(\)\.min\(4\)\.max\(5000\)/);
  assert.match(src,/inputSchema:\{second_confirmation:z\.literal\(CONFIRM\)\}/);
});

test('caller cannot select a path command url host mode or destination',()=>{
  assert.doesNotMatch(src,/args\.(path|command|url|host|mode|destination|target|sha)/);
  assert.doesNotMatch(src,/node:(http|https|net|tls|dns)|fetch\(|process\.env/);
  assert.doesNotMatch(src,/child_process.*exec\b/);
});

test('chunk transport is canonical fixed-shape and final-SHA fail closed',()=>{
  assert.match(src,/buf\.toString\('base64'\)!==b64/);
  assert.match(src,/buf\.length!==CHUNK_SIZES\[sequence\]/);
  assert.match(src,/received!==LOADER_BYTES/);
  assert.match(src,/sha\(fs\.readFileSync\(PAYLOAD\)\)!==LOADER_SHA/);
  assert.match(src,/function withLock\(/);
});

test('apply is fixed sandboxed atomic replacement with rollback and no service control',()=>{
  assert.match(src,/systemd-run/);
  assert.match(src,/RestrictAddressFamilies=AF_UNIX/);
  assert.match(src,/ReadWritePaths=\/home\/agent\/ssh-mcp-server\/src\/plugins/);
  assert.match(src,/ReadWritePaths=\/var\/backups\/prhm-waha-registration-loader-transport-v1/);
  assert.match(src,/preflightSyntax/);
  assert.match(src,/rollback_performed/);
  assert.match(src,/reload_required:'agent_zdt_existing_topology_rolling_refresh_v1'/);
  assert.doesNotMatch(src,/systemctl|restart|reload|docker|compose/);
});

test('overlay preserves exact current SafeFiles implementation via backup materialization',()=>{
  assert.match(src,/PREFIX='agent_mcp-src_plugins_safeFiles\.js-'/);
  assert.match(src,/SUFFIX='-'\+BASE_SHA\+'\.bak'/);
  assert.match(src,/typeof base\.registerSafeFilesPlugin!=='function'/);
  assert.match(src,/const result=base\.registerSafeFilesPlugin\(mcp,context\)/);
});
