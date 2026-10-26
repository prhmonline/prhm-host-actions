'use strict';
// Explicit Level-4 only. Production deployment of the fixed MCP offsite verifier.
// PINNED to Git HEAD and existing preimage. No database/backup/Drive modifications.
const fs=require('node:fs'),crypto=require('node:crypto'),cp=require('node:child_process'),path=require('node:path');
const {TARGET,plan,hash}=require('./central-offsite-rclone-proof-v1.js');
const REPO='prhmonline/prhm-host-actions',BRANCH='fix/central-offsite-rclone-proof-v1';
const UNITS=[
 {service:'prhm-agent-mcp-green.service',port:8125},
 {service:'prhm-agent-mcp-blue.service',port:8124},
 {service:'prhm-agent-mcp-safe-delivery-candidate.service',port:8132}
];
const ROUTER=8123;
const LOG_ROOT='/var/log/prhm-deployments/central-offsite-rclone-proof-v1';
function cmd(bin,args,timeout=20000){
  const r=cp.spawnSync(bin,args,{encoding:'utf8',timeout,maxBuffer:200000});
  if(r.error||r.status!==0)throw Error('EXEC_FAILED:'+path.basename(bin)+':'+String(r.error?.code||r.status));
  return String(r.stdout||'').trim();
}
const git=args=>cmd('/usr/bin/git',['-C',path.resolve(__dirname,'..'),...args]);
function healthy(port){
  const data=cmd('/usr/bin/curl',['-sS','--fail','--max-time','4','http://127.0.0.1:'+port+'/health'],7000);
  const response=JSON.parse(data);
  if(response.ok!==true && response.status!=='ok')throw Error('HEALTH_BODY_INVALID:'+port);
  return true;
}
function waitHealth(port){
  let last='';for(let i=0;i<12;i++){
    try{healthy(port);return}catch(e){last=String(e.message||e);if(i<11)cmd('/usr/bin/sleep',['1'],1500)}
  }
  throw Error('HEALTH_TIMEOUT:'+port+':'+last);
}
function serviceState(unit){
  const s=cmd('/usr/bin/systemctl',['show',unit.service,'-p','ActiveState','-p','MainPID','--no-pager']);
  const status=(s.match(/^ActiveState=(\S+)/m)||[])[1],pid=Number((s.match(/^MainPID=(\d+)/m)||[])[1]||0);
  if(status!=='active'||pid<1)throw Error('SERVICE_NOT_ACTIVE:'+unit.service);
  healthy(unit.port);return {service:unit.service,port:unit.port,pid};
}
function preflight(){
  if(git(['status','--porcelain']))throw Error('WORKTREE_DIRTY');
  const commit=git(['rev-parse','HEAD']);
  const st=fs.lstatSync(TARGET);
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||st.gid!==0)throw Error('LIVE_TARGET_METADATA_INVALID');
  const p=plan(fs.readFileSync(TARGET,'utf8'));
  const services=UNITS.map(serviceState);healthy(ROUTER);
  return {repository:REPO,branch:BRANCH,commit_sha:commit,target:TARGET,old_sha256:p.preimage_sha256,new_sha256:p.postimage_sha256,services,router_health:true,production_mutation:false,change_count:p.change_count};
}
function writeLog(entry){
  fs.mkdirSync(LOG_ROOT,{recursive:true,mode:0o700});fs.chmodSync(LOG_ROOT,0o700);
  const dest=path.join(LOG_ROOT,entry.started_at.replace(/[:.]/g,'-')+'-'+entry.commit_sha.slice(0,12)+'.json');
  const tmp=dest+'.tmp';fs.writeFileSync(tmp,JSON.stringify(entry,null,2)+'\n',{flag:'wx',mode:0o600});
  fs.renameSync(tmp,dest);return dest;
}
function release(expectedSha,confirmation){
  if(confirmation!=='CONFIRM_LEVEL_4_CRITICAL')throw Error('LEVEL4_EXPLICIT_APPROVAL_REQUIRED');
  if(!/^[0-9a-f]{40}$/.test(expectedSha))throw Error('EXACT_COMMIT_REQUIRED');
  const pf=preflight();
  if(pf.commit_sha!==expectedSha||git(['rev-parse','origin/'+BRANCH])!==expectedSha)throw Error('PINNED_GIT_REF_MISMATCH');
  const p=plan(fs.readFileSync(TARGET,'utf8'));
  const st=fs.statSync(TARGET),id=crypto.randomUUID(),now=new Date().toISOString();
  const backup=TARGET+'.pre-'+p.preimage_sha256.slice(0,16)+'-'+id+'.bak';
  const staged=TARGET+'.candidate-'+id+'.tmp';
  const rbTemp=TARGET+'.rollback-'+id+'.tmp';
  const touched=[];
  let altered=false,rollback=false,rollbackError=null,result='FAILED',error=null;
  try{
    fs.copyFileSync(TARGET,backup,fs.constants.COPYFILE_EXCL);
    fs.chmodSync(backup,0o600);
    if(hash(fs.readFileSync(backup))!==p.preimage_sha256)throw Error('BACKUP_SHA_MISMATCH');
    fs.writeFileSync(staged,p.postimage,{flag:'wx',mode:st.mode&0o777});
    fs.chownSync(staged,st.uid,st.gid);
    if(hash(fs.readFileSync(staged))!==p.postimage_sha256)throw Error('CANDIDATE_SHA_MISMATCH');
    fs.renameSync(staged,TARGET);altered=true;
    if(hash(fs.readFileSync(TARGET))!==p.postimage_sha256)throw Error('POSTIMAGE_SHA_MISMATCH');
    for(const unit of UNITS){
      touched.push(unit);
      cmd('/usr/bin/systemctl',['restart',unit.service],50000);
      waitHealth(unit.port);
      healthy(ROUTER);
      const cur=serviceState(unit);
      if(cur.pid===pf.services.find(x=>x.service===unit.service).pid)throw Error('UNCHANGED_PID:'+unit.service);
    }
    result='SUCCEEDED';
  }catch(e){
    error=String(e.message||e);
    if(altered)try{
      if(hash(fs.readFileSync(backup))!==p.preimage_sha256)throw Error('BACKUP_INTEGRITY_FAILED');
      if(hash(fs.readFileSync(TARGET))!==p.postimage_sha256)throw Error('UNEXPECTED_LIVE_SHA_ON_ROLLBACK');
      fs.copyFileSync(backup,rbTemp,fs.constants.COPYFILE_EXCL);
      fs.chownSync(rbTemp,st.uid,st.gid);fs.chmodSync(rbTemp,st.mode&0o777);
      fs.renameSync(rbTemp,TARGET);
      for(const unit of touched){cmd('/usr/bin/systemctl',['restart',unit.service],50000);waitHealth(unit.port)}
      healthy(ROUTER);
      if(hash(fs.readFileSync(TARGET))!==p.preimage_sha256)throw Error('ROLLBACK_SHA_MISMATCH');
      rollback=true;
    }catch(e){rollbackError=String(e.message||e)}
  }finally{
    for(const f of [staged,rbTemp])try{if(fs.existsSync(f))fs.unlinkSync(f)}catch{}
  }
  const ev={schema:'prhm.central-offsite-rclone-proof-deploy.v1',started_at:now,finished_at:new Date().toISOString(),repository:REPO,branch:BRANCH,commit_sha:expectedSha,destination:TARGET,preimage_sha256:p.preimage_sha256,postimage_sha256:p.postimage_sha256,backup_path:backup,services:UNITS.map(x=>x.service),touched:touched.map(x=>x.service),result,rollback,rollback_error:rollbackError,error};
  ev.logger=writeLog(ev);console.log(JSON.stringify(ev,null,2));
  if(result!=='SUCCEEDED')process.exitCode=1;
}
if(require.main===module){
  try{
    const a=process.argv.slice(2);
    if(a.length===1&&a[0]==='--preflight')console.log(JSON.stringify(preflight(),null,2));
    else if(a.length===3&&a[0]==='--apply')release(a[1],a[2]);
    else throw Error('USAGE_PREPARE_ONLY: --preflight OR --apply EXACT_SHA CONFIRM_LEVEL_4_CRITICAL');
  }catch(e){console.error(String(e.message||e));process.exitCode=2}
}
module.exports={preflight};
