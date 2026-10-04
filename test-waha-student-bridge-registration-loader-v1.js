'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const zlib=require('node:zlib');

const FILE='waha-student-bridge-registration-loader-v1.mjs';
const src=fs.readFileSync(FILE,'utf8');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const literal=name=>{
  const m=src.match(new RegExp(`const ${name}='([^']+)'`));
  assert.ok(m,`missing ${name}`);
  return m[1];
};
const numberLiteral=name=>{
  const m=src.match(new RegExp(`const ${name}=(\\d+)`));
  assert.ok(m,`missing ${name}`);
  return Number(m[1]);
};

test('loader embeds exactly the reviewed registration surface',()=>{
  assert.equal(literal('SURFACE_SHA'),'49f3ff18e33a16b02082f8a44679de545181f781d331fbebb797f088f9173663');
  assert.equal(numberLiteral('SURFACE_BYTES'),18598);
  const decoded=zlib.gunzipSync(Buffer.from(literal('SURFACE_GZ_B64'),'base64'));
  assert.equal(decoded.length,numberLiteral('SURFACE_BYTES'));
  assert.equal(sha(decoded),literal('SURFACE_SHA'));
});

test('loader has only fixed local materialization and no caller-selected source',()=>{
  assert.equal(literal('STATE'),'/tmp/prhm-waha-student-bridge-registration-loader-v1');
  assert.equal(literal('SURFACE_FILE'),'waha-student-bridge-registration-surface-v1.mjs');
  assert.doesNotMatch(src,/node:(child_process|http|https|net|tls|dns)/);
  assert.doesNotMatch(src,/fetch\(|https?:\/\/|process\.env|caller(Content|Path|Command|Mode|Host|Url|URL)|req\.|args\./);
});

test('loader validates SHA before importing and writes atomically with restrictive modes',()=>{
  assert.match(src,/gunzipSync\(Buffer\.from\(SURFACE_GZ_B64,'base64'\)\)/);
  assert.match(src,/decoded\.length!==SURFACE_BYTES/);
  assert.match(src,/sha\(decoded\)!==SURFACE_SHA/);
  assert.match(src,/mode:0o600,flag:'wx'/);
  assert.match(src,/fs\.renameSync\(tmp,SURFACE\)/);
  assert.match(src,/fs\.chmodSync\(STATE,0o700\)/);
  assert.match(src,/sha\(fs\.readFileSync\(SURFACE\)\)===SURFACE_SHA/);
});

test('loader exposes only the SafeFiles plugin export and delegates to the pinned surface',()=>{
  assert.match(src,/const surface=await import\(pathToFileURL\(SURFACE\)\.href\+'\?sha='\+SURFACE_SHA\)/);
  assert.match(src,/typeof surface\.registerSafeFilesPlugin!=='function'/);
  assert.match(src,/export function registerSafeFilesPlugin\(mcp,context\)/);
  assert.match(src,/return surface\.registerSafeFilesPlugin\(mcp,context\)/);
  assert.doesNotMatch(src,/registerTool\(/);
});

test('loader is materially smaller than the reviewed surface source',()=>{
  assert.ok(Buffer.byteLength(src,'utf8')<18000,`loader too large: ${Buffer.byteLength(src,'utf8')}`);
});
