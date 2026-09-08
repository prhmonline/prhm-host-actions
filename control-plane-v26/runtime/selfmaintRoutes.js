'use strict';
const fs=require('fs');
const path=require('path');
const http=require('http');
const crypto=require('crypto');
const cp=require('child_process');

const BASE_SHA='01e11a69b4c5a110aad16d4ee71efd11bdd6c52c6594d09117b5d4bb339ace20';
const HERE=__dirname;
const BASE_FILE=path.join(HERE,`.selfmaintRoutes-base-fixed-refresh-base-${BASE_SHA}.cjs`);
const BACKUP_ROOT='/var/backups/prhm-agent-selfmaint';
const REFRESH_ROUTE='/selfmaint/base-fixed-refresh-v1';
const REFRESH_SERVICE='prhm-agent-selfmaint.service';
const BASE_RUNTIME_PATH='/opt/prhm-agent-selfmaint/server.js';
const BASE_RUNTIME_SHA='a23b4fec52123f8ad484f31576281c2f1933f24a3c811cd98c28e764a292e315';
const EXPECTED_PID=4015906;
const REFRESH_SOCKET='/run/prhm-agent-selfmaint/selfmaint.sock';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');

function fail(code){const e=new Error(code);e.policy=true;throw e;}
function ensureBase(){
  try{if(digest(fs.readFileSync(BASE_FILE))===BASE_SHA)return;}catch{}
  const prefix='agent_api-selfmaintRoutes.js-';
  const suffix='-'+BASE_SHA+'.bak';
  const names=fs.readdirSync(BACKUP_ROOT).filter(n=>n.startsWith(prefix)&&n.endsWith(suffix)).sort().reverse();
  if(!names.length)fail('selfmaint_base_refresh_api_base_backup_missing');
  const bytes=fs.readFileSync(path.join(BACKUP_ROOT,names[0]));
  if(digest(bytes)!==BASE_SHA)fail('selfmaint_base_refresh_api_base_sha_mismatch');
  const tmp=BASE_FILE+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,BASE_FILE);
  fs.chmodSync(BASE_FILE,0o600);
}
function currentPid(){
  const raw=cp.execFileSync('/usr/bin/systemctl',['show',REFRESH_SERVICE,'-p','MainPID','--value'],{encoding:'utf8',timeout:10000}).trim();
  const pid=Number(raw);
  if(!Number.isInteger(pid)||pid<=0)fail('selfmaint_base_refresh_pid_invalid');
  return pid;
}
function serviceActive(){
  return cp.execFileSync('/usr/bin/systemctl',['is-active',REFRESH_SERVICE],{encoding:'utf8',timeout:10000}).trim()==='active';
}
function healthOk(){
  return new Promise((resolve,reject)=>{
    const q=http.request({socketPath:REFRESH_SOCKET,path:'/health',method:'GET'},r=>{
      let size=0;const chunks=[];
      r.on('data',c=>{size+=c.length;if(size<=65536)chunks.push(c);});
      r.on('end',()=>{
        if(size>65536)return reject(new Error('selfmaint_base_refresh_health_too_large'));
        let out={};try{out=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
        catch{return reject(new Error('selfmaint_base_refresh_health_invalid_json'));}
        resolve(r.statusCode===200&&out.ok===true&&out.service==='prhm-agent-selfmaint');
      });
    });
    q.setTimeout(3000,()=>q.destroy(new Error('selfmaint_base_refresh_health_timeout')));
    q.on('error',reject);q.end();
  });
}
async function runBaseFixedRefresh(){
  const runtimeSha=digest(fs.readFileSync(BASE_RUNTIME_PATH));
  if(runtimeSha!==BASE_RUNTIME_SHA)fail('selfmaint_base_refresh_runtime_sha_drift');
  const before=currentPid();
  if(before!==EXPECTED_PID)fail('selfmaint_base_refresh_pid_drift');
  if(!serviceActive())fail('selfmaint_base_refresh_service_not_active');
  cp.execFileSync('/usr/bin/systemctl',['restart',REFRESH_SERVICE],{encoding:'utf8',timeout:30000});
  let after=0,healthy=false;
  for(let i=0;i<30;i++){
    try{after=currentPid();healthy=after!==before&&serviceActive()&&await healthOk();if(healthy)break;}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  const postSha=digest(fs.readFileSync(BASE_RUNTIME_PATH));
  if(postSha!==BASE_RUNTIME_SHA)fail('selfmaint_base_refresh_post_sha_drift');
  if(after===before||after<=0)fail('selfmaint_base_refresh_pid_not_changed');
  if(!healthy)fail('selfmaint_base_refresh_health_not_ok');
  return {ok:true,type:'selfmaint-base-fixed-refresh-v1',action:'selfmaint_base_fixed_refresh_v1',service:REFRESH_SERVICE,before_pid:before,after_pid:after,runtime_sha256:postSha,service_active:true,health_ok:true,file_mutation:false,database_mutation:false,application_mutation:false,arbitrary_input:false,one_shot:true};
}

ensureBase();
const base=require(BASE_FILE);
function registerSelfmaintRoutes(app,ctx){
  const result=base.registerSelfmaintRoutes(app,ctx);
  const auth=ctx&&ctx.auth;
  if(typeof auth!=='function')fail('selfmaint_base_refresh_auth_missing');
  app.post(REFRESH_ROUTE,auth,async(req,res)=>{
    try{
      if(req.body&&typeof req.body==='object'&&Object.keys(req.body).length)fail('selfmaint_base_refresh_zero_input_required');
      return res.json(await runBaseFixedRefresh());
    }catch(e){
      return res.status(e&&e.policy?409:500).json({ok:false,error:String(e&&e.message||e).slice(0,200),file_mutation:false,database_mutation:false,application_mutation:false});
    }
  });
  return result;
}
module.exports={...base,registerSelfmaintRoutes,__selfmaintBaseFixedRefreshTest:{BASE_SHA,BASE_RUNTIME_SHA,EXPECTED_PID,REFRESH_SERVICE,REFRESH_ROUTE}};
