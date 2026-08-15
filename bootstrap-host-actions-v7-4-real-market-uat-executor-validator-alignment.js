#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const cp=require('node:child_process');
const TARGET='/opt/prhm-agent-selfmaint-exec/server.js';
const EXPECTED=Object.freeze({
'/opt/prhm-agent-selfmaint/server.js':'adae6fc8d49c150706f9811af9c2c494c211ba135e1d0548dc3657af5f3e8d00',
[TARGET]:'3007e385cacd891eb27c959ab8b9ed750b668f3e00838b29eefffbfdc0f948f7',
'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js':'831fc0a3c42b41fd3c494bffedfda50863b74d7e4f31f7ac340b5272b440ed03',
'/opt/prhm-company-control-plane/config/approval-policy.json':'33d61df7539f2812f40723022afebe94187d92d597257f957a227bcd2f410d2d',
'/opt/prhm-agent-selfmaint-exec/actions/mcp-candidate-schema-compare-v1.js':'68d95f4b63367317e511c0723ef614f374fb816c769f67b72b3c212d478d742c',
'/opt/prhm-agent-selfmaint-exec/actions/real-market-shadow-uat-v1.js':'2fe6f9546ea6d14ab2d883433714ef5a543f643ba3685dfff1e4294a35f0733b',
'/opt/prhm-p0-shadow-worker/worker.js':'3854fcee1ab1fa64a972d0c332c799a226f522308e1f994203ffa45e600de422',
'/opt/prhm-p0-shadow-worker/p0-engine.js':'91a056a654155962a8bdc6760fcbd32ff5d1f475579e4d57af00153937fb48f6',
'/opt/prhm-p0-fixed-executor/migrations/009_economic_input_facts.sql':'dfaba6d8f454a99cdeb9286a40514ee56ae32a6f4829b7e52d7be42798c3a148'
});
const OLD_REASON="result.reason!=='price_inputs_missing'";const NEW_REASON="result.reason!=='economics_inputs_incomplete'";
const OLD_VER="version: '1.7.0-host-actions-v2-real-market-shadow-uat'";const NEW_VER="version: '1.7.1-host-actions-v2-real-market-shadow-uat-validator'";
function fail(m){throw new Error(m)}function shaBuf(b){return crypto.createHash('sha256').update(b).digest('hex')}function sha(f){return shaBuf(fs.readFileSync(f))}
function replaceOnce(s,a,b,l){const i=s.indexOf(a);if(i<0)fail('anchor_missing:'+l);if(s.indexOf(a,i+1)>=0)fail('anchor_not_unique:'+l);return s.slice(0,i)+b+s.slice(i+a.length)}
function baseline(){for(const [f,x] of Object.entries(EXPECTED)){if(!fs.existsSync(f))fail('missing:'+f);const a=sha(f);if(a!==x)fail('sha_mismatch:'+f+':'+a+':'+x)}}
function candidate(){let s=fs.readFileSync(TARGET,'utf8');s=replaceOnce(s,OLD_REASON,NEW_REASON,'reason');s=replaceOnce(s,OLD_VER,NEW_VER,'version');return s}
function exec(f,args,opt={}){const r=cp.spawnSync(f,args,{encoding:'utf8',maxBuffer:1024*1024,...opt});if(r.error)fail('exec_error:'+r.error.message);if(r.status!==0)fail('exec_failed:'+f+':'+r.status+':'+String(r.stderr||'').slice(-1200));return r}
function syntax(s){const t='/tmp/prhm-v7-4-executor-'+process.pid+'.js';try{fs.writeFileSync(t,s,{mode:0o700});exec('/usr/local/bin/prhm-node',['--check',t])}finally{try{fs.unlinkSync(t)}catch{}}}
function systemctl(args){exec('/usr/bin/systemctl',args,{timeout:30000})}
function health(){for(let i=0;i<50;i++){const r=cp.spawnSync('/usr/bin/curl',['-fsS','--max-time','2','--unix-socket','/run/prhm-agent-selfmaint-exec/exec.sock','http://localhost/health'],{encoding:'utf8'});if(r.status===0){try{const x=JSON.parse(r.stdout);if(x.ok===true&&x.version==='1.7.1-host-actions-v2-real-market-shadow-uat-validator')return x}catch{}}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200)}fail('executor_health_not_ready')}
function atomic(s){const t=TARGET+'.v7-4-'+process.pid+'.tmp';fs.writeFileSync(t,s,{mode:0o755});fs.chmodSync(t,0o755);fs.renameSync(t,TARGET)}
function main(){const a=process.argv.slice(2);if(a.length>1||(a.length===1&&a[0]!=='--preflight-only'))fail('unexpected_arguments');if(process.getuid&&process.getuid()!==0)fail('must_run_as_root');baseline();const c=candidate();syntax(c);const csha=shaBuf(Buffer.from(c));if(a[0]==='--preflight-only'){console.log(JSON.stringify({ok:true,schema_version:'prhm.host-action-remediation-preflight.v1',preflight_only:true,remediation:'v7.4-real-market-uat-executor-validator-alignment',old_executor_sha:EXPECTED[TARGET],candidate_executor_sha:csha,target_version:'1.7.1-host-actions-v2-real-market-shadow-uat-validator',database_mutation:false,business_mutation:false,p0_live:false,proposal_send:false,bid_send:false,production_mutation:false}));return}
const stamp=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14),dir='/var/backups/prhm-host-actions-v7-4-real-market-uat-'+stamp;fs.mkdirSync(dir,{recursive:true,mode:0o700});const bak=path.join(dir,'server.js');fs.copyFileSync(TARGET,bak);fs.chmodSync(bak,0o600);let ok=false;try{atomic(c);if(sha(TARGET)!==csha)fail('post_sha_mismatch');systemctl(['restart','prhm-agent-selfmaint-exec.service']);const h=health();ok=true;console.log(JSON.stringify({ok:true,schema_version:'prhm.host-action-remediation-result.v1',installed:true,remediation:'v7.4-real-market-uat-executor-validator-alignment',old_executor_sha:EXPECTED[TARGET],new_executor_sha:csha,version:h.version,backup_dir:dir,database_mutation:false,business_mutation:false,p0_live:false,proposal_send:false,bid_send:false}))}finally{if(!ok){try{fs.copyFileSync(bak,TARGET);fs.chmodSync(TARGET,0o755);systemctl(['restart','prhm-agent-selfmaint-exec.service'])}catch{}if(sha(TARGET)!==EXPECTED[TARGET])fail('rollback_incomplete')}}}
try{main()}catch(e){process.stderr.write(String(e&&e.stack||e)+'\n');process.exit(1)}
