const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const helper=path.join(__dirname,'company-os-dashboard-persian-v1.js');
const boot=path.join(__dirname,'bootstrap-host-actions-v11-company-os-dashboard-persian.js');

test('v11 helper is fixed SHA-bound dashboard-only update with temp collector preflight and rollback',()=>{
  const s=fs.readFileSync(helper,'utf8');
  for(const x of ['company_os_dashboard_persian_v1','300438578d8c87d2be2247f6e08fa4a28a968b856aba803be43f4467ee5a00d6','95c68f2d4e99b918f79ec4922cdc45c9b526bc2f6999a264c0790e366dffb34c','a2e23b6108e427a72a3b092460af9a50dc8a954e386c1f5caa779bb9d2d0ea6c','f77b81c2e15647e61531b799370073675d345ca7ca57f2c148828b8fd305305d','01b684c5d305ca00fde5fa223f0545d34ee109bd1ac49ad20b6ab812c78fc72b','b2d0fe6ded54f57b7e1b51de42b88d6ff18c2a79eccc9c5b8d40d255e0a585e1','0a386ae24fbc0a513ab7eb48e000297aaa1b470e7557058dea840d31303fc1f7','661dcfa380471af64bb50334a3ea92cc9e8421ddf3d494a99448477fc4ddba0f']) assert.match(s,new RegExp(x));
  assert.match(s,/--preflight-only/);assert.match(s,/snapshot\.v2/);assert.match(s,/temporary|temp/i);assert.match(s,/backup/i);assert.match(s,/rollback/i);
  assert.match(s,/database_mutation:false/);assert.match(s,/business_mutation:false/);assert.match(s,/proposal_send:false/);assert.match(s,/bid_send:false/);assert.match(s,/p0_live:false/);
  assert.doesNotMatch(s,/execSync\([^)]*rm -rf/);
});

test('v11 bootstrap registers a fresh critical Level-4 action without changing existing action names',()=>{
  const s=fs.readFileSync(boot,'utf8');
  for(const x of ['company_os_dashboard_persian_v1','host_action.company_os_dashboard_persian_v1','1.11.0-host-actions-v2-company-os-dashboard-persian','2026-08-16.1-company-os-dashboard-persian-v1']) assert.match(s,new RegExp(x.replaceAll('.','\\.')));
  for(const existing of ['company_os_dashboard_v1','company_os_dashboard_credentials_reset_v1']) assert.match(s,new RegExp(existing));
  assert.match(s,/level:4/);assert.match(s,/risk:'critical'/);assert.match(s,/--preflight-only/);assert.match(s,/rollback/);
});
