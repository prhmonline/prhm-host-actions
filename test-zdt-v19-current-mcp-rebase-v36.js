'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

const FILE='./zdt-v19-current-mcp-rebase-v36.js';

test('binds the exact current RED V19 implementation to one reviewed MCP-only target',()=>{
  const m=require(FILE);
  assert.equal(m.ACTION,'control_plane_agent_zdt_v19_current_mcp_rebase_v36');
  assert.equal(m.CURRENT_IMPL_SHA,'875a20d869d4098308e39809d6cd3150b5974a9a070caa8f790e1845b2356c5e');
  assert.equal(m.TARGET_IMPL_SHA,'8d28b78a5ea1626cfd7f853bf31007e6404ceb78837a284d67a0c6dd39fd2c49');
  assert.deepEqual(m.REPLACEMENTS,[
    {
      old:'8f24b6ed70644c1eda7b255a47ccf0d4fabfe03ac7c73dd8799ff9aeb5294075',
      next:'103dfdf49f95794e84dfa40d97d1622aabb2efb7a373809010262def63fd00d8',
      label:'rahekomak_mcp_baseline'
    },
    {
      old:'0dc6889891749e8b81271819a9afed8ccbeacddc4526a893d363e8d6819ac4a0',
      next:'d2f8fee8c4c95d5f79b13d67c3188c3d8e3feb8f10f1202e1f6e810672963d15',
      label:'rahekomak_mcp_candidate'
    }
  ]);
  assert.equal(m.production_mutation,false);
  assert.equal(m.database_mutation,false);
  assert.equal(m.directadmin_mutation,false);
  assert.equal(m.imotion_runtime_mutation,false);
});

test('exports only a source transformer and no execution surface',()=>{
  const m=require(FILE);
  assert.equal(typeof m.patchImplementation,'function');
  assert.equal(m.patchImplementation.length,1);
  for(const forbidden of ['command','path','service','run','exec','spawn','apply','write','confirmation']){
    assert.equal(Object.hasOwn(m,forbidden),false);
  }
});

test('fails closed when the exact preimage is not supplied',()=>{
  const m=require(FILE);
  assert.throws(()=>m.patchImplementation('not-the-current-v19-source'),/v36_current_impl_sha_mismatch/);
});
