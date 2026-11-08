'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const cutover=require('./solo-company-runtime-root-cutover-contract-v1.cjs');
function healthy(){
  return Object.fromEntries(cutover.REQUIRED.map((u,i)=>[
    u,{active:'active',sub:'running',pid:2000+i}
  ]));
}
test('exact production topology has healthy root services and independent MCP lanes',()=>{
  const a=cutover.assess(healthy());
  assert.equal(a.approved,true);
  assert.equal(a.solo_running,true);
  assert.equal(a.blue_green_healthy,true);
  assert.equal(a.any_restart_authorized,false);
  assert.deepEqual(cutover.STEPS.map(x=>x.unit),[
    'prhm-company-approval.service',
    'prhm-agent-selfmaint.service',
    'prhm-agent-selfmaint-exec.service',
    'prhm-agent-mcp-blue.service',
    'prhm-agent-mcp-green.service'
  ]);
  assert.ok(!cutover.STEPS.some(x=>/router|solo-company-runtime/.test(x.unit)));
});
test('progress can only be serial, no restarting both MCP lanes together',()=>{
  const s=healthy(),done=[];
  for(const step of cutover.STEPS){
    assert.equal(cutover.nextStep(s,done),step.unit);
    done.push(step.unit);
  }
  assert.equal(cutover.nextStep(s,done),null);
  assert.throws(()=>cutover.nextStep(s,[cutover.STEPS[1].unit]),/out_of_order/);
});
test('missing, stopped or tampered control-plane units fail closed',()=>{
  const s=healthy();delete s['prhm-agent-mcp-green.service'];
  assert.throws(()=>cutover.assess(s),/not_healthy/);
  s['prhm-agent-mcp-green.service']={active:'failed',sub:'failed',pid:0};
  assert.throws(()=>cutover.nextStep(s,cutover.STEPS.slice(0,3).map(x=>x.unit)),/not_healthy/);
  const unknown=healthy();unknown['prhm-agent-api.service']={active:'inactive'};
  assert.throws(()=>cutover.assess(unknown),/unknown_unit/);
});
test('accept only healthy approval and unchanged Solo runtime',()=>{
  const valid={approval:{ok:true,service:'prhm-company-approval'},
    solo_http_status:200,solo_release:cutover.SOLO_RELEASE};
  assert.equal(cutover.assertHealth(valid),true);
  assert.throws(()=>cutover.assertHealth({...valid,approval:{ok:true,service:'bad'}}),/approval_http_unhealthy/);
  assert.throws(()=>cutover.assertHealth({...valid,solo_http_status:503}),/solo_http_unhealthy/);
  assert.throws(()=>cutover.assertHealth({...valid,solo_release:'new'}),/solo_release_drift/);
});
test('cutover contract cannot restart services or execute as root command',()=>{
  assert.equal(typeof cutover.restart,'undefined');
  assert.equal(typeof cutover.deploy,'undefined');
  assert.equal(typeof cutover.apply,'undefined');
  const r=cp.spawnSync(process.execPath,[path.join(__dirname,'solo-company-runtime-root-cutover-contract-v1.cjs')],{encoding:'utf8'});
  assert.equal(r.status,64);
  assert.match(r.stderr,/NO_CLI/);
});
