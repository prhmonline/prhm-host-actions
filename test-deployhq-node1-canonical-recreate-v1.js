#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const m=require('./deployhq-node1-canonical-recreate-v1.js');

function adapterRequester(seq){let i=0;return async req=>{assert.equal(req.origin,'http://127.0.0.1:8791');return seq[i++]}}

test('preflight exact duplicate is idempotent and read-only',async()=>{
 const request=adapterRequester([{status:200,json:{ok:true,canonical:{state:'exact',identifier:'canon'},temp_honartik_ids:['t1']} }]);
 const r=await m.preflight({request});assert.equal(r.ok,true);assert.equal(r.preflight_only,true);assert.equal(r.production_mutation,false);assert.equal(r.canonical_state,'exact');assert.equal(r.canonical_identifier,'canon');
});
test('preflight absent canonical allows apply',async()=>{
 const r=await m.preflight({request:adapterRequester([{status:200,json:{ok:true,canonical:{state:'absent'},temp_honartik_ids:['t1','t2']}}])});assert.equal(r.canonical_state,'absent');assert.deepEqual(r.temp_honartik_ids,['t1','t2']);
});
test('preflight conflict fails closed',async()=>{
 await assert.rejects(()=>m.preflight({request:adapterRequester([{status:200,json:{ok:true,canonical:{state:'conflict'}}}])}),/canonical_name_conflict/)
});
test('apply clean create returns exact approved evidence',async()=>{
 const request=adapterRequester([
  {status:200,json:{ok:true,canonical:{state:'absent'},temp_honartik_ids:['t1']}},
  {status:201,json:{ok:true,canonical_created:true,canonical_identifier:'new1',config_match:true,deployment_executed:false,command_executed:false,honartik_targets_mutated:false,rollback_performed:false}},
  {status:200,json:{ok:true,canonical:{state:'exact',identifier:'new1'},temp_honartik_ids:['t1']}}
 ]);
 const r=await m.runApply({request});assert.equal(r.ok,true);assert.equal(r.action,'deployhq_node1_canonical_recreate_v1');assert.equal(r.schema_version,'prhm.host-action-result.v1');assert.equal(r.production_mutation,true);assert.equal(r.canonical_created,true);assert.equal(r.canonical_identifier,'new1');assert.equal(r.deployment_executed,false);assert.equal(r.command_executed,false);assert.equal(r.honartik_targets_mutated,false);
});
test('apply exact duplicate performs no mutation',async()=>{
 let calls=0;const request=async req=>{calls++;return {status:200,json:{ok:true,canonical:{state:'exact',identifier:'canon'},temp_honartik_ids:['t1']}}};const r=await m.runApply({request});assert.equal(calls,1);assert.equal(r.production_mutation,false);assert.equal(r.canonical_created,false);assert.equal(r.canonical_identifier,'canon');
});
test('adapter create failure is propagated fail-closed',async()=>{
 const request=adapterRequester([{status:200,json:{ok:true,canonical:{state:'absent'},temp_honartik_ids:['t1']}},{status:409,json:{ok:false,error:'honartik_targets_changed',rollback_performed:true}}]);
 await assert.rejects(()=>m.runApply({request}),/honartik_targets_changed/)
});
test('post-create readback mismatch rolls back the newly created identifier',async()=>{
 const seen=[]; const seq=[{status:200,json:{ok:true,canonical:{state:'absent'},temp_honartik_ids:['t1']}},{status:201,json:{ok:true,canonical_created:true,canonical_identifier:'11111111-1111-4111-8111-111111111111',config_match:true,deployment_executed:false,command_executed:false,honartik_targets_mutated:false,rollback_performed:false}},{status:200,json:{ok:true,canonical:{state:'absent'},temp_honartik_ids:['t1']}},{status:200,json:{ok:true,rollback_performed:true}}];let i=0;const request=async r=>{seen.push({method:r.method,path:r.path});return seq[i++]};
 await assert.rejects(()=>m.runApply({request}),/canonical_readback_mismatch/); assert.deepEqual(seen.at(-1),{method:'DELETE',path:'/v1/node1/11111111-1111-4111-8111-111111111111'});
});
test('temp Honartik drift after create fails closed',async()=>{
 const request=adapterRequester([{status:200,json:{ok:true,canonical:{state:'absent'},temp_honartik_ids:['t1']}},{status:201,json:{ok:true,canonical_created:true,canonical_identifier:'new1',config_match:true,deployment_executed:false,command_executed:false,honartik_targets_mutated:false,rollback_performed:false}},{status:200,json:{ok:true,canonical:{state:'exact',identifier:'new1'},temp_honartik_ids:['t2']}},{status:200,json:{ok:true,rollback_performed:true}}]);
 await assert.rejects(()=>m.runApply({request}),/honartik_targets_changed/)
});
test('helper source cannot access DeployHQ directly or credentials',()=>{
 const src=fs.readFileSync(__dirname+'/deployhq-node1-canonical-recreate-v1.js','utf8');
 for(const forbidden of ['deployhq.com','Authorization','deployhq_api_key','deployhq_email','Basic ']) assert.equal(src.includes(forbidden),false,forbidden);
 assert.match(src,/127\.0\.0\.1:8791/);
});


test('helper exposes fixed executor evidence path and atomic persistence function',()=>{
 assert.equal(m.RESULT_PATH,'/var/lib/prhm-agent-selfmaint-exec/deployhq-node1-canonical-recreate-v1/latest.json');
 assert.equal(typeof m.persistResult,'function');
});
