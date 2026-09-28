'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const builder=require('./build-v29-drtarjomeh-root-bootstrap.js');

const EXPECTED=Object.freeze([
  'bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js',
  'drtarjomeh-security-release-v29-helper-builder.js',
  'install-host-actions-v29-drtarjomeh-security-release.js',
]);

test('root bootstrap embeds only the three reviewed v29 modules',()=>{
  assert.deepEqual([...builder.SOURCE_FILES],EXPECTED);
  const sourceCommit='0123456789abcdef0123456789abcdef01234567';
  const built=builder.buildLauncher({sourceCommit,readFile:file=>fs.readFileSync(file)});
  assert.equal(built.sourceCommit,sourceCommit);
  assert.deepEqual(Object.keys(built.moduleSha256).sort(),[...EXPECTED].sort());
  assert.match(built.source,/PRHM_DRTARJOMEH_V29_ROOT_BOOTSTRAP_V1/);
  assert.match(built.source,new RegExp(sourceCommit));
  for(const file of EXPECTED)assert.match(built.source,new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(built.source,/https?:\/\//i);
  assert.doesNotMatch(built.source,/child_process[^\n]*exec\s*\(/i);
});

test('launcher is syntax-valid and accepts only no args or --preflight-only',()=>{
  const built=builder.buildLauncher({sourceCommit:'fedcba9876543210fedcba9876543210fedcba98',readFile:file=>fs.readFileSync(file)});
  new vm.Script(built.source,{filename:'drtarjomeh-v29-root-bootstrap.js'});
  assert.match(built.source,/unexpected_arguments/);
  assert.match(built.source,/--preflight-only/);
  assert.match(built.source,/spawnSync\(NODE_BIN,\[installer/);
});

test('builder rejects an invalid source commit',()=>{
  assert.throws(()=>builder.buildLauncher({sourceCommit:'main',readFile:file=>fs.readFileSync(file)}),/source_commit_invalid/);
});
