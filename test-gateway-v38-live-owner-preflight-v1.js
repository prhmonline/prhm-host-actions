'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const m=require('./gateway-v38-live-owner-preflight-v1.js');

test('pins all six current live owner preimages',()=>{
  assert.equal(m.SOURCE_MAIN_SHA,'858fba81f53be63c1257b637fb4a9ca39c7fb7a4');
  assert.deepEqual(Object.keys(m.OWNERS),['approval','executor','selfmaint','selfmaint_exec','policy','mcp']);
  assert.equal(m.OWNERS.approval.sha256,'de2569e481cd57b105b6a778cee7b32b2575fc88957d993c70760101ba39d13b');
  assert.equal(m.OWNERS.executor.sha256,'67b75873dbfe7c38b016d2c34ceca9792987f28d510c2f73e6c694c760df247f');
  assert.equal(m.OWNERS.selfmaint.sha256,'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406');
  assert.equal(m.OWNERS.selfmaint_exec.sha256,'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0');
  assert.equal(m.OWNERS.policy.sha256,'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174');
  assert.equal(m.OWNERS.mcp.sha256,'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166');
});

test('keeps Gateway v38 runtime names unselected/uninstalled',()=>{
  assert.deepEqual(m.FORBIDDEN_RUNTIME_MARKERS,[
    'universal_execution_gateway_execute_v1',
    'host_action_v2_autonomous_execute_v1',
    'autonomousEligible',
    'standing_grant',
    'standingGrant'
  ]);
  assert.equal(m.assertNoGatewayMarkers({approval:'legacy manual path',mcp:'host_action_v2_apply'}),true);
  assert.throws(()=>m.assertNoGatewayMarkers({approval:'x autonomousEligible y'}),/gateway_v38_marker_already_present:approval:autonomousEligible/);
});

test('owner validation is exact SHA fail-closed',()=>{
  const wrong=Buffer.from('not-the-live-owner','utf8');
  const got=crypto.createHash('sha256').update(wrong).digest('hex');
  assert.throws(()=>m.inspectOwnerBytes('approval',wrong),new RegExp('gateway_v38_owner_sha_mismatch:approval:'+got));
  assert.throws(()=>m.inspectOwnerBytes('missing',Buffer.alloc(0)),/gateway_v38_unknown_owner:missing/);
});

test('preflight module declares no production or database mutation',()=>{
  assert.equal(m.production_mutation,false);
  assert.equal(m.database_mutation,false);
  for(const k of ['apply','write','deploy','grant','command','path']) assert.equal(Object.hasOwn(m,k),false,k);
});
