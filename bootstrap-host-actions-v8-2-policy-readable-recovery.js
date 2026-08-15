#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const POLICY='/opt/prhm-company-control-plane/config/approval-policy.json';
const POLICY_SHA='afae32985861cb8b9396f4cea4b05e1c68b90a6ad55937b27c8fcf7dc84321df';
const POLICY_VERSION='2026-08-15.3-verified-economics-replay-v1';
const EXPECTED=Object.freeze({
 '/opt/prhm-agent-selfmaint/server.js':'5d8c42b5032c766832822097fe73905ae34097f697e7232fed6b333d54c9dbbd',
 '/opt/prhm-agent-selfmaint-exec/server.js':'97a0a438c12a0158d3386cf345c5579a6517be558c6093113efa2086729e4c8d',
 '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js':'7c94467843b084f7970945c3251d6e03b6528ba10ac5c973c10861f41cba41f4',
 '/opt/prhm-agent-selfmaint-exec/actions/real-market-verified-economics-uat-v1.js':'ff5eca545227742d6fd0d4e1d920a083b1d1569943df51c859739ab347f3db55'
});
function fail(m){throw new Error(m)}
function sha(f){return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}
function mode(f){return fs.statSync(f).mode & 0o777}
function exec(file,args,opt={}){const r=cp.spawnSync(file,args,{encoding:'utf8',maxBuffer:1024*1024,...opt});if(r.error)fail('exec_error:'+file+':'+r.error.message);if(r.status!==0)fail('exec_failed:'+file+':'+r.status+':'+String(r.stderr||'').slice(-1000));return r}
function baseline(){if(sha(POLICY)!==POLICY_SHA)fail('policy_sha_mismatch');const p=JSON.parse(fs.readFileSync(POLICY,'utf8'));if(p.version!==POLICY_VERSION||p.operations?.['host_action.real_market_verified_economics_uat_v1']?.level!==4)fail('policy_content_invalid');for(const [f,x] of Object.entries(EXPECTED))if(sha(f)!==x)fail('sha_mismatch:'+f)}
function registryPid(){const pid=String(exec('/usr/bin/systemctl',['show','prhm-company-registry.service','-p','MainPID','--value']).stdout||'').trim();if(!/^\d+$/.test(pid)||pid==='0')fail('registry_pid_unavailable');return pid}
function health(){const r=cp.spawnSync('/usr/bin/nsenter',['-t',registryPid(),'-n','/usr/bin/curl','-fsS','--max-time','2','http://127.0.0.1:18133/health'],{encoding:'utf8'});if(r.status!==0)return null;try{return JSON.parse(r.stdout)}catch{return null}}
function ready(){for(let i=0;i<60;i++){const x=health();if(x&&x.ok===true&&x.policy_version===POLICY_VERSION)return x;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250)}fail('approval_not_ready_after_permission_recovery')}
function main(){const args=process.argv.slice(2);if(args.length>1||(args.length===1&&args[0]!=='--preflight-only'))fail('unexpected_arguments');if(process.getuid&&process.getuid()!==0)fail('must_run_as_root');baseline();const beforeMode=mode(POLICY),beforeHealth=health();if(args[0]==='--preflight-only'){console.log(JSON.stringify({ok:true,schema_version:'prhm.host-action-remediation-preflight.v1',preflight_only:true,remediation:'v8.2-policy-readable-recovery',policy_sha256:POLICY_SHA,policy_version:POLICY_VERSION,policy_mode_before:beforeMode.toString(8),approval_health_before:beforeHealth,content_mutation:false,database_mutation:false,business_mutation:false,service_restart:false,p0_live:false,proposal_send:false,bid_send:false,production_mutation:false}));return}fs.chmodSync(POLICY,0o644);if(sha(POLICY)!==POLICY_SHA)fail('policy_content_changed');exec('/usr/bin/systemctl',['restart','prhm-company-approval.service'],{timeout:60000});const after=ready();baseline();if(mode(POLICY)!==0o644)fail('policy_mode_postverify_failed');console.log(JSON.stringify({ok:true,schema_version:'prhm.host-action-remediation-result.v1',installed:true,remediation:'v8.2-policy-readable-recovery',policy_sha256:POLICY_SHA,policy_version:POLICY_VERSION,policy_mode_before:beforeMode.toString(8),policy_mode_after:mode(POLICY).toString(8),approval_health_before:beforeHealth,approval_health_after:after,content_mutation:false,permission_mutation:true,database_mutation:false,business_mutation:false,service_restart:true,p0_live:false,proposal_send:false,bid_send:false}))}
try{main()}catch(e){process.stderr.write(String(e&&e.stack||e)+'\n');process.exit(1)}
