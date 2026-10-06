'use strict';

const ACTION='control_plane_installer_refresh_current_binding_rebind_v1';
const CONFIRM='CONFIRM_LEVEL_4_CRITICAL';

const OLD_SAFEFILES_SHA='41416010bd28f7eb38c57d5e0482a56d782c0f8fca42a961a8480e6f0c88a6d5';
const LIVE_SAFEFILES_SHA='d5e938f63ef89c7427edad92cd047f1c150f898db5cbb6d1a84cbb6c1bac6161';

const OLD_V19_IMPL_SHA='3eefb2281cd850208b0dff6d69f0211d54efa566b89b440d99da79a560c812dd';
const CURRENT_V19_IMPL_SHA='875a20d869d4098308e39809d6cd3150b5974a9a070caa8f790e1845b2356c5e';

const OLD_V19_TEST_SHA='fbbd56bd5decfc9a714f03cfff4b571e2fd36a9e130ac12c4a63f586156987e8';
const CURRENT_V19_TEST_SHA='f29d2d0596e5c432cb1024851cec74a2788d970a21457ebf554a3ee93ef47a0a';

function fail(message){throw new Error(message);}
function count(source,needle){return source.split(needle).length-1;}

function patchSurface(source){
  if(typeof source!=='string')fail('surface_source_invalid');
  if(source.includes(LIVE_SAFEFILES_SHA))fail('surface_already_current');

  const old="const BASE_SHA='"+OLD_SAFEFILES_SHA+"';";
  const next="const BASE_SHA='"+LIVE_SAFEFILES_SHA+"';";
  const n=count(source,old);
  if(n!==1)fail('surface_base_anchor_count:'+n);

  const content=source.replace(old,next);
  if(content.includes(OLD_SAFEFILES_SHA))fail('surface_old_sha_remains');
  if(count(content,LIVE_SAFEFILES_SHA)!==1)fail('surface_current_sha_postcondition');
  if(!content.includes(CONFIRM))fail('surface_level4_confirmation_missing');
  if(content.includes('CONFIRM_LEVEL_3_PRODUCTION'))fail('surface_level3_downgrade_present');

  for(const name of [
    'control_plane_installer_refresh_l4_binding_repair_request_v1',
    'control_plane_installer_refresh_l4_binding_repair_status_v1',
    'control_plane_installer_refresh_l4_binding_repair_apply_v1'
  ]) if(!content.includes(name))fail('surface_binding_missing:'+name);

  return Object.freeze({
    ok:true,
    action:ACTION,
    kind:'surface',
    replacement_count:1,
    old_sha256:OLD_SAFEFILES_SHA,
    new_sha256:LIVE_SAFEFILES_SHA,
    confirmation:CONFIRM,
    content,
    production_mutation:false,
    database_mutation:false
  });
}

function patchBuilder(source){
  if(typeof source!=='string')fail('builder_source_invalid');
  if(source.includes(CURRENT_V19_IMPL_SHA)||source.includes(CURRENT_V19_TEST_SHA))
    fail('builder_already_current');

  const oldImpl="const EXPECTED_IMPL='"+OLD_V19_IMPL_SHA+"';";
  const newImpl="const EXPECTED_IMPL='"+CURRENT_V19_IMPL_SHA+"';";
  const oldTest="const EXPECTED_TEST='"+OLD_V19_TEST_SHA+"';";
  const newTest="const EXPECTED_TEST='"+CURRENT_V19_TEST_SHA+"';";

  const implCount=count(source,oldImpl);
  if(implCount!==1)fail('builder_impl_anchor_count:'+implCount);
  const testCount=count(source,oldTest);
  if(testCount!==1)fail('builder_test_anchor_count:'+testCount);

  let content=source.replace(oldImpl,newImpl);
  content=content.replace(oldTest,newTest);

  if(content.includes(OLD_V19_IMPL_SHA)||content.includes(OLD_V19_TEST_SHA))
    fail('builder_old_sha_remains');
  if(count(content,CURRENT_V19_IMPL_SHA)!==1)fail('builder_impl_postcondition');
  if(count(content,CURRENT_V19_TEST_SHA)!==1)fail('builder_test_postcondition');
  if(content.includes('CONFIRM_LEVEL_3_PRODUCTION'))fail('builder_level3_downgrade_present');

  return Object.freeze({
    ok:true,
    action:ACTION,
    kind:'builder',
    replacement_count:2,
    old_sha256:Object.freeze({impl:OLD_V19_IMPL_SHA,test:OLD_V19_TEST_SHA}),
    new_sha256:Object.freeze({impl:CURRENT_V19_IMPL_SHA,test:CURRENT_V19_TEST_SHA}),
    confirmation:CONFIRM,
    content,
    production_mutation:false,
    database_mutation:false
  });
}

module.exports=Object.freeze({
  ACTION,
  CONFIRM,
  OLD_SAFEFILES_SHA,
  LIVE_SAFEFILES_SHA,
  OLD_V19_IMPL_SHA,
  CURRENT_V19_IMPL_SHA,
  OLD_V19_TEST_SHA,
  CURRENT_V19_TEST_SHA,
  patchSurface,
  patchBuilder
});
