#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const http=require('node:http');

const ACTION='drtarjomeh_containment_runner_transport_repair_v1';
const TARGET='/opt/prhm-agent-selfmaint-exec/server.js';
const SERVICE='prhm-agent-selfmaint-exec.service';
const SOCKET='/run/prhm-agent-selfmaint-exec/exec.sock';
const EXPECTED_SHA='caded448abf968ee35a76467b8afa6258488927806b85593fd732b7e2eed25a9';
const BACKUP_PREFIX='/var/backups/drtarjomeh-containment-runner-transport-repair-v1-';
const FN_START='async function applyDrTarjomehSecurityContainmentV1() {';
const FN_END='\n}\n\napplyHostActionV2=async function';
const PIPE_LINE="    '--pipe',\n";
const RESULT_PATH="/var/lib/prhm-agent-selfmaint-exec/drtarjomeh-security-containment-v1/latest.json";

function fail(m){throw new Error(m)}
function sha(b){return crypto.createHash('sha256').update(b).digest('hex')}
function count(h,n){return h.split(n).length-1}
function patchExecutorSource(source){
  if(typeof source!=='string'||!source.length)fail('source_missing');
  if(count(source,FN_START)!==1)fail('function_count:'+count(source,FN_START));
  const start=source.indexOf(FN_START), end=source.indexOf(FN_END,start);
  if(end<0)fail('function_end_missing');
  let fn=source.slice(start,end+2);
  if(count(fn,PIPE_LINE)!==1)fail('pipe_count:'+count(fn,PIPE_LINE));
  if(count(fn,'  const lines =')!==1)fail('stdout_parser_count:'+count(fn,'  const lines ='));
  if(count(fn,'  return result;')!==1)fail('return_result_count:'+count(fn,'  return result;'));
  const req="  const childProcess = require('node:child_process');\n";
  if(count(fn,req)!==1)fail('child_process_anchor_count:'+count(fn,req));
  fn=fn.replace(req,req+"  const resultPath = '"+RESULT_PATH+"';\n  try { if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath); } catch {}\n");
  fn=fn.replace(PIPE_LINE,'');
  const p0=fn.indexOf('  const lines =');
  const p1=fn.indexOf('  return result;',p0);
  if(p0<0||p1<0)fail('stdout_parser_bounds_missing');
  const replacement="  if (!fs.existsSync(resultPath)) {\n    throw new Error('drtarjomeh_containment_result_missing');\n  }\n\n  const result = readJson(resultPath);\n\n  if (!result || result.schema_version !== 'prhm.host-action-result.v1' || result.action !== 'drtarjomeh_security_containment_v1') {\n    throw new Error('drtarjomeh_containment_result_invalid');\n  }\n\n  return result;";
  fn=fn.slice(0,p0)+replacement+fn.slice(p1+'  return result;'.length);
  if(count(fn,"'--pipe'")!==0)fail('pipe_still_present');
  if(count(fn,RESULT_PATH)!==1)fail('result_path_count:'+count(fn,RESULT_PATH));
  if(count(fn,"readJson(resultPath)")!==1)fail('result_reader_count:'+count(fn,"readJson(resultPath)"));
  return source.slice(0,start)+fn+source.slice(end+2);
}
function syntaxCheck(source){const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:source,encoding:'utf8',maxBuffer:1024*1024});if(r.error)fail('syntax_error:'+r.error.message);if(r.status!==0)fail('syntax_failed:'+String(r.stderr||'').slice(0,800))}
function buildPlan(){
  if(process.getuid&&process.getuid()!==0)fail('must_run_as_root');
  const st=fs.lstatSync(TARGET); if(!st.isFile()||st.isSymbolicLink())fail('unsafe_target');
  const before=fs.readFileSync(TARGET); const beforeSha=sha(before); if(beforeSha!==EXPECTED_SHA)fail('source_sha_mismatch:'+beforeSha);
  const patchedText=patchExecutorSource(before.toString('utf8')); syntaxCheck(patchedText);
  const after=Buffer.from(patchedText,'utf8'); return {st,before,beforeSha,after,afterSha:sha(after)};
}
function ts(){return new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+crypto.randomBytes(4).toString('hex')}
function atomicWrite(file,bytes,mode,uid,gid){const tmp=file+'.drt-runner-repair-'+process.pid+'-'+Date.now()+'.tmp';const fd=fs.openSync(tmp,'wx',mode);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.chmodSync(tmp,mode);fs.chownSync(tmp,uid,gid);fs.renameSync(tmp,file)}
function systemctl(args){const r=cp.spawnSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});if(r.error)fail('systemctl_error:'+r.error.message);if(r.status!==0)fail('systemctl_failed:'+args.join('_')+':'+String(r.stderr||r.stdout||'').slice(0,800));return r}
function socketHealth(){return new Promise(resolve=>{const req=http.request({socketPath:SOCKET,path:'/health',method:'GET',timeout:2000},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));resolve(res.statusCode===200&&body&&body.ok===true?body:null)}catch{resolve(null)}})});req.on('timeout',()=>req.destroy());req.on('error',()=>resolve(null));req.end()})}
function sleep(ms){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}
async function waitHealth(){for(let i=0;i<50;i++){const active=cp.spawnSync('/usr/bin/systemctl',['is-active','--quiet',SERVICE],{timeout:5000});if(active.status===0&&fs.existsSync(SOCKET)){const h=await socketHealth();if(h)return h}sleep(200)}fail('executor_health_not_ready')}
async function main(){
  const args=process.argv.slice(2); if(args.length>1||(args.length===1&&args[0]!=='--preflight-only'))fail('unexpected_arguments');
  const plan=buildPlan();
  if(args[0]==='--preflight-only'){console.log(JSON.stringify({ok:true,schema_version:'prhm.host-action-remediation-preflight.v1',action:ACTION,preflight_only:true,source_sha256_before:plan.beforeSha,source_sha256_after:plan.afterSha,pipe_transport_delta:-1,result_file_transport_delta:1,service_restart:false,production_application_mutation:false,database_mutation:false}));return}
  const backup=BACKUP_PREFIX+ts()+'.js'; fs.copyFileSync(TARGET,backup,fs.constants.COPYFILE_EXCL);fs.chmodSync(backup,0o600);if(sha(fs.readFileSync(backup))!==plan.beforeSha)fail('backup_sha_mismatch');
  let wrote=false;
  try{atomicWrite(TARGET,plan.after,plan.st.mode&0o777,plan.st.uid,plan.st.gid);wrote=true;if(sha(fs.readFileSync(TARGET))!==plan.afterSha)fail('post_write_sha_mismatch');systemctl(['restart',SERVICE]);const health=await waitHealth();console.log(JSON.stringify({ok:true,schema_version:'prhm.host-action-remediation-result.v1',action:ACTION,installed:true,backup,source_sha256_before:plan.beforeSha,source_sha256_after:plan.afterSha,pipe_transport_delta:-1,result_file_transport_delta:1,service_restart:true,service_active:'active',executor_health:{ok:health.ok===true},production_application_mutation:false,database_mutation:false,rollback:{performed:false}}))}
  catch(error){let rollback=false,rollbackError=null;if(wrote){try{atomicWrite(TARGET,fs.readFileSync(backup),plan.st.mode&0o777,plan.st.uid,plan.st.gid);systemctl(['restart',SERVICE]);await waitHealth();rollback=true}catch(rb){rollbackError=String(rb&& (rb.stack||rb.message||rb)).slice(0,1000)}}throw new Error(String(error&& (error.message||error))+';rollback='+rollback+(rollbackError?';rollback_error='+rollbackError:''))}
}
module.exports={patchExecutorSource,buildPlan};
if(require.main===module){main().catch(e=>{process.stderr.write(String(e&& (e.stack||e))+'\n');process.exit(1)})}
