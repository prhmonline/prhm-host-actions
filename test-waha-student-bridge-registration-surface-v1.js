'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const zlib=require('node:zlib');

const FILE='waha-student-bridge-registration-surface-v1.mjs';
const src=fs.readFileSync(FILE,'utf8');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const literal=name=>{
  const m=src.match(new RegExp(`const ${name}='([^']+)'`));
  assert.ok(m,`missing ${name}`);
  return m[1];
};

test('surface binds the exact live SafeFiles preimage and reviewed artifacts',()=>{
  assert.equal(literal('BASE_SHA'),'fdcceca36c46c5b0f45d8c6376c74260d8ceb88a0b791f7b379189c9eeb9217a');
  assert.equal(literal('REG_SHA'),'35041977d41d349c7fcaa10f9116d39d7c6f6fcbfe158838b49ab64be93e154d');
  assert.equal(literal('WORKER_SHA'),'9907f6df0a34151a6068c2c046b39b6943c6d816ff21520352e5a658c7523e96');
  assert.equal(sha(zlib.gunzipSync(Buffer.from(literal('REG_GZ_B64'),'base64'))),literal('REG_SHA'));
  assert.equal(sha(zlib.gunzipSync(Buffer.from(literal('WORKER_GZ_B64'),'base64'))),literal('WORKER_SHA'));
});

test('surface exposes exactly fixed registration preflight/apply tools',()=>{
  assert.equal(literal('PREFLIGHT'),'waha_student_bridge_registration_preflight_v1');
  assert.equal(literal('APPLY'),'waha_student_bridge_registration_apply_v1');
  assert.equal(literal('CONFIRM'),'CONFIRM_LEVEL_4_CRITICAL');
  assert.match(src,/inputSchema:\{\}/);
  assert.match(src,/inputSchema:\{second_confirmation:z\.literal\(CONFIRM\)\}/);
  assert.doesNotMatch(src,/caller(Content|Path|Command|Mode|Host|Url|URL|Session)/);
  assert.doesNotMatch(src,/req\.body|args\.(command|path|host|url|mode|session)|process\.env\.WAHA_/);
});

test('preflight artifact cache is temporary and sandbox sees it read-only',()=>{
  assert.equal(literal('STATE'),'/tmp/prhm-waha-student-bridge-registration-surface-v1');
  assert.doesNotMatch(src,/\/var\/lib\/prhm-agent-selfmaint-exec\/waha-student-bridge-registration-surface-v1/);
  assert.match(src,/PrivateTmp=true/);
  assert.match(src,/BindReadOnlyPaths='\+STATE|BindReadOnlyPaths='\s*\+\s*STATE|BindReadOnlyPaths='\+STATE/);
  assert.match(src,/function cleanupArtifacts\(\)/);
  assert.match(src,/finally\{cleanupArtifacts\(\)\}/);
});

test('apply sandbox has bounded writable paths and no network family',()=>{
  const paths=[
    '/opt/prhm-agent-selfmaint',
    '/opt/prhm-agent-selfmaint-exec',
    '/opt/prhm-company-control-plane/config',
    '/home/agent/ssh-mcp-server/src/plugins',
    '/var/backups',
  ];
  for(const p of paths) assert.match(src,new RegExp(`ReadWritePaths=${p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`));
  assert.equal((src.match(/ReadWritePaths=/g)||[]).length,paths.length);
  assert.match(src,/RestrictAddressFamilies=AF_UNIX/);
  assert.doesNotMatch(src,/AF_INET|AF_INET6|\/etc\/systemd\/system/);
});

test('registration modes are fixed and surface cannot select another mode',()=>{
  assert.match(src,/runRegistration\('--preflight-only'\)/);
  assert.match(src,/runRegistration\('--apply'\)/);
  assert.doesNotMatch(src,/runRegistration\(args|runRegistration\(req|mode:z\.|mode:\s*z\./);
});

test('surface validates fail-closed registration invariants',()=>{
  assert.match(src,/out\.schema_version!=='prhm\.waha-student-bridge-registration\.v1'/);
  assert.match(src,/out\.database_mutation!==false/);
  assert.match(src,/out\.service_control!==false/);
  assert.match(src,/out\.requires_zdt_refresh!==true/);
  assert.match(src,/apply&&out\.installed!==true/);
  assert.match(src,/!apply&&out\.preflight_only!==true/);
});
