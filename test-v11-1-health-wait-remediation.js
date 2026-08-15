const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('v11.1 remediation is helper-only, exact-state-bound, preflightable and rollback-capable',()=>{
  const s=fs.readFileSync('remediate-company-os-v11-1-health-wait.js','utf8');
  for(const x of [
    '70892ea43d29564590642f8292ccef8dc57b3973d6e93608de6770033e68a41b',
    '69314da58060402799814c4276a6f588fed82da20316ede6c528bfedd3a7b52f',
    '40b493f3a828c7bb00d707917e6f3e05f72bb2083d3af1075b25a4f77db3d0a3',
    '18b2158b1f8840e39c4953d8b8ee8a56b74f966edd7ae75415f7c04617b298e1',
    '--preflight-only','rollback','changed_files'
  ]) assert.match(s,new RegExp(x.replaceAll('.','\\.')));
  assert.match(s,/company-os-dashboard-persian-v1\.js/);
  assert.doesNotMatch(s,/systemctl.*restart/);
});
