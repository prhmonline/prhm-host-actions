'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const script=path.join(__dirname,'central-offsite-postrun-sha-release-v1.js');

function call(...args){return cp.spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:15000});}
test('release script refuses to run without explicit subcommand',()=>{
  const x=call();assert.equal(x.status,2);assert.match(x.stderr,/USAGE/);
});
test('release script refuses missing Level4 confirmation before any mutation',()=>{
  const x=call('--apply','a'.repeat(40),'NO');
  assert.equal(x.status,2);assert.match(x.stderr,/LEVEL4_CONFIRMATION_REQUIRED/);
});
test('release script refuses malformed commit even with confirmation',()=>{
  const x=call('--apply','invalid','CONFIRM_LEVEL_4_CRITICAL');
  assert.equal(x.status,2);assert.match(x.stderr,/EXACT_COMMIT_SHA_REQUIRED/);
});
test('release script has fixed target, service and rollback without database operations',()=>{
  const s=fs.readFileSync(script,'utf8');
  assert.match(s,/const SERVICE='prhm-agent-selfmaint-exec.service'/);
  assert.match(s,/const backup=TARGET\+'/);
  assert.match(s,/fs\.renameSync\(restoreTmp,TARGET\)/);
  assert.match(s,/PINNED_COMMIT_MISMATCH/);
  assert.match(s,/fs\.copyFileSync\(TARGET,backup,fs\.constants\.COPYFILE_EXCL\)/);
  assert.doesNotMatch(s,/docker\s+exec|DELETE\s+FROM|DROP\s+TABLE|rm\s+-rf/);
});
