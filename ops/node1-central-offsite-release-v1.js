'use strict';
// Exact-commit release of fixed Node1 encrypted central offsite timer, after real remote restore PASS.
// This action never changes SSHD/backup repos/DBs, never prunes and reverts its own unit installation.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto');
const REPO_ROOT=path.resolve(__dirname,'..');
const ACTION='prhm-node1-central-offsite';
const SERVICE=ACTION+'.service',TIMER=ACTION+'.timer';
const LOG='/var/log/prhm-deployments/node1-central-offsite-v1';
const SOURCE=[
 {file:path.join(__dirname,'prhm-node1-central-offsite-v1.sh'),target:'/usr/local/sbin/'+ACTION,mode:0o700},
 {file:path.join(REPO_ROOT,'systemd',SERVICE),target:'/etc/systemd/system/'+SERVICE,mode:0o644},
 {file:path.join(REPO_ROOT,'systemd',TIMER),target:'/etc/systemd/system/'+TIMER,mode:0o644}
];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function run(bin,args,timeout=12000){
 const x=cp.spawnSync(bin,args,{encoding:'utf8',timeout,maxBuffer:200000});
 if(x.error||x.status!==0)throw Error('COMMAND_FAILED:'+path.basename(bin)+':'+String(x.error?.code||x.status));
 return String(x.stdout||'').trim();
}
const git=args=>run('/usr/bin/git',['-C',REPO_ROOT,...args]);
const systemctl=args=>run('/usr/bin/systemctl',args,30000);
function preflight(){
 const commit=git(['rev-parse','HEAD']);
 if(!/^[a-f0-9]{40}$/.test(commit)||git(['status','--porcelain']))throw Error('UNSAFE_GIT_WORKTREE');
 if(git(['rev-parse','origin/ops/backup-storage-plan-v1'])!==commit)throw Error('GIT_REMOTE_NOT_MATCHING');
 for(const f of SOURCE)if(fs.existsSync(f.target))throw Error('DEPLOY_PREIMAGE_NOT_EMPTY:'+f.target);
 const evidence=JSON.parse(fs.readFileSync('/var/lib/prhm-backup/node1-central/latest.json','utf8'));
 const finished=Date.parse(evidence.finished_utc);
 if(evidence.status!=='PASS'||evidence.full_restore_ok!==true||
    evidence.encrypted_offsite_backup_ok!==true||evidence.exit_code!==0||
    !/^[a-f0-9]{64}$/.test(evidence.restic_snapshot_id||'')||
    !Number.isFinite(finished)||Date.now()-finished>3*3600*1000)throw Error('MISSING_FRESH_SUCCESSFUL_REMOTE_RESTORE');
 if(systemctl(['is-active','prhm-production-central-offsite-backup.timer'])!=='active')throw Error('EXISTING_BACKUP_TIMER_NOT_ACTIVE');
 const checks=SOURCE.map(x=>({dest:x.target,sha256:hash(fs.readFileSync(x.file))}));
 return {ok:true,commit,snapshot:evidence.snapshot,source_sha256:checks,run_approved:false,mutation:false};
}
function release(commit,confirm){
 if(confirm!=='CONFIRM_LEVEL_4_CRITICAL'||!/^[a-f0-9]{40}$/.test(commit))throw Error('LEVEL4_AND_SHA_REQUIRED');
 const pf=preflight();
 if(commit!==pf.commit)throw Error('DEPLOY_SHA_MISMATCH');
 const installed=[],started=new Date().toISOString(),id=crypto.randomUUID();
 let result='FAILED',error=null,rolledBack=false;
 try{
  for(const x of SOURCE){
   const staging=x.target+'.candidate-'+id;
   fs.copyFileSync(x.file,staging,fs.constants.COPYFILE_EXCL);
   fs.chmodSync(staging,x.mode);
   if(hash(fs.readFileSync(staging))!==hash(fs.readFileSync(x.file)))throw Error('CANDIDATE_BYTES_MISMATCH');
   fs.renameSync(staging,x.target);
   installed.push(x);
  }
  systemctl(['daemon-reload']);
  systemctl(['enable',TIMER]);
  systemctl(['start',TIMER]);
  if(systemctl(['is-active',TIMER])!=='active')throw Error('SCHEDULE_TIMER_NOT_ACTIVE');
  if(systemctl(['is-enabled',TIMER])!=='enabled')throw Error('SCHEDULE_TIMER_NOT_ENABLED');
  for(const x of SOURCE)if(hash(fs.readFileSync(x.target))!==hash(fs.readFileSync(x.file)))throw Error('INSTALLED_FILE_DRIFT');
  result='SUCCEEDED';
 }catch(e){
  error=String(e.message||e);
  try{
   try{systemctl(['stop',TIMER])}catch{}
   try{systemctl(['disable',TIMER])}catch{}
   for(const x of installed)if(fs.existsSync(x.target)&&hash(fs.readFileSync(x.target))===hash(fs.readFileSync(x.file)))fs.unlinkSync(x.target);
   systemctl(['daemon-reload']);
   rolledBack=true;
  }catch(re){error+=';ROLLBACK_ERROR:'+String(re.message||re)}
 }
 const log={schema:'prhm.node1-central-offsite-deploy.v1',started_at:started,finished_at:new Date().toISOString(),
  repo:'prhmonline/prhm-host-actions',branch:'ops/backup-storage-plan-v1',commit_sha:commit,
  destination:'prhm-production.prhm.ir',restore_proof:pf.snapshot,installed_files:installed.map(x=>x.target),
  result,rollback:rolledBack,error,timer_enabled:result==='SUCCEEDED'};
 fs.mkdirSync(LOG,{recursive:true,mode:0o700});fs.chmodSync(LOG,0o700);
 const file=path.join(LOG,started.replace(/[:.]/g,'-')+'-'+commit.slice(0,12)+'.json');
 const tmp=file+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(log,null,2)+'\n',{flag:'wx',mode:0o600});
 fs.renameSync(tmp,file);log.log_path=file;
 console.log(JSON.stringify(log,null,2));
 if(result!=='SUCCEEDED')process.exitCode=1;
}
if(require.main===module){
 try{
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--preflight')console.log(JSON.stringify(preflight(),null,2));
  else if(args.length===3&&args[0]==='--apply')release(args[1],args[2]);
  else throw Error('FIXED_RELEASE_USAGE_ONLY');
 }catch(e){console.error(String(e.message||e));process.exitCode=2}
}
module.exports={preflight};
