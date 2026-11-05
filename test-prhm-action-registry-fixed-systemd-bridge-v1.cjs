'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('./prhm-action-registry-fixed-systemd-bridge-v1.cjs');
const UNIT='prhm-shared-registry-bootstrap-v1-d17cc4aa.service';
const CG='0::/system.slice/'+UNIT+'\n';
function fake({cgroup=CG,uid=0,unchanged=false,badActive=false}={}){
 const pids=Object.fromEntries(S.SERVICES.map((x,i)=>[x,12300+i]));
 const calls=[];
 const execFileSync=(bin,args,opts)=>{
  calls.push([bin,[...args]]);
  assert.equal(bin,'/usr/bin/systemctl');
  assert.equal(opts.stdio[0],'ignore');
  const name=args.at(-1);
  assert.ok(S.SERVICES.includes(name));
  if(args[0]==='restart'){
   if(!unchanged)pids[name]+=2000;
   return '';
  }
  assert.deepEqual(args.slice(0,3),['show','--value',args[2]]);
  if(args[2]==='--property=ActiveState')return badActive?'inactive\n':'active\n';
  if(args[2]==='--property=MainPID')return String(pids[name])+'\n';
  throw Error('unexpected command');
 };
 const bridge=S.createFixedSystemdBridge({execFileSync,
   readCgroup:()=>cgroup,getuid:()=>uid});
 return {bridge,calls};
}
test('all four fixed service restarts are isolated and verify changed MainPID',()=>{
 const f=fake();
 for(const name of S.SERVICES){
  assert.equal(f.bridge.restartService(name),true);
  assert.equal(f.bridge.checkServiceHealth(name),true);
 }
 assert.equal(f.calls.filter(x=>x[1][0]==='restart').length,4);
 assert.equal(f.calls.every(x=>x[0]==='/usr/bin/systemctl'),true);
 assert.equal(f.calls.some(x=>x[1].includes('sh')),false);
});
test('no arbitrary service, shell token or SQL can reach the subprocess',()=>{
 const f=fake();
 for(const name of ['',null,'ssh.service','prhm-agent-api.service',
  'prhm-agent-mcp-blue.service;touch /tmp/x','../../etc/passwd']){
  assert.throws(()=>f.bridge.restartService(name),/service_not_allowlisted/);
  assert.throws(()=>f.bridge.checkServiceHealth(name),/service_not_allowlisted/);
 }
 assert.equal(f.calls.length,0);
});
test('root credentials and independent transient cgroup required before first subprocess',()=>{
 for(const opts of [
  {uid:1000},{cgroup:'0::/system.slice/prhm-agent-selfmaint-exec.service\n'},
  {cgroup:'0::/system.slice/prhm-shared-registry-bootstrap-v1-xx.scope\n'},
  {cgroup:'0::/system.slice/prhm-shared-registry-bootstrap-v1-xx.service/prhm-agent-selfmaint-exec.service\n'},
  {cgroup:'0::/system.slice/another-thing.service\n'},
  {cgroup:''}
 ]){
  const f=fake(opts);
  assert.throws(()=>f.bridge.restartService(S.SERVICES[0]),
    /root_required|independent_transient_runner_required|self_restart_forbidden|cgroup_read_invalid/);
  assert.equal(f.calls.length,0);
 }
});
test('unhealthy service or unchanged PID blocks success report',()=>{
 const unchanged=fake({unchanged:true});
 assert.throws(()=>unchanged.bridge.restartService(S.SERVICES[0]),/restart_pid_did_not_change/);
 const unhealthy=fake({badActive:true});
 assert.throws(()=>unhealthy.bridge.restartService(S.SERVICES[0]),/service_not_healthy/);
});
test('trusted callback surface excludes any generic host command execution API',()=>{
 const f=fake();
 assert.deepEqual(Object.keys(f.bridge).sort(),[
  'checkServiceHealth','restartService'].sort());
 assert.deepEqual(S.SERVICES,[
  'prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service',
  'prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service'
 ]);
 for(const key of ['exec','shell','daemonReload','writeFile','deploy','approve'])
  assert.equal(Object.hasOwn(f.bridge,key),false);
});
