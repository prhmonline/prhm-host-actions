const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const helper=fs.readFileSync(path.join(__dirname,'company-os-dashboard-v1.js'),'utf8');
const bootstrap=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v9-company-os-dashboard.js'),'utf8');
test('dashboard persistent app lives under systemd StateDirectory, never /opt',()=>{
 assert.match(helper,/STATE_DIR='\/var\/lib\/prhm-company-os-dashboard'/);
 assert.match(helper,/APP_DIR=STATE_DIR\+'\/app'/);
 assert.match(helper,/RESULT_DIR='\/var\/lib\/prhm-agent-selfmaint-exec\/company-os-dashboard-v1'/);
 assert.match(helper,/RESULT_FILE=RESULT_DIR\+'\/latest\.json'/);
 assert.doesNotMatch(helper,/\/opt\/prhm-company-os-dashboard/);
 assert.match(helper,/managed_directory_not_empty/);
});
test('executor delegates directory creation to systemd before namespace setup',()=>{
 assert.match(bootstrap,/StateDirectory=prhm-company-os-dashboard/);
 assert.match(bootstrap,/StateDirectoryMode=0750/);
 assert.match(bootstrap,/ConfigurationDirectory=prhm-company-os-dashboard/);
 assert.match(bootstrap,/ConfigurationDirectoryMode=0750/);
 assert.doesNotMatch(bootstrap,/mkdirSync\(dir/);
 assert.doesNotMatch(bootstrap,/ReadWritePaths=\/opt\/prhm-company-os-dashboard/);
 assert.match(bootstrap,/1\.9\.3-host-actions-v2-company-os-dashboard-credentials/);
});
test('systemd-managed empty directories are reusable but business artifacts are not',()=>{
 assert.match(helper,/managedDir/);
 assert.match(helper,/dashboard_path_already_exists/);
 assert.match(helper,/WEB_UNIT/);assert.match(helper,/COLLECTOR_TIMER/);assert.match(helper,/CREDENTIALS/);
});
