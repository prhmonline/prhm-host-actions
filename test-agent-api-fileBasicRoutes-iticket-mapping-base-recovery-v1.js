'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const TARGET=path.join(__dirname,'agent-api-fileBasicRoutes-iticket-mapping-base-recovery-v1.js');

test('wrapper is fixed to exact fileBasicRoutes base SHA and official selfmaint backup root',()=>{
  const s=fs.readFileSync(TARGET,'utf8');
  assert.match(s,/1c261c486df729b959a63a9dc0c14f5bb730daca9d88f1ec685cc3b3dd106c16/);
  assert.match(s,/\/var\/backups\/prhm-agent-selfmaint/);
  assert.match(s,/agent_api-fileBasicRoutes\.js-/);
  assert.match(s,/iticket_mapping_diag_base_backup_missing/);
});

test('wrapper preserves exact helper pin transform and fail-closed checks',()=>{
  const s=fs.readFileSync(TARGET,'utf8');
  assert.match(s,/fef813dac1680653531c23bf9c9b1070a97d517bc90461844deaff97e69f4b80/);
  assert.match(s,/cf4326f4931e7965a576a54501f2e64d38ac3db6d7717f90d88d848dcb1dd0c7/);
  assert.match(s,/pin_anchor_mismatch/);
  assert.match(s,/pin_postcondition/);
  assert.doesNotMatch(s,/process\.argv/);
});
