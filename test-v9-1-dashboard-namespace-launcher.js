const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const helper=fs.readFileSync(path.join(__dirname,'company-os-dashboard-v1.js'),'utf8');
const bootstrap=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v9-company-os-dashboard.js'),'utf8');
test('namespace regression remains fixed without widening executor filesystem access',()=>{
  assert.doesNotMatch(helper,/APP_DIR='\/opt\/prhm-company-os-dashboard'/);
  assert.match(helper,/APP_DIR=STATE_DIR\+'\/app'/);
  assert.match(bootstrap,/StateDirectory=prhm-company-os-dashboard/);
  assert.match(bootstrap,/ConfigurationDirectory=prhm-company-os-dashboard/);
  assert.doesNotMatch(bootstrap,/COMPANY_OS_DASHBOARD_LAUNCH_DIRS/);
  assert.doesNotMatch(bootstrap,/ReadWritePaths=\/opt\/prhm-company-os-dashboard/);
});
test('future v9 bootstrap reloads Approval Center and identifies v9.2 launcher',()=>{
  assert.match(bootstrap,/prhm-company-approval\.service/);
  assert.match(bootstrap,/1\.9\.3-host-actions-v2-company-os-dashboard-credentials/);
});
