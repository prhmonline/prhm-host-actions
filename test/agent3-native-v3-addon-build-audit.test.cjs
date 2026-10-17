'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const audit=require('../ops/agent3-universal-backup/native-v3-addon-binary-build-audit.cjs');
const cli=path.resolve(__dirname,
 '../ops/agent3-universal-backup/native-v3-addon-binary-build-audit.cjs');
test('source-only native binary audit is strictly CI-only and never applies',()=>{
 const r=cp.spawnSync(process.execPath,[cli,'--apply'],{
  timeout:10000,encoding:'utf8'
 });
 assert.equal(r.status,64);
 assert.match(r.stderr,/strict --ci mode only/);
 assert.equal(r.stdout,'');
});
test('audit hashes bytes and only exposes fixed C compiler hardening flags',()=>{
 assert.equal(audit.sha(Buffer.from('test')),
  '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
 for(const flag of ['-fstack-protector-strong','-D_FORTIFY_SOURCE=2',
  '-Wl,-z,relro','-Wl,-z,now','-Wall','-Wextra','-Werror']){
  assert.ok(audit.flags.includes(flag),flag);
 }
 assert.equal(Object.isFrozen(audit.flags),true);
 const source=fs.readFileSync(path.resolve(__dirname,
  '../ops/agent3-universal-backup/native-linux-so-peercred-addon.c'),'utf8');
 assert.match(source,/SO_PEERCRED/);
 assert.match(source,/SO_ACCEPTCONN/);
 assert.match(source,/getpeername/);
});
