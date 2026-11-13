'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const cutover=require('./solo-company-runtime-root-cutover-contract-v1.cjs');
const live=require('./solo-company-runtime-root-live-health-v1.cjs');

function fixture(){
 const states=Object.fromEntries(cutover.REQUIRED.map((u,i)=>
   [u,{active:'active',sub:'running',pid:500+i}]));
 return {
  states,
  unitProbe:async unit=>states[unit],
  httpProbe:async(url)=>url===cutover.APPROVAL_HEALTH.url?
    {status:200,body:{ok:true,service:'prhm-company-approval'}}:{status:200},
  releaseProbe:async()=>cutover.SOLO_RELEASE
 };
}
test('read-only witness verifies all exact live service names and loopback health',async()=>{
 const f=fixture(),r=await live.attest(f);
 assert.equal(r.result,'PASS');
 assert.equal(r.live_service_count,cutover.REQUIRED.length);
 assert.equal(r.production_mutation,false);
 assert.equal(r.no_runtime_restart,true);
 assert.equal(r.router_healthy,true);
 assert.ok(cutover.REQUIRED.includes('prhm-company-approval-bridge.service'));
});
test('Approval bridge and each MCP lane are mandatory and fail-closed',async()=>{
 const f=fixture();
 f.states['prhm-company-approval-bridge.service']={active:'failed',sub:'failed',pid:0};
 await assert.rejects(live.attest(f),/not_healthy/);
 const g=fixture();
 delete g.states['prhm-agent-mcp-green.service'];
 await assert.rejects(live.attest(g),/not_healthy/);
});
test('live loopback health and exact release SHA are enforced',async()=>{
 const f=fixture();
 f.httpProbe=async url=>url===cutover.APPROVAL_HEALTH.url?
   {status:200,body:{ok:true,service:'other'}}:{status:200};
 await assert.rejects(live.attest(f),/approval_http_unhealthy/);
 const g=fixture();
 g.httpProbe=async url=>url===cutover.APPROVAL_HEALTH.url?
   {status:200,body:{ok:true,service:'prhm-company-approval'}}:{status:503};
 await assert.rejects(live.attest(g),/solo_http_unhealthy/);
 const h=fixture();
 h.releaseProbe=async()=> 'e'.repeat(40);
 await assert.rejects(live.attest(h),/solo_release_drift/);
});
test('health reader has no write or restart API and CLI without flag cannot run',()=>{
 assert.equal(typeof live.restart,'undefined');
 assert.equal(typeof live.install,'undefined');
 assert.equal(typeof live.apply,'undefined');
 const r=cp.spawnSync(process.execPath,
   [path.join(__dirname,'solo-company-runtime-root-live-health-v1.cjs')],
   {encoding:'utf8'});
 assert.equal(r.status,64);
 assert.match(r.stderr,/NO_APPLY/);
});
