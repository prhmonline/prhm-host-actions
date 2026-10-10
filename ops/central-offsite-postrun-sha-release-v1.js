'use strict';
// Fixed-purpose, Git-pinned central offsite postrun repair.
// Does not touch backup data, Google Drive, DBs or unrelated services.
const fs=require('node:fs');
const cp=require('node:child_process');
const path=require('node:path');
const crypto=require('node:crypto');
const {plan,hash,TARGET}=require('./central-offsite-postrun-sha-fix-v1.js');

const SERVICE='prhm-agent-selfmaint-exec.service';
const HEALTH_SOCKET='/run/prhm-agent-selfmaint-exec/exec.sock';
const LOG_ROOT='/var/log/prhm-deployments/central-offsite-postrun-sha-v1';
const REPO_NAME='prhmonline/prhm-host-actions';
const BRANCH_NAME='fix/central-offsite-postrun-evidence-sha-v1';
const SHA_RE=/^[0-9a-f]{40}$/;
function exec(bin,args,timeout=30000){
  const result=cp.spawnSync(bin,args,{encoding:'utf8',timeout,maxBuffer:300000});
  if(result.error||result.status!==0)throw Error('COMMAND_FAILED:'+path.basename(bin)+':'+String(result.error?.code||result.status));
  return String(result.stdout||'').trim();
}
function git(args){return exec('/usr/bin/git',['-C',path.resolve(__dirname,'..'),...args]);}
function currentHead(){return git(['rev-parse','HEAD']);}
function fileSha(file){return hash(fs.readFileSync(file));}
function checkLiveTarget(){
  const st=fs.lstatSync(TARGET);
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||st.mode%4096!==0o644)throw Error('UNSAFE_TARGET_METADATA');
  const old=fs.readFileSync(TARGET,'utf8');
  const result=plan(old);
  return {old,st,plan:result};
}
function checkService(){
  if(exec('/usr/bin/systemctl',['is-active',SERVICE])!=='active')throw Error('SELFMAINT_SERVICE_NOT_ACTIVE');
  const state=exec('/usr/bin/systemctl',['show',SERVICE,'-p','MainPID','-p','ActiveState','--no-pager']);
  const pid=Number((state.match(/^MainPID=(\d+)$/m)||[])[1]||0);
  if(pid<=0)throw Error('SELFMAINT_SERVICE_MISSING_PID');
  return {pid};
}
function socketHealth(){
  const data=exec('/usr/bin/curl',['--silent','--show-error','--fail','--max-time','4','--unix-socket',HEALTH_SOCKET,'http://localhost/health'],8000);
  const response=JSON.parse(data);
  if(response.ok!==true||response.service!=='prhm-agent-selfmaint-exec')throw Error('SELFMAINT_HEALTH_API_BAD_RESPONSE');
  return {ok:true,service:response.service,version:String(response.version||'').slice(0,120)};
}
function waitSocketHealth(){
  let last='';
  for(let attempt=0;attempt<10;attempt++){
    try{return socketHealth()}catch(e){last=String(e.message||e);if(attempt<9)exec('/usr/bin/sleep',['1'],2000)}
  }
  throw Error('SELFMAINT_HEALTH_API_TIMEOUT:'+last);
}
function preflight(){
  if(git(['status','--porcelain']).trim())throw Error('GIT_WORKTREE_NOT_CLEAN');
  const h=currentHead();
  if(!SHA_RE.test(h))throw Error('INVALID_GIT_HEAD');
  const {plan:p}=checkLiveTarget();
  const service=checkService(),api=socketHealth();
  return {repo:REPO_NAME,branch:BRANCH_NAME,head_sha:h,target:TARGET,old_sha256:p.old_sha256,new_sha256:p.new_sha256,service,api,change_count:1,production_mutation:false};
}
function writeLog(rec){
  fs.mkdirSync(LOG_ROOT,{recursive:true,mode:0o700});
  fs.chmodSync(LOG_ROOT,0o700);
  const name=rec.started_at.replace(/[:.]/g,'-')+'-'+rec.commit_sha.slice(0,12)+'.json';
  const dest=path.join(LOG_ROOT,name);
  const tmp=dest+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(rec,null,2)+'\n',{flag:'wx',mode:0o600});
  fs.renameSync(tmp,dest);
  return dest;
}
function apply(expectedCommit,confirmation){
  if(confirmation!=='CONFIRM_LEVEL_4_CRITICAL')throw Error('LEVEL4_CONFIRMATION_REQUIRED');
  if(!SHA_RE.test(expectedCommit))throw Error('EXACT_COMMIT_SHA_REQUIRED');
  const pf=preflight();
  if(pf.head_sha!==expectedCommit)throw Error('PINNED_COMMIT_MISMATCH');
  const {st,plan:p}=checkLiveTarget();
  const id=crypto.randomUUID();
  const started_at=new Date().toISOString();
  const backup=TARGET+'.pre-'+p.old_sha256.slice(0,16)+'-'+id+'.bak';
  const tmp=TARGET+'.candidate-'+id+'.tmp';
  const restoreTmp=TARGET+'.restore-'+id+'.tmp';
  let altered=false,rollback=false,rollback_error=null,result='FAILED',cause=null;
  try{
    fs.copyFileSync(TARGET,backup,fs.constants.COPYFILE_EXCL);
    fs.chmodSync(backup,st.mode&0o777);
    if(fileSha(backup)!==p.old_sha256)throw Error('BACKUP_INTEGRITY_FAIL');
    fs.writeFileSync(tmp,p.patch_content,{flag:'wx',mode:st.mode&0o777});
    fs.chownSync(tmp,st.uid,st.gid);
    if(fileSha(tmp)!==p.new_sha256)throw Error('STAGED_SHA_FAIL');
    fs.renameSync(tmp,TARGET);
    altered=true;
    if(fileSha(TARGET)!==p.new_sha256)throw Error('DEPLOY_SHA_FAIL');
    exec('/usr/bin/systemctl',['restart',SERVICE],45000);
    if(exec('/usr/bin/systemctl',['is-active',SERVICE])!=='active')throw Error('SERVICE_HEALTH_FAIL');
    const live=checkService();
    waitSocketHealth();
    if(live.pid===pf.service.pid)throw Error('SERVICE_PID_UNCHANGED');
    if(fileSha(TARGET)!==p.new_sha256)throw Error('DEPLOY_SHA_DRIFT');
    result='SUCCEEDED';
  }catch(e){
    cause=String(e.message||e);
    if(altered){
      try{
        if(fileSha(backup)!==p.old_sha256)throw Error('ROLLBACK_BACKUP_SHA_FAIL');
        if(fileSha(TARGET)!==p.new_sha256)throw Error('ROLLBACK_LIVE_SHA_UNEXPECTED');
        fs.copyFileSync(backup,restoreTmp,fs.constants.COPYFILE_EXCL);
        fs.chownSync(restoreTmp,st.uid,st.gid);
        fs.chmodSync(restoreTmp,st.mode&0o777);
        fs.renameSync(restoreTmp,TARGET);
        exec('/usr/bin/systemctl',['restart',SERVICE],45000);
        if(fileSha(TARGET)!==p.old_sha256)throw Error('ROLLBACK_SHA_FAIL');
        checkService();
        waitSocketHealth();
        rollback=true;
      }catch(re){rollback_error=String(re.message||re)}
    }
  }finally{
    for(const filename of [tmp,restoreTmp])try{if(fs.existsSync(filename))fs.unlinkSync(filename)}catch{}
  }
  const evidence={schema:'prhm.central-offsite-postrun-sha-release.v1',started_at,finished_at:new Date().toISOString(),repo:REPO_NAME,branch:BRANCH_NAME,commit_sha:expectedCommit,destination:TARGET,service:SERVICE,preimage_sha256:p.old_sha256,postimage_sha256:p.new_sha256,backup_path:backup,result,rollback,rollback_error,reason:cause};
  evidence.logger_path=writeLog(evidence);
  console.log(JSON.stringify(evidence,null,2));
  if(result!=='SUCCEEDED')process.exitCode=1;
}
if(require.main===module){
  try{
    const args=process.argv.slice(2);
    if(args.length===1&&args[0]==='--preflight')console.log(JSON.stringify(preflight(),null,2));
    else if(args.length===3&&args[0]==='--apply')apply(args[1],args[2]);
    else throw Error('USAGE: --preflight OR --apply EXACT_SHA CONFIRM_LEVEL_4_CRITICAL');
  }catch(e){console.error(String(e.message||e));process.exitCode=2}
}
module.exports={preflight,checkLiveTarget};
