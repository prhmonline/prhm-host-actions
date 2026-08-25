export const FIXED=Object.freeze({
  action:'agent_api_fixed_one_shot_reload_v1',
  service:'prhm-agent-api.service',
  routes_path:'/home/agent/ssh-agent-api/selfmaintRoutes.js',
  routes_sha256:'41fbbe9e7ce3304a1bb1c2de635b5f91f4e42ec2aa6f78368e39cf877056bab6',
  health_url:'http://127.0.0.1:8110/health',
  restart_timeout_ms:20000,
  health_timeout_ms:15000,
  second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'
});

export function requestToolSchema(){return {}}
export function applyToolSchema(){return {request_id:'uuid',second_confirmation:FIXED.second_confirmation}}
export function statusToolSchema(){return {request_id:'uuid'}}

function requiredString(value,name){
  if(typeof value!=='string'||!value)throw new Error(name+'_missing');
  return value;
}
function requiredPositivePid(value,name){
  if(!Number.isInteger(value)||value<=0)throw new Error(name+'_invalid');
  return value;
}
function timestamp(value,name){
  const parsed=Date.parse(requiredString(value,name));
  if(!Number.isFinite(parsed))throw new Error(name+'_invalid');
  return parsed;
}

export function validatePreflight(state){
  if(!state||typeof state!=='object')throw new Error('preflight_state_invalid');
  if(String(state.routes_sha256||'')!==FIXED.routes_sha256)throw new Error('routes_sha_mismatch');
  if(String(state.active_state||'')!=='active'||String(state.sub_state||'')!=='running')throw new Error('service_not_active');
  return true;
}

export function validatePostflight(state){
  if(!state||typeof state!=='object')throw new Error('postflight_state_invalid');
  const oldPid=requiredPositivePid(state.old_pid,'old_pid');
  const newPid=requiredPositivePid(state.new_pid,'new_pid');
  if(oldPid===newPid)throw new Error('pid_unchanged');
  const oldStarted=timestamp(state.old_started_at,'old_started_at');
  const newStarted=timestamp(state.new_started_at,'new_started_at');
  if(newStarted<=oldStarted)throw new Error('start_time_not_advanced');
  if(!state.health||state.health.ok!==true)throw new Error('health_failed');
  return true;
}

function requireDeps(deps){
  if(!deps||typeof deps!=='object')throw new Error('deps_missing');
  for(const name of ['sha256File','serviceState','restartService','waitForActive','health']){
    if(typeof deps[name]!=='function')throw new Error('dep_'+name+'_missing');
  }
  return deps;
}

export async function runFixedOneShotReload(deps){
  const d=requireDeps(deps);
  const routesSha=await d.sha256File(FIXED.routes_path);
  const before=await d.serviceState(FIXED.service);
  validatePreflight({routes_sha256:routesSha,active_state:before?.active_state,sub_state:before?.sub_state});
  requiredPositivePid(before?.pid,'old_pid');
  timestamp(before?.started_at,'old_started_at');

  const restart=await d.restartService(FIXED.service);
  if(!restart||restart.ok!==true)throw new Error('restart_failed');

  const after=await d.waitForActive(FIXED.service,FIXED.restart_timeout_ms);
  if(!after||after.active_state!=='active'||after.sub_state!=='running')throw new Error('service_not_active_after_restart');
  const health=await d.health(FIXED.health_url,FIXED.health_timeout_ms);
  validatePostflight({old_pid:before.pid,new_pid:after.pid,old_started_at:before.started_at,new_started_at:after.started_at,health});

  return Object.freeze({
    ok:true,
    action:FIXED.action,
    service:FIXED.service,
    routes_sha256:routesSha,
    old_pid:before.pid,
    new_pid:after.pid,
    old_started_at:before.started_at,
    new_started_at:after.started_at,
    health_ok:true,
    production_mutation:true,
    file_mutation:false,
    policy_mutation:false,
    database_mutation:false,
    network_mutation:false
  });
}
