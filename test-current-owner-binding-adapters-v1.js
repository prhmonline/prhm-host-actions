'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {INITIAL_CONSUMER_PREIMAGES}=require('./current-owner-binding-manifest-v1.js');
const a=require('./current-owner-binding-adapters-v1.js');

const owners={
  registry_base:'e91c3062539353a7a9d097b0877f1e612051e4fe8a489c101edab3e56d268c9b',
  rolling_refresh:'d80fca8d7c74c6f6ab7f03c72a866a16c1de3fc547e421eb507e309321048a2a',
  agent_api:'1111111111111111111111111111111111111111111111111111111111111111',
  selfmaint_base:'2222222222222222222222222222222222222222222222222222222222222222',
  selfmaint_executor:'3333333333333333333333333333333333333333333333333333333333333333',
  approval_policy:'4444444444444444444444444444444444444444444444444444444444444444',
  mcp_host_actions:'5555555555555555555555555555555555555555555555555555555555555555',
  mcp_source:'6666666666666666666666666666666666666666666666666666666666666666',
};
function manifest(suffix='a'){return {schema_version:'prhm.current-owner-binding-manifest.v1',manifest_sha256:suffix.repeat(64).slice(0,64),owners:Object.entries(owners).map(([id,sha256])=>({id,sha256,path:'/fixed/'+id}))};}
function input(id,bytes,m=manifest()){return {manifest:m,target_path:INITIAL_CONSUMER_PREIMAGES[id].target_path,before_sha256:INITIAL_CONSUMER_PREIMAGES[id].sha256,before_bytes:Buffer.from(bytes)};}
const fixtures={
 registry_bridge:"import path from 'node:path';\nconst HERE='/fixed';\nconst BASE_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';\nconst BASE=path.join(HERE,'.registry-imotion-vm-stable-base-'+BASE_SHA+'.mjs');\nexport default BASE;\n",
 v19_binding:"#!/usr/bin/env bash\nset -euo pipefail\nOLD_API_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'\nNEW_API_SHA='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'\n",
 rolling_refresh:"'use strict';\nconst PATHS={apiSource:'/home/agent/ssh-agent-api/server.js',mcpSource:'/home/agent/ssh-mcp-server/server.js'};\nconst EXPECTED_SHA=Object.freeze({\n  [PATHS.apiSource]:'84774a93942e2d0df03c1acbd18fefc9556ea74d15ff5564f11ada27771b0d9f',\n  [PATHS.mcpSource]:'831c872f80917eb976bbdb9fa320f74528542656720e02df12c82508b149d185'\n});\nmodule.exports={EXPECTED_SHA};\n",

};

test('fixed registry exposes exactly three Config Center consumers and no generic adapter inputs',()=>{
 assert.deepEqual(Object.keys(a.ADAPTERS),['registry_bridge','v19_binding','rolling_refresh']);
 assert.equal(Object.isFrozen(a.ADAPTERS),true);
 assert.throws(()=>a.buildConsumerCandidate('other',{}),/consumer_unknown/);
 assert.equal(JSON.stringify(Object.keys(a)).includes('replace'),false);
});

test('migration candidates use manifest logical owners and are deterministic',()=>{
 for(const id of Object.keys(fixtures)){
   const one=a.buildConsumerCandidate(id,input(id,fixtures[id]));
   const two=a.buildConsumerCandidate(id,input(id,fixtures[id]));
   assert.equal(one.state,'migration',id);
   assert.equal(one.target_path,INITIAL_CONSUMER_PREIMAGES[id].target_path,id);
   assert.equal(one.after_sha256,two.after_sha256,id);
   assert.deepEqual(one.after_bytes,two.after_bytes,id);
   assert.match(one.after_bytes.toString(),/PRHM_CURRENT_OWNER_BINDING_V1/,id);
   assert.deepEqual(one.restart_units,[],id);
 }
});

test('registry and rolling candidates derive bindings from manifest owner ids',()=>{
 const r=a.buildRegistryBridgeCandidate(input('registry_bridge',fixtures.registry_bridge)).after_bytes.toString();
 assert.match(r,/CURRENT_OWNER_BINDING_REGISTRY_BRIDGE\.owners\.registry_base/);
 assert.match(r,new RegExp(owners.registry_base));
 const z=a.buildRollingRefreshCandidate(input('rolling_refresh',fixtures.rolling_refresh)).after_bytes.toString();
 assert.match(z,/\[PATHS\.apiSource\]:CURRENT_OWNER_BINDING_ROLLING_REFRESH\.owners\.agent_api,/);
 assert.match(z,/\[PATHS\.mcpSource\]:CURRENT_OWNER_BINDING_ROLLING_REFRESH\.owners\.mcp_source/);
 assert.match(z,new RegExp(owners.agent_api));
 assert.match(z,new RegExp(owners.mcp_source));
});

test('V19 becomes a manifest-derived verifier, not an OLD_SHA to NEW_SHA updater',()=>{
 const s=a.buildV19BindingCandidate(input('v19_binding',fixtures.v19_binding)).after_bytes.toString();
 assert.match(s,new RegExp(`EXPECTED_ACTION_SHA='${owners.rolling_refresh}'`));
 assert.match(s,new RegExp(`EXPECTED_API_SHA='${owners.agent_api}'`));
 assert.match(s,new RegExp(`EXPECTED_MCP_SHA='${owners.mcp_source}'`));
 assert.match(s,/mcp_source_owner_binding_count_mismatch/);
 assert.doesNotMatch(s,/OLD_ACTION_SHA|OLD_API_SHA|NEW_API_SHA|gsub\(/);
 assert.match(s,/production_application_mutation/);
});

test('unknown SHA and wrong target fail closed before candidate generation',()=>{
 for(const id of Object.keys(fixtures)){
   assert.throws(()=>a.buildConsumerCandidate(id,{...input(id,fixtures[id]),before_sha256:'f'.repeat(64)}),/consumer_preimage_unknown/,id);
   assert.throws(()=>a.buildConsumerCandidate(id,{...input(id,fixtures[id]),target_path:'/tmp/not-allowed'}),/consumer_target_mismatch/,id);
 }
});

test('already migrated state is structurally validated and refreshes deterministically to a new manifest',()=>{
 for(const id of Object.keys(fixtures)){
   const first=a.buildConsumerCandidate(id,input(id,fixtures[id],manifest('a')));
   const second=a.buildConsumerCandidate(id,{manifest:manifest('b'),target_path:first.target_path,before_sha256:first.after_sha256,before_bytes:first.after_bytes});
   assert.equal(second.state,'already_migrated',id);
   assert.match(second.after_bytes.toString(),/PRHM_CURRENT_OWNER_BINDING_V1/,id);
   assert.notEqual(second.after_sha256,first.after_sha256,id);
   const third=a.buildConsumerCandidate(id,{manifest:manifest('b'),target_path:first.target_path,before_sha256:second.after_sha256,before_bytes:second.after_bytes});
   assert.equal(third.state,'already_migrated',id);
   assert.equal(third.after_sha256,second.after_sha256,id);
 }
});

test('malformed migrated-looking input fails closed',()=>{
 const id='registry_bridge';
 const fake='// PRHM_CURRENT_OWNER_BINDING_V1 !!!notbase64!!!\n'+fixtures[id];
 assert.throws(()=>a.buildConsumerCandidate(id,{manifest:manifest(),target_path:INITIAL_CONSUMER_PREIMAGES[id].target_path,before_sha256:'e'.repeat(64),before_bytes:Buffer.from(fake)}),/migrated_marker_invalid|consumer_preimage_unknown/);
});
