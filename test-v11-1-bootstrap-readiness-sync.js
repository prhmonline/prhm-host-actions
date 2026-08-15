const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('v11 bootstrap embeds the fixed readiness helper and cannot reinstall the single-shot helper',()=>{
  const s=fs.readFileSync('bootstrap-host-actions-v11-company-os-dashboard-persian.js','utf8');
  assert.match(s,/69314da58060402799814c4276a6f588fed82da20316ede6c528bfedd3a7b52f/);
  assert.doesNotMatch(s,/const HELPER_SHA='70892ea43d29564590642f8292ccef8dc57b3973d6e93608de6770033e68a41b'/);
});
