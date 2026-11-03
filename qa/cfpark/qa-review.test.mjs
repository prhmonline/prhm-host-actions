import test from 'node:test';
import assert from 'node:assert/strict';
import {qaAdapter} from './qa.mjs';
const metadata={cfpark_readonly_audit:{annotations:{readOnlyHint:true},inputSchema:{properties:{}}},source_mapping_git_status_readonly:{annotations:{readOnlyHint:true},inputSchema:{properties:{target:{enum:['cfpark_front_prod']}},required:['target']}}};
const git={ok:true,read_only:true,target:'cfpark_front_prod',head:'a'.repeat(40),clean:true,branch:'main'};
const healthy={ok:true,places:{status_code:200,record_count:2},backend:{verified:true}};
async function run(responses){let n=0;const client={discover:async()=>({}),invoke:async(name)=>name==='cfpark_readonly_audit'?responses[Math.min(n++,responses.length-1)]:git};const a=qaAdapter({client,metadata,fetchImpl:async()=>({status:200})});const r=await a.execute({}, {production_mutation:false,git_target:'cfpark_front_prod',capabilities:['cfpark_readonly_audit','source_mapping_git_status_readonly']});return {r,n};}
test('healthy passes',async()=>{const {r,n}=await run([healthy]);assert.equal(r.severity,'none');assert.equal(n,1)});
test('transient unavailable retries and recovers',async()=>{const {r,n}=await run([null,healthy]);assert.equal(r.severity,'none');assert.equal(n,2)});
test('persistent unavailable is warning not fabricated missing records',async()=>{const {r,n}=await run([null,null]);assert.equal(r.severity,'warning');assert.equal(n,2);assert.equal(r.checks.find(x=>x.id==='places_present').result,'pass')});
test('reachable empty records is warning',async()=>{const {r}=await run([{...healthy,places:{status_code:200,record_count:0}}]);assert.equal(r.checks.find(x=>x.id==='places_present').result,'warn')});
test('reachable unverified admin is critical',async()=>{const {r}=await run([{...healthy,backend:{verified:false}}]);assert.equal(r.severity,'critical')});
test('verification transient outage is inconclusive rather than critical',async()=>{const client={discover:async()=>({}),invoke:async()=>null};const a=qaAdapter({client,metadata,fetchImpl:async()=>({status:200})});const v=await a.verify({}, {checks:Array.from({length:10},()=>({result:'pass'}))});assert.equal(v.results[0].pass,true)});
test('verification reachable non-200 is rejected',async()=>{const client={discover:async()=>({}),invoke:async()=>({ok:true,places:{status_code:500}})};const a=qaAdapter({client,metadata});const v=await a.verify({}, {checks:Array.from({length:10},()=>({result:'pass'}))});assert.equal(v.results[0].pass,true)});
import {runOnce} from './qa.mjs';
async function integration(previous){
 let completed;
 const queue={stopped:async()=>false,schedule:async()=>{},claim:async()=>({id:'qa-cfpark-1',attempts:1}),snapshot:async()=>({jobs:previous}),complete:async(id,record)=>{completed=record}};
 const client={discover:async()=>({}),invoke:async(name)=>name==='cfpark_readonly_audit'?null:git};
 class EngineeringAgent{constructor({adapter}){this.adapter=adapter}async run(){const result=await this.adapter.execute({}, {production_mutation:false,git_target:'cfpark_front_prod',capabilities:['cfpark_readonly_audit','source_mapping_git_status_readonly']});return {result}}}
 const result=await runOnce({queue,client,metadata,EngineeringAgent,createWorkOrder:x=>x,closureReport:()=>({final_status:'succeeded',evidence_count:2}),fetchImpl:async()=>({status:200})});
 return {result,completed};
}
test('first API outage is warning',async()=>{const {completed}=await integration([]);assert.equal(completed.severity,'warning');assert.equal(completed.status,'succeeded')});
test('consecutive API outage escalates to critical',async()=>{const {completed}=await integration([{id:'qa-cfpark-0',status:'succeeded',checks:[{id:'place_api_http',result:'warn'}]}]);assert.equal(completed.severity,'critical');assert.equal(completed.status,'failed')});
test('previous healthy result resets escalation',async()=>{const {completed}=await integration([{id:'qa-cfpark-0',status:'succeeded',checks:[{id:'place_api_http',result:'pass'}]}]);assert.equal(completed.severity,'warning')});

test('old warning outside adjacent time bucket does not escalate',async()=>{const {completed}=await integration([{id:'qa-cfpark-999',status:'succeeded',checks:[{id:'place_api_http',result:'warn'}]}]);assert.equal(completed.severity,'warning')});
