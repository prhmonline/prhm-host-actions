
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('future v8 installer reloads Approval Center after policy change',()=>{
  const s=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v8-verified-economics-replay.js'),'utf8');
  assert.match(s,/prhm-company-approval\.service/);
  assert.match(s,/18133\/health/);
  assert.match(s,/prhm-company-registry\.service/);
  assert.match(s,/nsenter/);
  assert.match(s,/2026-08-15\.3-verified-economics-replay-v1/);
});

test('v8.1 remediation is post-v8 state-bound and approval-reload-only',()=>{
  const s=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v8-1-approval-policy-reload.js'),'utf8');
  for(const sha of [
    '5d8c42b5032c766832822097fe73905ae34097f697e7232fed6b333d54c9dbbd',
    '97a0a438c12a0158d3386cf345c5579a6517be558c6093113efa2086729e4c8d',
    '7c94467843b084f7970945c3251d6e03b6528ba10ac5c973c10861f41cba41f4',
    'afae32985861cb8b9396f4cea4b05e1c68b90a6ad55937b27c8fcf7dc84321df',
    'ff5eca545227742d6fd0d4e1d920a083b1d1569943df51c859739ab347f3db55'
  ]) assert.match(s,new RegExp(sha));
  assert.match(s,/--preflight-only/);
  assert.match(s,/systemctl.*restart.*prhm-company-approval\.service/s);
  assert.match(s,/const POLICY_VERSION='2026-08-15\.3-verified-economics-replay-v1'/);
  assert.match(s,/x\.policy_version===POLICY_VERSION/);
  assert.match(s,/prhm-company-registry\.service/);
  assert.match(s,/nsenter/);
  assert.match(s,/18133\/health/);
  assert.doesNotMatch(s,/writeFileSync\([^)]*approval-policy\.json/);
  assert.match(s,/database_mutation:false/);
  assert.match(s,/business_mutation:false/);
});
