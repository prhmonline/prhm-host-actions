#!/usr/local/bin/prhm-node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const http=require('node:http');

const ACTION='drtarjomeh_containment_dispatcher_repair_v1';
const TARGET='/opt/prhm-agent-selfmaint-exec/server.js';
const SERVICE='prhm-agent-selfmaint-exec.service';
const SOCKET='/run/prhm-agent-selfmaint-exec/exec.sock';
const EXPECTED_SHA256='32db60b30af5abbd59b09023925c7817b5258bbdf02c0c75aa32ed976d6debdf';
const BACKUP_PREFIX='/var/backups/drtarjomeh-containment-dispatcher-repair-v1-';
const ROUTE="if(action==='drtarjomeh_security_containment_v1')return applyDrTarjomehSecurityContainmentV1();";
const ANCHOR="applyHostActionV2=async function(action){if(action==='agent_zdt_existing_topology_rolling_refresh_v1')return applyAgentZdtExistingTopologyRollingApplyV1();";
const SPEC="drtarjomeh_security_containment_v1: { operation: 'host_action.drtarjomeh_security_containment_v1', kind: 'drtarjomeh_security_containment_v1' }";
const HELPER='async function applyDrTarjomehSecurityContainmentV1()';

function fail(message){throw new Error(message);}
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function count(haystack,needle){return haystack.split(needle).length-1;}

function patchExecutorSource(source){
  if(typeof source!=='string'||source.length===0)fail('source_missing');
  const helperCount=count(source,HELPER);
  if(helperCount!==1)fail('helper_count:'+helperCount);
  const specCount=count(source,SPEC);
  if(specCount!==1)fail('action_spec_count:'+specCount);
  const routeCount=count(source,ROUTE);
  if(routeCount!==0)fail('route_already_present:'+routeCount);
  const anchorCount=count(source,ANCHOR);
  if(anchorCount!==1)fail('dispatcher_anchor_count:'+anchorCount);
  const patched=source.replace(ANCHOR,ANCHOR+ROUTE);
  if(count(patched,ROUTE)!==1)fail('patched_route_count_invalid');
  if(count(patched,HELPER)!==1)fail('patched_helper_count_invalid');
  if(count(patched,SPEC)!==1)fail('patched_action_spec_count_invalid');
  return patched;
}

function syntaxCheck(source){
  const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:source,encoding:'utf8',maxBuffer:1024*1024});
  if(r.error)fail('syntax_check_error:'+r.error.message);
  if(r.status!==0)fail('syntax_check_failed:'+String(r.stderr||'').slice(0,800));
}

function buildPlan(){
  if(process.getuid&&process.getuid()!==0)fail('must_run_as_root');
  const st=fs.lstatSync(TARGET);
  if(!st.isFile()||st.isSymbolicLink())fail('unsafe_target');
  const before=fs.readFileSync(TARGET);
  const beforeSha=sha(before);
  if(beforeSha!==EXPECTED_SHA256)fail('source_sha_mismatch:'+beforeSha);
  const patchedText=patchExecutorSource(before.toString('utf8'));
  syntaxCheck(patchedText);
  const after=Buffer.from(patchedText,'utf8');
  return {st,before,beforeSha,after,afterSha:sha(after)};
}

