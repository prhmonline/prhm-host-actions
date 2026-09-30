'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const bridge=require('./instant-delivery-mcp-candidate-refresh-bridge-v1.js');

const PREFLIGHT='instant_delivery_mcp_candidate_refresh_preflight_v1';
const APPLY='instant_delivery_mcp_candidate_refresh_apply_v1';
const CONFIRM='CONFIRM_LEVEL_4_CRITICAL';

test('exports only fixed bridge operations and immutable production bindings',()=>{
  assert.equal(bridge.PREFLIGHT_OPERATION,PREFLIGHT);
  assert.equal(bridge.APPLY_OPERATION,APPLY);
  assert.equal(bridge.CONFIRMATION,CONFIRM);
  assert.equal(bridge.CANDIDATE_SERVICE,'prhm-agent-mcp-instant-delivery-candidate.service');
  assert.equal(bridge.CANDIDATE_TARGET,'/home/agent/candidates/agent3-instant-delivery-v1/mcp/src/plugins/hostActionsV2.js');
  assert.equal(bridge.SOURCE_SHA256,'048e2db190c5548f47967447b3b564eefd0b7203cf6df84beb73c520d481633d');
  assert.equal(bridge.TARGET_PREIMAGE_SHA256,'b2f95b97dfa7e26ca717dfbec7871bf2f64286952548fb4d6d8e99908aeaacc0');
});

test('preflight accepts zero caller-controlled fields and apply requires exact Level-4 confirmation',async()=>{
  const calls=[];
  const dispatcher=bridge.createFixedDispatcher({
    run(mode){calls.push(mode);return {ok:true,mode}}
  },async command=>({fallback:command}));

  assert.deepEqual(await dispatcher.execute(JSON.stringify({operation:PREFLIGHT})),{ok:true,mode:'preflight',operation:PREFLIGHT});
  assert.deepEqual(calls,['preflight']);
  await assert.rejects(()=>dispatcher.execute(JSON.stringify({operation:PREFLIGHT,extra:true})),/unexpected control-plane field/);
  await assert.rejects(()=>dispatcher.execute(JSON.stringify({operation:APPLY})),/Level-4 confirmation required/);
  await assert.rejects(()=>dispatcher.execute(JSON.stringify({operation:APPLY,second_confirmation:'CONFIRM_LEVEL_3_PRODUCTION'})),/Level-4 confirmation required/);
  await assert.rejects(()=>dispatcher.execute(JSON.stringify({operation:APPLY,second_confirmation:CONFIRM,extra:true})),/unexpected control-plane field/);
  assert.deepEqual(await dispatcher.execute(JSON.stringify({operation:APPLY,second_confirmation:CONFIRM})),{ok:true,mode:'apply',operation:APPLY});
  assert.deepEqual(calls,['preflight','apply']);
});

test('unknown operations delegate byte-for-byte to the existing bridge',async()=>{
  const seen=[];
  const dispatcher=bridge.createFixedDispatcher({run(){throw new Error('must_not_run')}},async command=>{seen.push(command);return {delegated:true}});
  const raw=JSON.stringify({operation:'existing_operation',value:7});
  assert.deepEqual(await dispatcher.execute(raw),{delegated:true});
  assert.deepEqual(seen,[raw]);
});

test('production runner spec is fixed to one helper, one candidate and one service',()=>{
  const spec=bridge.productionSpec();
  assert.equal(spec.helper_sha256,bridge.HELPER_SHA256);
  assert.equal(spec.source_sha256,bridge.SOURCE_SHA256);
  assert.equal(spec.target_preimage_sha256,bridge.TARGET_PREIMAGE_SHA256);
  assert.equal(spec.candidate_target,bridge.CANDIDATE_TARGET);
  assert.equal(spec.candidate_service,bridge.CANDIDATE_SERVICE);
  assert.equal(spec.api_candidate_mutation,false);
  assert.equal(spec.router_mutation,false);
  assert.equal(spec.database_mutation,false);
  assert.equal(spec.production_application_mutation,false);
  assert.equal(Object.prototype.hasOwnProperty.call(spec,'command'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(spec,'path'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(spec,'service'),false);
});
