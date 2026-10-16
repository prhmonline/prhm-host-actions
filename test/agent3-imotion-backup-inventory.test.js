'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const inventory=require('../config/agent3-imotion-backup-28-source-inventory.json');
test('iMotion production backup scope is explicitly frozen but not declared backed up',()=>{
 assert.equal(inventory.project_id,'imotion_admin_prod');
 assert.equal(inventory.state,'inventory_only_not_backed_up');
 assert.equal(inventory.expected_count,28);
 assert.equal(inventory.tracked_modified.length,14);
 assert.equal(inventory.untracked.length,14);
 assert.equal(inventory.files.length,28);
 assert.equal(new Set(inventory.files).size,28);
 assert.deepEqual(inventory.files,[...inventory.tracked_modified,...inventory.untracked]);
 for(const name of inventory.files){
  assert.equal(typeof name,'string');
  assert.ok(!name.startsWith('/')&&!name.includes('\\')&&!name.includes('\0'));
  assert.ok(name.split('/').every(part=>part&&part!=='.'&&part!=='..'));
 }
 assert.equal(typeof inventory.warning,'string');
});
