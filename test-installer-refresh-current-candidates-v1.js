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
  assert.equal(m.BASE_SHA,'41416010bd28f7eb38c57d5e0482a56d782c0f8fca42a961a8480e6f0c88a6d5');
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
  assert.equal(m.EXPECTED_IMPL,'3eefb2281cd850208b0dff6d69f0211d54efa566b89b440d99da79a560c812dd');
  assert.equal(m.EXPECTED_TEST,'fbbd56bd5decfc9a714f03cfff4b571e2fd36a9e130ac12c4a63f586156987e8');
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