function timestamp(){return new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+crypto.randomBytes(4).toString('hex');}
function atomicWrite(file,bytes,mode,uid,gid){
  const tmp=file+'.drtarjomeh-dispatch-repair-'+process.pid+'-'+Date.now()+'.tmp';
  const fd=fs.openSync(tmp,'wx',mode);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.chmodSync(tmp,mode);fs.chownSync(tmp,uid,gid);fs.renameSync(tmp,file);
}
function systemctl(args){
  const r=cp.spawnSync('/usr/bin/systemctl',args,{encoding:'utf8',maxBuffer:1024*1024,timeout:60000});
  if(r.error)fail('systemctl_error:'+r.error.message);
  if(r.status!==0)fail('systemctl_failed:'+args.join('_')+':'+String(r.stderr||r.stdout||'').slice(0,800));
  return r;
}
function sleep(ms){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);}
function isActive(){const r=cp.spawnSync('/usr/bin/systemctl',['is-active','--quiet',SERVICE],{timeout:5000});return r.status===0;}
function socketHealth(){
  return new Promise(resolve=>{
    const req=http.request({socketPath:SOCKET,path:'/health',method:'GET',timeout:2000},res=>{
      const chunks=[];let bytes=0;
      res.on('data',c=>{bytes+=c.length;if(bytes<=262144)chunks.push(c);});
      res.on('end',()=>{
        if(bytes>262144)return resolve(null);
        try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));resolve(res.statusCode===200&&body&&body.ok===true?body:null);}catch{resolve(null);}
      });
    });
    req.on('timeout',()=>req.destroy());req.on('error',()=>resolve(null));req.end();
  });
}
async function waitHealth(){
  for(let i=0;i<50;i++){
    if(isActive()&&fs.existsSync(SOCKET)){
      const h=await socketHealth();if(h)return h;
    }
    sleep(200);
  }
  fail('executor_health_not_ready');
}

async function main(){
  const args=process.argv.slice(2);
  if(args.length>1||(args.length===1&&args[0]!=='--preflight-only'))fail('unexpected_arguments');
  const plan=buildPlan();
  if(args[0]==='--preflight-only'){
    console.log(JSON.stringify({ok:true,schema_version:'prhm.host-action-remediation-preflight.v1',action:ACTION,preflight_only:true,source_sha256_before:plan.beforeSha,source_sha256_after:plan.afterSha,dispatcher_route_delta:1,service_restart:false,production_application_mutation:false,database_mutation:false}));
    return;
  }
  const backup=BACKUP_PREFIX+timestamp()+'.js';
  fs.copyFileSync(TARGET,backup,fs.constants.COPYFILE_EXCL);fs.chmodSync(backup,0o600);
  if(sha(fs.readFileSync(backup))!==plan.beforeSha)fail('backup_sha_mismatch');
  let wrote=false;
  try{
    atomicWrite(TARGET,plan.after,plan.st.mode&0o777,plan.st.uid,plan.st.gid);wrote=true;
    if(sha(fs.readFileSync(TARGET))!==plan.afterSha)fail('post_write_sha_mismatch');
    systemctl(['restart',SERVICE]);
    const health=await waitHealth();
    const active=systemctl(['is-active',SERVICE]).stdout.trim();
    console.log(JSON.stringify({ok:true,schema_version:'prhm.host-action-remediation-result.v1',action:ACTION,installed:true,backup,source_sha256_before:plan.beforeSha,source_sha256_after:plan.afterSha,dispatcher_route_delta:1,service_restart:true,service_active:active,executor_health:{ok:health.ok===true},production_application_mutation:false,database_mutation:false,rollback:{performed:false}}));
  }catch(error){
    let rollback=false,rollbackError=null;
    if(wrote){
      try{
        atomicWrite(TARGET,fs.readFileSync(backup),plan.st.mode&0o777,plan.st.uid,plan.st.gid);
        if(sha(fs.readFileSync(TARGET))!==plan.beforeSha)fail('rollback_sha_mismatch');
        systemctl(['restart',SERVICE]);await waitHealth();rollback=true;
      }catch(rb){rollbackError=String(rb&& (rb.stack||rb.message||rb)).slice(0,1000);}
    }
    throw new Error(String(error&& (error.message||error))+';rollback='+rollback+(rollbackError?';rollback_error='+rollbackError:''));
  }
}

module.exports={patchExecutorSource,buildPlan};
if(require.main===module){main().catch(e=>{process.stderr.write(String(e&& (e.stack||e))+'\n');process.exit(1);});}
