'use strict';
/**
 * SOURCE ONLY: independent blue + green MCP discovery verdict for the
 * Honartik registry V2. The pre-existing root executor must provide an
 * authenticated, uncached, live tools/list probe for each exact service.
 * This module neither opens sockets nor starts processes nor installs tools.
 * No single-server result is authoritative for success or rollback.
 */
const SERVICES=Object.freeze([
 'prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service'
]);
const TARGET='honartik_config_center_readonly_enroll_v1';
const ACTION_NAME=/^[a-z][a-z0-9_]{1,127}$/;
const MAX_AGE_MS=5000;
function stop(reason){throw new Error('registry_v2_discovery_'+reason)}
function requireThat(value,reason){if(!value)stop(reason)}
function exact(value,fields){
 requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join('|')===fields.slice().sort().join('|'),
  'untrusted_probe_shape');
}
function createCallbacks({probeWorker}={}){
 requireThat(typeof probeWorker==='function','trusted_live_probe_missing');
 async function inspect(action){
  requireThat(action===TARGET,'target_not_allowlisted');
  const presence=[];
  for(const service of SERVICES){
   const report=await probeWorker(service);
   exact(report,['service','ok','tools','observed_at_ms']);
   const now=Date.now();
   requireThat(report.service===service&&report.ok===true&&
    Number.isSafeInteger(report.observed_at_ms)&&
    report.observed_at_ms>=now-MAX_AGE_MS&&report.observed_at_ms<=now+1000,
    'unhealthy_or_stale_worker_'+service);
   requireThat(Array.isArray(report.tools)&&report.tools.length<=256,
    'tool_list_invalid_'+service);
   const names=new Set();
   for(const tool of report.tools){
    requireThat(typeof tool==='string'&&ACTION_NAME.test(tool)&&
     !names.has(tool),'tool_name_or_duplicate_'+service);
    names.add(tool);
   }
   presence.push(names.has(action));
  }
  // Mixed blue/green states are neither an active registration nor a
  // verified rollback. Never return false merely because one is absent.
  requireThat(presence[0]===presence[1],'blue_green_registry_inconsistent');
  return Object.freeze({action,service_count:SERVICES.length,
   present:presence[0],absent:!presence[0]});
 }
 return Object.freeze({
  getToolDiscovery:async action=>(await inspect(action)).present,
  verifyTargetAbsent:async action=>(await inspect(action)).absent
 });
}
module.exports=Object.freeze({SERVICES,TARGET,MAX_AGE_MS,createCallbacks});
