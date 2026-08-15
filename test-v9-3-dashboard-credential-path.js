const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const helper=fs.readFileSync(path.join(__dirname,'company-os-dashboard-v1.js'),'utf8');
const bootstrap=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v9-company-os-dashboard.js'),'utf8');
test('dashboard credentials live in executor-owned action evidence, never /root',()=>{
 assert.match(helper,/CREDENTIALS=RESULT_DIR\+'\/credentials\.txt'/);
 assert.doesNotMatch(helper,/CREDENTIALS='\/root\//);
 assert.match(helper,/credentials_path:CREDENTIALS/);
 assert.match(helper,/0o600/);
});
test('v9.3 transient installer no longer grants /root write access',()=>{
 const m=bootstrap.match(/const APPLY_BLOCK=(\"(?:\\.|[^\"\\])*\");/);assert.ok(m);const candidate=JSON.parse(m[1]);
 assert.doesNotMatch(candidate,/ReadWritePaths=[^\n]*\s\/root(?:\s|$)/);
 assert.match(candidate,/ReadWritePaths=\/var\/lib\/prhm-agent-selfmaint-exec\/company-os-dashboard-v1 \/etc\/systemd\/system \/etc\/httpd\/conf\.d \/var\/backups/);
 assert.match(bootstrap,/1\.9\.3-host-actions-v2-company-os-dashboard-credentials/);
});
