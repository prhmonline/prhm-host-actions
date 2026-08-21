'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { patchExecutorSource }=require('./bootstrap-host-actions-v17-1-drtarjomeh-containment-dispatcher-repair.js');

const HELPER="async function applyDrTarjomehSecurityContainmentV1() { return {ok:true}; }";
const SPEC="  drtarjomeh_security_containment_v1: { operation: 'host_action.drtarjomeh_security_containment_v1', kind: 'drtarjomeh_security_containment_v1' },";
const ANCHOR="applyHostActionV2=async function(action){if(action==='agent_zdt_existing_topology_rolling_refresh_v1')return applyAgentZdtExistingTopologyRollingApplyV1();if(action==='imotion_marketing_target_register_v1')return applyImotionMarketingTargetRegisterV1();return applyHostActionV2Original(action);};";
const ROUTE="if(action==='drtarjomeh_security_containment_v1')return applyDrTarjomehSecurityContainmentV1();";
function fixture(){ return ['const ACTION_SPECS={',SPEC,'};',HELPER,'const applyHostActionV2Original=applyHostActionV2;',ANCHOR,''].join('\n'); }

test('adds exactly one DrTarjomeh containment route without changing action spec or helper',()=>{
  const src=fixture();
  const out=patchExecutorSource(src);
  assert.equal((out.match(new RegExp(ROUTE.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))||[]).length,1);
  assert.equal((out.match(/drtarjomeh_security_containment_v1: \{ operation: 'host_action\.drtarjomeh_security_containment_v1', kind: 'drtarjomeh_security_containment_v1' \}/g)||[]).length,1);
  assert.equal((out.match(/async function applyDrTarjomehSecurityContainmentV1\(\)/g)||[]).length,1);
});

test('fails closed if dispatcher route already exists',()=>{
  const src=fixture().replace("if(action==='imotion_marketing_target_register_v1')",ROUTE+"if(action==='imotion_marketing_target_register_v1')");
  assert.throws(()=>patchExecutorSource(src),/route_already_present/);
});

test('fails closed if helper or action spec invariant is missing',()=>{
  assert.throws(()=>patchExecutorSource(fixture().replace(HELPER,'')),/helper_count:0/);
  assert.throws(()=>patchExecutorSource(fixture().replace(SPEC,'')),/action_spec_count:0/);
});
