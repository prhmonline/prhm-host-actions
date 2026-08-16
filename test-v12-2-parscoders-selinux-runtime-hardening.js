const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const helper=fs.readFileSync('leadops-parscoders-runtime-v3-restore-v1.js','utf8');

test('v12.2 uses exact-path persistent SELinux mappings only',()=>{
  assert.match(helper,/\/usr\/sbin\/semanage/);
  assert.match(helper,/\/usr\/sbin\/restorecon/);
  assert.match(helper,/bin_t/);
  assert.match(helper,/COLLECTOR/);
  assert.match(helper,/SCORER/);
  assert.doesNotMatch(helper,/setenforce/);
  assert.doesNotMatch(helper,/\bchcon\b/);
  assert.doesNotMatch(helper,/audit2allow/);
  assert.doesNotMatch(helper,/runtime-v3\/\.\*/);
});

test('v12.2 validation is systemd-originated and rollback-only',()=>{
  assert.match(helper,/systemd-run/);
  assert.match(helper,/PARSCODERS_VALIDATE_ONLY/);
  assert.match(helper,/NoNewPrivileges/);
  assert.match(helper,/ProtectHome/);
  assert.match(helper,/ProtectSystem/);
  assert.doesNotMatch(helper,/run\('\/usr\/sbin\/runuser',\['-u','drtarjomeh','--',COLLECTOR\]/);
});

test('v12.2 records and rolls back mappings created by this action',()=>{
  assert.match(helper,/created/);
  assert.match(helper,/rollbackFcontext/);
  assert.match(helper,/restorecon/);
});


test('canonical v12 bootstrap embeds the v12.2 helper byte-for-byte',()=>{
  const bootstrap=fs.readFileSync('bootstrap-host-actions-v12-parscoders-runtime-v3-restore.js','utf8');
  const m=bootstrap.match(/const HELPER_B64='([^']+)'/);
  assert.ok(m,'HELPER_B64 missing');
  assert.deepEqual(Buffer.from(m[1],'base64'),Buffer.from(helper));
});

test('v12.2 permanent helper exposes a non-mutating installed-state preflight',()=>{
  assert.match(helper,/--installed-state-preflight-only/);
  assert.match(helper,/installedStatePreflight/);
  assert.match(helper,/rolePrivilegeState/);
  assert.match(helper,/assertNoBroadRuntimeFcontext/);
});
