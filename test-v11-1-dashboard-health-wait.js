const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('v11.1 dashboard helper waits for loopback auth readiness instead of single-shot curl',()=>{
  const s=fs.readFileSync('company-os-dashboard-persian-v1.js','utf8');
  assert.match(s,/waitUnauth401|unauthCode/);
  assert.match(s,/for\s*\(let\s+i=0;\s*i<\d+;\s*i\+\+\)/);
  assert.match(s,/spawnSync\('\/usr\/bin\/curl'/);
  assert.match(s,/Atomics\.wait|setTimeout|sleep/);
  assert.match(s,/dashboard_auth_guard_timeout/);
});
