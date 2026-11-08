'use strict';
/**
 * Solo registration / control-plane cutover contract.
 *
 * This is SOURCE ONLY, not a privileged runner. The existing Solo Runtime
 * is NOT reinstalled or restarted. Only fixed control-plane services may be
 * considered for a future signed and journalled six-file registration.
 *
 * The live topology contains separate MCP blue/green processes and router:
 * never restart both MCP lanes together, never restart the API router or
 * the Solo daemon as part of a registry change.
 */
const STEPS=Object.freeze([
  Object.freeze({key:'approval',unit:'prhm-company-approval.service'}),
  Object.freeze({key:'selfmaint',unit:'prhm-agent-selfmaint.service'}),
  Object.freeze({key:'executor',unit:'prhm-agent-selfmaint-exec.service'}),
  Object.freeze({key:'mcp_blue',unit:'prhm-agent-mcp-blue.service'}),
  Object.freeze({key:'mcp_green',unit:'prhm-agent-mcp-green.service'})
]);
const WITNESSES=Object.freeze([
  'prhm-company-approval-bridge.service',
  'prhm-agent-mcp-router.service',
  'prhm-agent-api-router.service',
  'prhm-agent-api-blue.service',
  'prhm-agent-api-green.service',
  'prhm-solo-company-runtime.service'
]);
const APPROVAL_HEALTH=Object.freeze({
  url:'http://127.0.0.1:18133/health',
  service:'prhm-company-approval'
});
const SOLO_HEALTH='http://127.0.0.1:8782/health';
const SOLO_RELEASE='0eb43d72aab3f10db22172c8be4c0411cf22d074';
const REQUIRED=Object.freeze([...STEPS.map(x=>x.unit),...WITNESSES]);
const fail=s=>{throw Error('solo_cutover_'+s)};
function assess(states){
  if(!states||typeof states!=='object'||Array.isArray(states))
    fail('missing_snapshot');
  const seen=Object.keys(states);
  for(const unit of seen)if(!REQUIRED.includes(unit))fail('unknown_unit');
  for(const unit of REQUIRED){
    const v=states[unit];
    if(!v||v.active!=='active'||v.sub!=='running'||
       !Number.isSafeInteger(v.pid)||v.pid<=0)fail('not_healthy:'+unit);
  }
  return Object.freeze({
    approved:true,control_plane_units:STEPS.length,
    witnessed_units:WITNESSES.length,
    blue_green_healthy:true,router_healthy:true,solo_running:true,
    any_restart_authorized:false
  });
}
function nextStep(states,completed=[]){
  assess(states);
  if(!Array.isArray(completed)||completed.length>STEPS.length)
    fail('progress_invalid');
  for(let i=0;i<completed.length;i++)
    if(completed[i]!==STEPS[i].unit)fail('out_of_order');
  if(completed.length===STEPS.length)return null;
  const next=STEPS[completed.length];
  // Only one lane can be in restart transition while the other
  // and router are independently confirmed live.
  if(next.key==='mcp_blue'&&
     states['prhm-agent-mcp-green.service'].active!=='active')
    fail('standby_lane_unhealthy');
  if(next.key==='mcp_green'&&
     states['prhm-agent-mcp-blue.service'].active!=='active')
    fail('standby_lane_unhealthy');
  return next.unit;
}
function assertHealth(probes){
  if(!probes||probes.approval?.ok!==true||
    probes.approval?.service!==APPROVAL_HEALTH.service)
    fail('approval_http_unhealthy');
  if(probes.solo_http_status!==200)fail('solo_http_unhealthy');
  if(probes.solo_release!==SOLO_RELEASE)fail('solo_release_drift');
  return true;
}
module.exports=Object.freeze({STEPS,WITNESSES,REQUIRED,APPROVAL_HEALTH,
  SOLO_HEALTH,SOLO_RELEASE,assess,nextStep,assertHealth});
if(require.main===module){
  process.stderr.write('NO_CLI: production cutover requires signed owner L4 and audited native dispatcher\n');
  process.exitCode=64;
}
