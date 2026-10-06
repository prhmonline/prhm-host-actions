'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const SURFACE=path.join(__dirname,'safeFiles-installer-refresh-l4-binding-repair-surface-current-v1.js');
const BUILDER=path.join(__dirname,'zdt-v19-compact-candidate-builder-current-v1.js');

test('current recovery surface candidate is present and pinned to reviewed SafeFiles',()=>{
  assert.equal(fs.existsSync(SURFACE),true,'current recovery surface candidate is missing');
  const m=require(SURFACE);
  assert.equal(m.schema_version,'prhm.installer-refresh-current-surface-binding.v1');
  assert.equal(m.source_ref,'fix/installer-refresh-l4-parent-bind-waha-v3');
  assert.equal(m.source_blob_sha,'712100af1473b76a229417888867b5b3275b67ec');
  assert.equal(m.BASE_SHA,'d5e938f63ef89c7427edad92cd047f1c150f898db5cbb6d1a84cbb6c1bac6161');
  assert.equal(m.CONFIRM,'CONFIRM_LEVEL_4_CRITICAL');
  assert.deepEqual(m.tools,[
    'control_plane_installer_refresh_l4_binding_repair_request_v1',
    'control_plane_installer_refresh_l4_binding_repair_status_v1',
    'control_plane_installer_refresh_l4_binding_repair_apply_v1'
  ]);
  assert.equal(m.level,4);
  assert.equal(m.risk,'critical');
  assert.equal(m.production_mutation,false);
  assert.equal(m.database_mutation,false);
});

test('current V19 builder candidate is present and pinned to GREEN 17/17 artifacts',()=>{
  assert.equal(fs.existsSync(BUILDER),true,'current V19 builder candidate is missing');
  const m=require(BUILDER);
  assert.equal(m.schema_version,'prhm.zdt-v19-current-builder-binding.v1');
  assert.equal(m.source_ref,'fix/agent-zdt-v19-compact-immutable-v1');
  assert.equal(m.source_blob_sha,'2baa256df515cc73c0126de32e9b862655be55d6');
  assert.equal(m.EXPECTED_IMPL,'875a20d869d4098308e39809d6cd3150b5974a9a070caa8f790e1845b2356c5e');
  assert.equal(m.EXPECTED_TEST,'f29d2d0596e5c432cb1024851cec74a2788d970a21457ebf554a3ee93ef47a0a');
  assert.equal(m.CONFIRM,'CONFIRM_LEVEL_4_CRITICAL');
  assert.equal(m.contract_tests,17);
  assert.equal(m.level,4);
  assert.equal(m.risk,'critical');
  assert.equal(m.production_mutation,false);
  assert.equal(m.database_mutation,false);
});

test('candidate modules expose metadata only and no execution surface',()=>{
  for(const file of [SURFACE,BUILDER]){
    if(!fs.existsSync(file)) continue;
    const m=require(file);
    for(const forbidden of ['command','path','service','run','exec','spawn','apply','write']){
      assert.equal(Object.hasOwn(m,forbidden),false);
    }
  }
});
