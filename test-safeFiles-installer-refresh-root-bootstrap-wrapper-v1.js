'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const FILE=path.join(__dirname,'safeFiles-installer-refresh-root-bootstrap-wrapper-v1.mjs');

test('wrapper is pinned to the exact current safeFiles preimage and fixed installer tools',()=>{
  const s=fs.readFileSync(FILE,'utf8');
  assert.match(s,/BASE_SHA='3db499a8bc020403626a6c8a133237a5f086e7c936d6cd7ccdbadd74dd894155'/);
  assert.match(s,/control_plane_installer_refresh_l4_binding_repair_request_v1/);
  assert.match(s,/control_plane_installer_refresh_l4_binding_repair_apply_v1/);
  assert.match(s,/CONFIRM_LEVEL_4_CRITICAL/);
});

test('request bootstrap writes only fixed state root through existing parent',()=>{
  const s=fs.readFileSync(FILE,'utf8');
  assert.match(s,/STATE_PARENT='\/var\/lib\/prhm-agent-selfmaint-exec'/);
  assert.match(s,/STATE_ROOT=STATE_PARENT\+'\/installer-refresh-l4-binding-repair-v1'/);
  assert.match(s,/ReadWritePaths=/);
  assert.match(s,/\/usr\/bin\/mkdir/);
  assert.doesNotMatch(s,/callerPath|destinationPath|req\.body|process\.argv/);
});

test('apply bootstrap adds only fixed backup parent/root and delegates original handler',()=>{
  const s=fs.readFileSync(FILE,'utf8');
  assert.match(s,/BACKUP_PARENT='\/var\/backups'/);
  assert.match(s,/BACKUP_ROOT=BACKUP_PARENT\+'\/prhm-installer-refresh-l4-binding-repair-v1'/);
  assert.match(s,/return requestHandler\(args\)/);
  assert.match(s,/return applyHandler\(args\)/);
  assert.doesNotMatch(s,/approval_token|CONFIRM_LEVEL_3_PRODUCTION|risk:'high'/);
});
