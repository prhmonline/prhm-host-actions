#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const b=require('./bootstrap-host-actions-deployhq-node1-recreate-v1.js');
const helper=fs.readFileSync(__dirname+'/deployhq-node1-canonical-recreate-v1.js');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');

test('registration identity and live baseline are exact',()=>{
 assert.equal(b.ACTION,'deployhq_node1_canonical_recreate_v1');
 assert.equal(b.OPERATION,'host_action.deployhq_node1_canonical_recreate_v1');
 assert.deepEqual(b.BASELINE,{base:'c38bb88c5d7000eebedc5db758c7dd7d846b7b1a6df589c10f37237c3d1cce00',executor:'c9b8b9b0a103783c60c43dede3334cf8775d25489cdc2a0fe97b5f406515ba3e',policy:'162bfa045d9b600a48989dd88e4b367beff1272cbb9b83e1dbc5cf6bc8d6adad',mcp:'c7be9c315319c893ee821268507577f10cb001440899f670659b2c3c7b26b722',zdt:'04a1416e837b1ae47e0a0ae72b5c1547d03118022c6c9ff19f392572ff7d38b4'});
});
test('helper template is byte-identical to Task4 helper',()=>{assert.equal(b.HELPER_TEMPLATE_SHA,sha(helper));assert.deepEqual(b.helperTemplate(),helper)});
test('base patch inserts exactly one typed action',()=>{
 const src="const A={\n  imotion_marketing_targets_register_v2: { operation: 'host_action.imotion_marketing_targets_register_v2', rollback: 'host-action-v2:imotion-marketing-targets-register-v2:source-restore' },\n  drtarjomeh_security_containment_v1: { operation: 'host_action.drtarjomeh_security_containment_v1' },\n};";
 const out=b.patchBase(src);assert.equal((out.match(/deployhq_node1_canonical_recreate_v1:/g)||[]).length,1);assert.match(out,/host_action\.deployhq_node1_canonical_recreate_v1/);
});
test('executor patch adds registry helper and dispatch without pending-status rewrite',()=>{
 const src="const R={\n  imotion_marketing_targets_register_v2:{operation:'host_action.imotion_marketing_targets_register_v2',kind:'imotion_marketing_targets_register_v2'},\n  drtarjomeh_security_containment_v1: { operation: 'host_action.drtarjomeh_security_containment_v1', kind: 'drtarjomeh_security_containment_v1' },\n};\nconst applyHostActionV2Original=applyHostActionV2;\napplyHostActionV2=async function(action){if(action==='agent_zdt_existing_topology_rolling_refresh_v1')return a();if(action==='imotion_marketing_targets_register_v2')return applyImotionMarketingTargetsRegisterV2();if(action==='imotion_marketing_target_register_v1')return applyImotionMarketingTargetRegisterV1();return applyHostActionV2Original(action);};";
 const out=b.patchExecutor(src);assert.match(out,/deployhq_node1_canonical_recreate_v1:\{operation:'host_action\.deployhq_node1_canonical_recreate_v1'/);assert.match(out,/applyDeployHQNode1CanonicalRecreateV1/);assert.match(out,/if\(action==='deployhq_node1_canonical_recreate_v1'\)/);assert.equal(out.includes('host_action_v2_request_expired'),false);
});
test('policy patch creates only level4 critical typed scope',()=>{
 const src=JSON.stringify({operations:{},typed_scopes:[]});const out=JSON.parse(b.patchPolicy(src));assert.deepEqual(out.operations['host_action.deployhq_node1_canonical_recreate_v1'],{level:4});const s=out.typed_scopes.find(x=>x.action==='deployhq_node1_canonical_recreate_v1');assert.equal(s.risk,'critical');assert.equal(s.environment,'production');assert.equal(s.tool,'host_action_v2_apply');
});
test('mcp patch extends enum once',()=>{const src="const HostActionV2=z.enum(['imotion_marketing_targets_register_v2','drtarjomeh_security_containment_v1']);";const out=b.patchMcp(src);assert.match(out,/'imotion_marketing_targets_register_v2','deployhq_node1_canonical_recreate_v1','drtarjomeh_security_containment_v1'/)});
test('zdt patch rebinds current base executor and mcp sha only',()=>{
 const src=[b.BASELINE.base,b.BASELINE.executor,b.BASELINE.mcp,b.BASELINE.zdt].join('\n');const hashes={base:'a'.repeat(64),executor:'b'.repeat(64),mcp:'c'.repeat(64)};const out=b.patchZdt(src,hashes);assert.match(out,/a{64}/);assert.match(out,/b{64}/);assert.match(out,/c{64}/);assert.match(out,new RegExp(b.BASELINE.zdt));assert.equal(out.includes(b.BASELINE.base),false);
});
test('paths are fixed and helper install is executor-owned',()=>{assert.equal(b.PATHS.helper,'/opt/prhm-agent-selfmaint-exec/actions/deployhq-node1-canonical-recreate-v1.js');assert.equal(b.PATHS.result,'/var/lib/prhm-agent-selfmaint-exec/deployhq-node1-canonical-recreate-v1/latest.json')});
