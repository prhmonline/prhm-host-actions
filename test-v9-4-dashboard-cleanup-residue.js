const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'company-os-dashboard-v1.js'),'utf8');
test('failure cleanup explicitly removes systemd-managed auth and snapshot files before directory cleanup',()=>{
 const m=s.match(/function cleanupInstall\(backupDir\)\{([\s\S]*?)\}\nfunction/);
 assert.ok(m,'cleanupInstall function not found');
 const c=m[1];
 assert.match(c,/rm\(AUTH_FILE\)/);
 assert.match(c,/rm\(SNAPSHOT\)/);
 assert.match(c,/rm\(CREDENTIALS\)/);
 assert.ok(c.indexOf('rm(AUTH_FILE)') < c.indexOf('rm(AUTH_DIR)'),'auth file must be removed before ConfigurationDirectory mountpoint');
 assert.ok(c.indexOf('rm(SNAPSHOT)') < c.indexOf("fs.readdirSync(STATE_DIR)"),'snapshot must be removed before empty-state check');
});
