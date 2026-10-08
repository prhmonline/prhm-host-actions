'use strict';

const crypto=require('node:crypto');

const ACTION='control_plane_agent_zdt_v19_current_green_tooling_rebind_v1';
const SOURCE_COMMIT='405929393c6a6598f4cbd3a781fd65df6d2614cb';
const OLD_IMPL_SHA='414265bb89e61dcc0ff82cc4e24c526fd62f5c799db56c4238c936b5da8a3528';
const NEW_IMPL_SHA='9d0160917167a19038dcb3ffaaf7ed83638e0b124afffbb16962f6d27796e6fd';
const OLD_TEST_SHA='c939d971cd9b0bd1c48629ed6c3cfb55b8cfd5472616df38009831198f46ddfe';
const NEW_TEST_SHA='87eba07f79befccc7b47dd6a537ba9d4a0c4839da6ab40cdcbac797a8afa3722';

const production_mutation=false;
const database_mutation=false;
const directadmin_mutation=false;
const runtime_mutation=false;

function digest(source){
  return crypto.createHash('sha256').update(source,'utf8').digest('hex');
}
function count(source,needle){
  return source.split(needle).length-1;
}
function fail(code){throw new Error(code)}

function patchToolingSource(source){
  if(typeof source!=='string')fail('v19_tooling_source_invalid');

  const oi=count(source,OLD_IMPL_SHA);
  const ni=count(source,NEW_IMPL_SHA);
  const ot=count(source,OLD_TEST_SHA);
  const nt=count(source,NEW_TEST_SHA);

  if(oi===0&&ni===1&&ot===0&&nt===1){
    return Object.freeze({
      ok:true,
      action:ACTION,
      source_commit:SOURCE_COMMIT,
      already_rebound:true,
      replacement_count:0,
      old_sha256:digest(source),
      new_sha256:digest(source),
      content:source,
      production_mutation,
      database_mutation,
      directadmin_mutation,
      runtime_mutation
    });
  }

  if(oi!==1)fail('v19_tooling_old_impl_pin_state:'+oi);
  if(ni!==0)fail('v19_tooling_new_impl_pin_state:'+ni);
  if(ot!==1)fail('v19_tooling_old_test_pin_state:'+ot);
  if(nt!==0)fail('v19_tooling_new_test_pin_state:'+nt);

  const oldSha=digest(source);
  const content=source
    .replace(OLD_IMPL_SHA,NEW_IMPL_SHA)
    .replace(OLD_TEST_SHA,NEW_TEST_SHA);

  if(count(content,OLD_IMPL_SHA)!==0||count(content,NEW_IMPL_SHA)!==1)fail('v19_tooling_impl_postcondition');
  if(count(content,OLD_TEST_SHA)!==0||count(content,NEW_TEST_SHA)!==1)fail('v19_tooling_test_postcondition');

  return Object.freeze({
    ok:true,
    action:ACTION,
    source_commit:SOURCE_COMMIT,
    already_rebound:false,
    replacement_count:2,
    old_sha256:oldSha,
    new_sha256:digest(content),
    content,
    production_mutation,
    database_mutation,
    directadmin_mutation,
    runtime_mutation
  });
}

module.exports=Object.freeze({
  ACTION,
  SOURCE_COMMIT,
  OLD_IMPL_SHA,
  NEW_IMPL_SHA,
  OLD_TEST_SHA,
  NEW_TEST_SHA,
  patchToolingSource,
  production_mutation,
  database_mutation,
  directadmin_mutation,
  runtime_mutation
});
