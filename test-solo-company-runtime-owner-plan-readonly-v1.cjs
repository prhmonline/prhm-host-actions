'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const t=require('./solo-company-runtime-owner-plan-readonly-v1.cjs');

test('trusted planning uses exactly two fixed review directories',()=>{
  assert.equal(t.HOST,'/var/tmp/solo-runtime-registration-review-20261103');
  assert.equal(t.SSH,'/var/tmp/solo-runtime-sshagent-review-20261103');
  assert.equal(new Set(t.SOURCE_FILES).size,t.SOURCE_FILES.length);
  assert.ok(t.SOURCE_FILES.includes('solo-company-runtime-owner-root-admission-v1.cjs'));
});
test('owner plan is read-only, no silent default root registration',()=>{
  const cmd=path.join(__dirname,'solo-company-runtime-owner-plan-readonly-v1.cjs');
  for(const args of [[],['--apply'],['--install'],['--owner-receipt','fake']]){
    const r=cp.spawnSync(process.execPath,[cmd,...args],{encoding:'utf8'});
    assert.equal(r.status,2);
    assert.match(r.stderr,/OWNER_PLAN_FAILED=.*read_only_only/);
    assert.equal(r.stdout,'');
  }
});
