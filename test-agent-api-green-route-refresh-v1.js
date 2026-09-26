'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const h = require('./agent-api-green-route-refresh-v1.js');

function make(opts={}){
  const calls=[]; let i=0;
  const states=opts.states??[{active:'active',sub:'running',pid:111},{active:'active',sub:'running',pid:222}];
  const deps={
    lstat:()=>({isFile:()=>true,isSymbolicLink:()=>false}),
    realpath:()=>h.SOURCE,
    readFile:()=>Buffer.from(h.ROUTE_MARKER),
    sha256:()=>opts.sha??h.SOURCE_SHA256,
    systemctlShow:s=>{calls.push(['show',s]);return states[Math.min(i++,states.length-1)];},
    restart:s=>{calls.push(['restart',s]);if(opts.restartError)throw new Error('restart boom');},
    health:async()=>opts.health??true,
    sleep:()=>{},
  };
  return {calls,runner:h.createRunner(deps)};
}

(async()=>{
  assert.equal(h.ACTION,'agent_api_green_route_refresh_v1');
  assert.equal(h.SCHEMA_VERSION,'prhm.agent-api-green-route-refresh-result.v1');
  assert.equal(h.SERVICE,'prhm-agent-api-green.service');
  assert.equal(h.SOURCE,'/home/agent/ssh-agent-api/opsExecutorRoutes.js');
  assert.equal(h.SOURCE_SHA256,'1ab03973db68cb54156a579db5a8b26f0e58f5e940805633a467a0a9f28ada15');
  assert.equal(h.PORT,8102);
  assert.equal(h.HEALTH_URL,'http://127.0.0.1:8102/health');
  assert.equal(h.runApply.length,0); assert.equal(h.runPreflight.length,0);

  { const {calls,runner}=make({sha:'0'.repeat(64)}); assert.throws(()=>runner.runPreflight(),/green_refresh_source_sha_mismatch/); assert.equal(calls.some(x=>x[0]==='restart'),false); }
  { const {calls,runner}=make({states:[{active:'inactive',sub:'dead',pid:0}]}); assert.throws(()=>runner.runPreflight(),/green_refresh_service_not_active/); assert.equal(calls.some(x=>x[0]==='restart'),false); }
  { const {runner}=make({restartError:true}); await assert.rejects(()=>runner.runApply(),/restart boom/); }
  { const {runner}=make({states:[{active:'active',sub:'running',pid:111},{active:'active',sub:'running',pid:111}]}); await assert.rejects(()=>runner.runApply(),/green_refresh_pid_unchanged/); }
  { const {runner}=make({health:false}); await assert.rejects(()=>runner.runApply(),/green_refresh_health_failed/); }
  {
    const {calls,runner}=make(); const r=await runner.runApply();
    assert.equal(r.ok,true); assert.equal(r.schema_version,h.SCHEMA_VERSION); assert.equal(r.action,h.ACTION); assert.equal(r.service,h.SERVICE);
    assert.equal(r.before_pid,111); assert.equal(r.after_pid,222); assert.equal(r.pid_changed,true); assert.equal(r.health_ok,true); assert.equal(r.service_active,true);
    for(const k of ['blue_service_mutation','mcp_service_mutation','database_mutation','application_tree_mutation','dns_mutation','tls_mutation','rollback_performed']) assert.equal(r[k],false,k);
    assert.deepEqual(calls.filter(x=>x[0]==='restart'),[['restart',h.SERVICE]]);
  }

  const code=fs.readFileSync(__dirname+'/agent-api-green-route-refresh-v1.js','utf8');
  assert.equal((code.match(/prhm-agent-api-green\.service/g)||[]).length,1);
  for(const forbidden of ['prhm-agent-api-blue.service','prhm-agent-mcp','prhm-agent-api.service','agent_zdt_existing_topology_rolling_refresh_v1']) assert.equal(code.includes(forbidden),false,forbidden);

  const b=require('./bootstrap-host-actions-agent-api-green-route-refresh-v1.js');
  const plan=b.registrationPlan();
  assert.equal(plan.action,h.ACTION);
  assert.equal(plan.helper_sha256,'975b8d0064c7be4cdae7624354f2b80fe6233577d7433e35fc894b81f0b89dc2');
  assert.equal(plan.policy_classification,'compute_at_install');
  assert.equal(plan.accepts_user_payload,false);
  assert.equal(plan.target_service,h.SERVICE);
  assert.equal(plan.target_port,h.PORT);
  for(const k of ['arbitrary_command','arbitrary_path','arbitrary_service','arbitrary_port','arbitrary_pid','arbitrary_source_sha']) assert.equal(plan[k],false,k);

  console.log('GREEN 6 behavioral cases + fixed contract');
})().catch(e=>{console.error(e);process.exit(1)});
