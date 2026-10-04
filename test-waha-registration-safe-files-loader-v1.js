'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const zlib=require('node:zlib');

const loader=fs.readFileSync('waha-registration-safe-files-loader-v1.mjs','utf8');
const reviewed=fs.readFileSync('waha-student-bridge-registration-surface-v1.mjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const literal=name=>{
  const m=loader.match(new RegExp(`const ${name}='([^']+)'`));
  assert.ok(m,`missing ${name}`);
  return m[1];
};

test('loader carries the exact reviewed merged surface',()=>{
  assert.equal(literal('SURFACE_SHA'),'49f3ff18e33a16b02082f8a44679de545181f781d331fbebb797f088f9173663');
  assert.equal(sha(reviewed),literal('SURFACE_SHA'));
  const decoded=zlib.gunzipSync(Buffer.from(literal('SURFACE_GZ_B64'),'base64'));
  assert.equal(sha(decoded),literal('SURFACE_SHA'));
  assert.deepEqual(decoded,reviewed);
});

test('loader materializes only into fixed temporary path',()=>{
  assert.match(loader,/const SURFACE='\/tmp\/prhm-waha-registration-safe-files-surface-'\+SURFACE_SHA\+'\.mjs';/);
  assert.match(loader,/flag:'wx'/);
  assert.match(loader,/mode:0o600/);
  assert.match(loader,/waha_registration_loader_surface_sha_mismatch/);
  assert.match(loader,/waha_registration_loader_postwrite_sha_mismatch/);
});

test('loader has no network, shell, or caller-controlled execution surface',()=>{
  assert.doesNotMatch(loader,/node:(https|http|net|tls|child_process)|fetch\(|spawn|exec(File|Sync)?\(|curl|wget/);
  assert.doesNotMatch(loader,/process\.argv|process\.env|req\.body|args\.(command|path|url|mode|host)/);
});

test('loader delegates only SafeFiles registration export',()=>{
  assert.match(loader,/typeof surface\.registerSafeFilesPlugin!=='function'/);
  assert.match(loader,/export function registerSafeFilesPlugin\(mcp,context\)\{return surface\.registerSafeFilesPlugin\(mcp,context\)\}/);
});
