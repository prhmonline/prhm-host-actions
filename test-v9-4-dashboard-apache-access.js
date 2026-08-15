const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'company-os-dashboard-v1.js'),'utf8');
test('app directories are explicitly apache-traversable despite installer UMask 0077',()=>{
  assert.match(s,/function apacheIdentity\(/);
  assert.match(s,/function ensureApacheDir\(/);
  assert.match(s,/fs\.chmodSync\(dir,0o750\)/);
  assert.match(s,/fs\.chownSync\(dir,0,apache\.gid\)/);
  assert.doesNotMatch(s,/mkdirSync\(APP_DIR\+'\/public',\{recursive:true,mode:0o755\}\);for/);
});
test('helper performs an apache-identity pre-start readability check on server.js',()=>{
  assert.match(s,/function verifyApacheAppAccess\(/);
  assert.match(s,/uid:apache\.uid,gid:apache\.gid/);
  assert.match(s,/NODE,\['--check',APP_DIR\+'\/server\.js'\]/);
  assert.match(s,/apache_server_access_failed/);
  const access=s.indexOf('verifyApacheAppAccess()');
  const units=s.indexOf('writeUnits()');
  assert.ok(access>0 && units>access,'apache access check must run before unit creation');
});
