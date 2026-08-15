const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const src=fs.readFileSync(__dirname+'/bootstrap-host-actions-v5-leadops-economics-foundation.js','utf8');

test('future v5 install patches base self-maintenance Host Action v2 allowlist',()=>{
  assert.match(src,/base:\s*'\/opt\/prhm-agent-selfmaint\/server\.js'/);
  assert.match(src,/function patchBase\(src\)/);
  assert.match(src,/leadops_economics_inputs_foundation_v1[^\n]+host_action\.leadops_economics_inputs_foundation_v1/);
  assert.match(src,/candidate\s*=\s*\{[\s\S]*base:patchBase\(original\.base\)/);
});

test('future v5 install restarts and health-verifies base self-maintenance',()=>{
  assert.match(src,/systemctl\(\['restart','prhm-agent-selfmaint\.service'\]\)/);
  assert.match(src,/unixHealth\('\/run\/prhm-agent-selfmaint\/selfmaint\.sock'\)/);
  assert.match(src,/1\.0\.0-l4-fail-closed/);
});
