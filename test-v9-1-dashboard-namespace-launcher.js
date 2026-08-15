const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const helper=fs.readFileSync(path.join(__dirname,'company-os-dashboard-v1.js'),'utf8');
const bootstrap=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v9-company-os-dashboard.js'),'utf8');
test('helper accepts only exact empty pre-created launcher directories',()=>{
  assert.match(helper,/launcher_directory_missing/);
  assert.match(helper,/launcher_directory_not_empty/);
  assert.match(helper,/\[APP_DIR,AUTH_DIR,STATE_DIR,RESULT_DIR\]/);
  assert.match(helper,/chownSync\(AUTH_DIR,0,48\)/);
});
test('executor pre-creates exact write paths before systemd-run and cleans launch failures',()=>{
  for(const p of ['/opt/prhm-company-os-dashboard','/etc/prhm-company-os-dashboard','/var/lib/prhm-company-os-dashboard','/var/lib/prhm-agent-selfmaint-exec/company-os-dashboard-v1'])assert.match(bootstrap,new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(bootstrap,/mkdirSync/);
  assert.match(bootstrap,/launcherDirs/);
  assert.match(bootstrap,/cleanupCompanyOsDashboardLauncherDirs/);
  assert.match(bootstrap,/catch\(error\)/);
  assert.match(bootstrap,/1\.9\.1-host-actions-v2-company-os-dashboard-launcher/);
  assert.match(bootstrap,/prhm-company-approval\.service/);
});
