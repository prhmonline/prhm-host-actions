'use strict';
/**
 * V2 fixed synchronous service callbacks for the independent trusted runner.
 * Not an approval authority. A verified consumed Ed25519 Level-4 token and
 * durable one-time claim must be established by the parent registry gateway
 * before invoking restartService(). This module has no executable CLI.
 *
 * In contrast to restarting the long-lived executor from its own process,
 * the transient worker MUST belong to a named independent systemd unit.
 */
const cp=require('node:child_process');
const fs=require('node:fs');
const contract=require('./prhm-action-registry-v2-independent-runner-contract-v1.cjs');
const PREFIX='prhm-shared-registry-bootstrap-v2-';
const BIN='/usr/bin/systemctl';
const SERVICES=Object.freeze([...contract.SERVICES]);
const SET=new Set(SERVICES);
function fail(code){throw Error('registry_fixed_systemd_'+code)}
function check(ok,code){if(!ok)fail(code)}
function fixedName(name){
 check(typeof name==='string'&&SET.has(name)&&
   /^[a-z0-9.-]+\.service$/.test(name),'service_not_allowlisted');
 return name;
}
function cgroupAttestation(raw,getuid){
 check(getuid()===0,'root_required');
 check(typeof raw==='string'&&raw.length>0&&raw.length<=8192,
   'cgroup_read_invalid');
 const units=raw.split('\n')
  .filter(Boolean)
  .flatMap(x=>x.split('/'))
  .filter(x=>x.includes('prhm-shared-registry-bootstrap-v2-'));
 check(units.length===1&&
   /^prhm-shared-registry-bootstrap-v2-[a-z0-9-]+\.service$/.test(units[0]),
   'independent_transient_runner_required');
 check(!raw.includes('/prhm-agent-selfmaint-exec.service')&&
   !raw.includes('/prhm-agent-selfmaint.service'),
   'self_restart_forbidden');
 return units[0];
}
function createFixedSystemdBridge({
 execFileSync=cp.execFileSync,
 readCgroup=()=>fs.readFileSync('/proc/self/cgroup','utf8'),
 getuid=()=>process.getuid?.()
}={}){
 check(typeof execFileSync==='function'&&
   typeof readCgroup==='function'&&typeof getuid==='function',
   'trusted_host_functions_missing');
 function assertIndependent(){return cgroupAttestation(readCgroup(),getuid)}
 function command(argv){
   assertIndependent();
   const out=execFileSync(BIN,argv,{
     timeout:45000,encoding:'utf8',stdio:['ignore','pipe','pipe'],
     maxBuffer:8192
   });
   check(typeof out==='string'&&out.length<=8192,'systemctl_output_invalid');
   return out.trim();
 }
 function state(name){
   fixedName(name);
   const status=command(['show','--value','--property=ActiveState',name]);
   const pidText=command(['show','--value','--property=MainPID',name]);
   check(status==='active'&&/^[1-9][0-9]*$/.test(pidText),
     'service_not_healthy_'+name);
   const pid=Number(pidText);
   check(Number.isSafeInteger(pid)&&pid>1,'service_pid_invalid');
   return Object.freeze({status,pid});
 }
 function restartService(name){
   fixedName(name);
   const before=state(name);
   command(['restart',name]); // absolute binary, fixed argv, NEVER a shell
   const after=state(name);
   check(after.pid!==before.pid,'restart_pid_did_not_change_'+name);
   return true;
 }
 function checkServiceHealth(name){
   return state(fixedName(name)).status==='active';
 }
 return Object.freeze({restartService,checkServiceHealth});
}
module.exports=Object.freeze({SERVICES,PREFIX,fixedName,cgroupAttestation,
 createFixedSystemdBridge});
