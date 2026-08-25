import assert from 'node:assert/strict';
import {
  FIXED,
  requestToolSchema,
  applyToolSchema,
  statusToolSchema,
  runFixedOneShotReload,
  validatePreflight,
  validatePostflight
} from '../../candidates/control-plane/agent-api-fixed-one-shot-reload-v1.mjs';

assert.deepEqual(requestToolSchema(), {});
assert.deepEqual(applyToolSchema(), {request_id:'uuid',second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'});
assert.deepEqual(statusToolSchema(), {request_id:'uuid'});
assert.equal(FIXED.action,'agent_api_fixed_one_shot_reload_v1');
assert.equal(FIXED.service,'prhm-agent-api.service');
assert.equal(FIXED.routes_path,'/home/agent/ssh-agent-api/selfmaintRoutes.js');
assert.equal(FIXED.routes_sha256,'41fbbe9e7ce3304a1bb1c2de635b5f91f4e42ec2aa6f78368e39cf877056bab6');
assert.equal(FIXED.health_url,'http://127.0.0.1:8110/health');
assert.equal(FIXED.second_confirmation,'CONFIRM_LEVEL_4_CRITICAL');

for (const forbidden of ['service','path','command','signal','url','sha256','payload','environment','token','credential']) {
  assert.equal(Object.hasOwn(requestToolSchema(),forbidden),false);
}

assert.equal(validatePreflight({routes_sha256:FIXED.routes_sha256,active_state:'active',sub_state:'running'}),true);
assert.throws(()=>validatePreflight({routes_sha256:'0'.repeat(64),active_state:'active',sub_state:'running'}),/routes_sha_mismatch/);
assert.throws(()=>validatePreflight({routes_sha256:FIXED.routes_sha256,active_state:'inactive',sub_state:'dead'}),/service_not_active/);

assert.equal(validatePostflight({old_pid:101,new_pid:202,old_started_at:'2026-08-25T13:05:00Z',new_started_at:'2026-08-25T21:30:00Z',health:{ok:true}}),true);
assert.throws(()=>validatePostflight({old_pid:101,new_pid:101,old_started_at:'2026-08-25T13:05:00Z',new_started_at:'2026-08-25T21:30:00Z',health:{ok:true}}),/pid_unchanged/);
assert.throws(()=>validatePostflight({old_pid:101,new_pid:202,old_started_at:'2026-08-25T21:30:00Z',new_started_at:'2026-08-25T13:05:00Z',health:{ok:true}}),/start_time_not_advanced/);
assert.throws(()=>validatePostflight({old_pid:101,new_pid:202,old_started_at:'2026-08-25T13:05:00Z',new_started_at:'2026-08-25T21:30:00Z',health:{ok:false}}),/health_failed/);

const calls=[];
const deps={
  async sha256File(path){calls.push(['sha256File',path]);return FIXED.routes_sha256;},
  async serviceState(service){calls.push(['serviceState',service]);return {active_state:'active',sub_state:'running',pid:101,started_at:'2026-08-25T13:05:00Z'};},
  async restartService(service){calls.push(['restartService',service]);return {ok:true};},
  async waitForActive(service,timeoutMs){calls.push(['waitForActive',service,timeoutMs]);return {active_state:'active',sub_state:'running',pid:202,started_at:'2026-08-25T21:30:00Z'};},
  async health(url,timeoutMs){calls.push(['health',url,timeoutMs]);return {ok:true,service:'ssh-agent-api'};}
};
const result=await runFixedOneShotReload(deps);
assert.equal(result.ok,true);
assert.equal(result.production_mutation,true);
assert.equal(result.service,FIXED.service);
assert.equal(result.old_pid,101);
assert.equal(result.new_pid,202);
assert.equal(result.routes_sha256,FIXED.routes_sha256);
assert.deepEqual(calls,[
  ['sha256File',FIXED.routes_path],
  ['serviceState',FIXED.service],
  ['restartService',FIXED.service],
  ['waitForActive',FIXED.service,FIXED.restart_timeout_ms],
  ['health',FIXED.health_url,FIXED.health_timeout_ms]
]);

let restarted=false;
await assert.rejects(()=>runFixedOneShotReload({
  ...deps,
  async sha256File(){return '0'.repeat(64);},
  async restartService(){restarted=true;return {ok:true};}
}),/routes_sha_mismatch/);
assert.equal(restarted,false);

console.log('AGENT_API_FIXED_ONE_SHOT_RELOAD_TDD=PASS');
