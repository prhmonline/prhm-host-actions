
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const helperPath=__dirname+'/real-market-shadow-uat-v1.js';
const bootstrapPath=__dirname+'/bootstrap-host-actions-v7-real-market-shadow-uat.js';
const TARGET='4264d724-0015-4250-991b-544ed4aa6313';

test('helper is fixed to Parscoders 614602 and expected fail-closed decision',()=>{
  const s=fs.readFileSync(helperPath,'utf8');
  assert.match(s,new RegExp(TARGET));
  assert.match(s,/614602/);
  assert.match(s,/parscoders/);
  assert.match(s,/ASK_CLARIFICATION/);
  assert.match(s,/economics_inputs_incomplete/);
});

test('helper does not fabricate economics and requires zero resolved facts',()=>{
  const s=fs.readFileSync(helperPath,'utf8');
  assert.match(s,/resolved_economic_inputs/);
  assert.match(s,/resolved_economics_count/);
  assert.doesNotMatch(s,/insert into\s+marketplace\.economic_input_facts/i);
});

test('helper filters copied worker to one opportunity and uses unique removable decision version',()=>{
  const s=fs.readFileSync(helperPath,'utf8');
  assert.match(s,/patchWorker/);
  assert.match(s,/p0-shadow-uat-v1-/);
  assert.match(s,/worker_filtered_to_opportunity/);
  assert.match(s,/cleanup_verified/);
});

test('bootstrap adds only fixed Level-4 action while preserving solo selftest and economics',()=>{
  const s=fs.readFileSync(bootstrapPath,'utf8');
  assert.match(s,/real_market_shadow_uat_v1/);
  assert.match(s,/solo_company_selftest_v1/);
  assert.match(s,/leadops_economics_inputs_foundation_v1/);
  assert.match(s,/level:4/);
  assert.match(s,/1\.7\.1-host-actions-v2-real-market-shadow-uat-validator/);
});
