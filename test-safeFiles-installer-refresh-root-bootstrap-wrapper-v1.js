'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const FILE=path.join(__dirname,'safeFiles-installer-refresh-root-bootstrap-wrapper-v1.mjs');

test('wrapper is pinned to the exact current WAHA safeFiles preimage and fixed installer tools',()=>{
  const s=fs.readFileSync(FILE,'utf8');
  assert.match(s,/BASE_SHA='41416010bd28f7eb38c57d5e0482a56d782c0f8fca42a961a8480e6f0c88a6d5'/);
  assert.match(s,/control_plane_installer_refresh_l4_binding_repair_request_v1/);
  assert.match(s,/control_plane_installer_refresh_l4_binding_repair_apply_v1/);
  assert.match(s,/CONFIRM_LEVEL_4_CRITICAL/);
  assert.match(s,/return target\.registerTool\.call\(target,name,config,handler\)/);
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
  assert.match(s,/REPAIR_BACKUP_ROOT=BACKUP_PARENT\+'\/prhm-installer-refresh-l4-binding-repair-v1'/);
  assert.match(s,/return requestHandler\(args\)/);
  assert.match(s,/return applyHandler\(args\)/);
  assert.doesNotMatch(s,/approval_token|CONFIRM_LEVEL_3_PRODUCTION|risk:'high'/);
});
