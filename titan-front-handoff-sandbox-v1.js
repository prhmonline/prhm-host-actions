'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');

const ACTION='titan_front_handoff_sandbox_v1';
const PROD_ROOT='/home/fitness/domains/titanfitness-club.com/public_html';
const STATE_ROOT='/home/fitness/.titan-handoff-deploy-v2';
const SERVICE='titan-front.service';
const OLD_SHA='0d781ca811461805b28656b1765124bef664cd70';
const TARGET_SHA='1ab3d075ecf25800ded63a5d3b1b88d601161dac';
const TARGET_REF='refs/heads/fix/full-audit-2026-08-16';
const BRANCHES_SHA256='9174c929ff4cc70c58b57655d4ce103bca757dd400ef7dc00e959c3cec4acbe2';
const TARGET_FILES=Object.freeze([
  '.github/workflows/audit.yml',
  '.github/workflows/live-smoke.yml',
  'scripts/source-regression.mjs',
  'scripts/studios-regression.mjs',
  'src/components/pages/home/branches.tsx',
  'tsconfig.json'
]);
const WRITABLE_PATHS=Object.freeze([PROD_ROOT,STATE_ROOT]);
const ENV_FILES=Object.freeze(['.env','.env.local','.env.production','.env.production.local']);
const GIT='/usr/bin/git';
const RUNUSER='/usr/sbin/runuser';
const NODE='/usr/local/bin/prhm-node20';
const CURL='/usr/bin/curl';
const FIXED_ENV=Object.freeze({
  PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  HOME:'/home/fitness',
  LC_ALL:'C.UTF-8',
  GIT_TERMINAL_PROMPT:'0'
});

const sha256=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw new Error(code);};

function assertNoArguments(args){
  if(!Array.isArray(args)||args.length!==0)throw new Error('unexpected_arguments');
  return true;
}
function systemdProperties(){
  return Object.freeze([
    'Type=oneshot','UMask=0077','NoNewPrivileges=true','PrivateTmp=true',
    'PrivateDevices=true','ProtectSystem=strict','ProtectHome=read-only',
    'ProtectKernelTunables=true','ProtectKernelModules=true','ProtectControlGroups=true',
    'RestrictNamespaces=true',
    'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','CapabilityBoundingSet=',
    'AmbientCapabilities=','ReadWritePaths='+PROD_ROOT,'ReadWritePaths='+STATE_ROOT
  ]);
}
function contract(){
  return Object.freeze({
    schema_version:'prhm.titan-front-handoff-sandbox.contract.v1',
    action:ACTION,production_root:PROD_ROOT,state_root:STATE_ROOT,service:SERVICE,
    old_sha:OLD_SHA,target_sha:TARGET_SHA,target_ref:TARGET_REF,
    branches_sha256:BRANCHES_SHA256,target_files:[...TARGET_FILES],
    writable_paths:[...WRITABLE_PATHS],database_mutation:false,arbitrary_command:false,
    arbitrary_path:false,arbitrary_revision:false,arbitrary_host:false,
    credential_input:false,rollback:'automatic',
    pre_cutover_gates:['source_regression','studios_regression','lint','build','target_sha','branches_sha256'],
    post_cutover_gates:['service_active','local_smoke','public_home_smoke','placeholder_absent','clubs_api_json_valid','branches_sha256']
  });
}
function run(bin,args,{cwd=PROD_ROOT,timeout=120000,allowFailure=false,maxBuffer=1000000}={}){
  const r=spawnSync(bin,args,{cwd,encoding:'utf8',timeout,maxBuffer,shell:false,env:FIXED_ENV});
  if(r.error)fail('titan_exec_error:'+path.basename(bin)+':'+r.error.message);
  if(r.status!==0&&!allowFailure)fail('titan_exec_failed:'+path.basename(bin)+':'+String(r.stderr||r.stdout||r.status).slice(0,1600));
  return {status:Number.isInteger(r.status)?r.status:null,stdout:String(r.stdout||'').trim(),stderr:String(r.stderr||'').trim()};
}
function asFitness(bin,args,opts={}){return run(RUNUSER,['-u','fitness','--',bin,...args],opts);}
function git(args,opts={}){return asFitness(GIT,['-C',PROD_ROOT,...args],opts);}
function regularDir(p){const st=fs.lstatSync(p);if(st.isSymbolicLink()||!st.isDirectory())fail('titan_dir_invalid:'+path.basename(p));}
function currentHead(){const h=git(['rev-parse','HEAD']).stdout;if(!/^[a-f0-9]{40}$/.test(h))fail('titan_head_invalid');return h;}
function dirtyLines(){const s=git(['status','--porcelain=v1']).stdout;return s?s.split(/\r?\n/).filter(Boolean):[];}
function remoteTarget(){const o=asFitness(GIT,['-C',PROD_ROOT,'ls-remote','origin',TARGET_REF],{timeout:60000}).stdout;const h=o.split(/\s+/)[0]||'';if(!/^[a-f0-9]{40}$/.test(h))fail('titan_remote_ref_invalid');return h;}
function apiEnvPresent(root=PROD_ROOT){for(const n of ENV_FILES){const p=path.join(root,n);if(!fs.existsSync(p))continue;const s=fs.lstatSync(p);if(s.isSymbolicLink()||!s.isFile())fail('titan_env_file_invalid:'+n);if(/^\s*NEXT_PUBLIC_TITAN_API_URL\s*=\s*\S+/m.test(fs.readFileSync(p,'utf8')))return true;}return false;}
function branchesSha(root=PROD_ROOT){const p=path.join(root,'src/components/pages/home/branches.tsx');return fs.existsSync(p)?sha256(fs.readFileSync(p)):null;}
function serviceActive(){return run('/usr/bin/systemctl',['is-active',SERVICE],{cwd:'/',allowFailure:true,timeout:30000}).stdout==='active';}
function exactTargetDiff(){
  const out=git(['diff','--name-only',OLD_SHA,TARGET_SHA]).stdout;
  const names=out?out.split(/\r?\n/).filter(Boolean).sort():[];
  const expected=[...TARGET_FILES].sort();
  if(JSON.stringify(names)!==JSON.stringify(expected))fail('titan_target_diff_scope_mismatch:'+names.join(','));
  return names;
}
function preflight(){
  regularDir(PROD_ROOT);
  const head=currentHead(),dirty=dirtyLines(),remote=remoteTarget(),svc=serviceActive();
  const diff=exactTargetDiff();
  const ok=svc&&dirty.length===0&&remote===TARGET_SHA&&(head===OLD_SHA||head===TARGET_SHA)&&apiEnvPresent(PROD_ROOT);
  return {ok,action:ACTION,phase:'preflight',read_only:true,service_active:svc,current_head:head,
    accepted_current_head:head===OLD_SHA||head===TARGET_SHA,target_sha:TARGET_SHA,remote_target_sha:remote,
    remote_target_match:remote===TARGET_SHA,clean:dirty.length===0,dirty_line_count:dirty.length,
    api_env_configured:apiEnvPresent(PROD_ROOT),branches_sha256:branchesSha(PROD_ROOT),
    target_diff:diff,already_target:head===TARGET_SHA,production_mutation:false,database_mutation:false};
}
function waitLocal(){
  for(let i=0;i<20;i++){
    const r=run(CURL,['-fsS','--max-time','3','http://127.0.0.1:6072/'],{cwd:'/',allowFailure:true,timeout:5000,maxBuffer:1500000});
    if(r.status===0&&r.stdout.includes('TITAN STUDIOS')&&!r.stdout.includes('Until that data source is connected'))return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);
  }
  return false;
}
function publicSmoke(){
  const front=run(CURL,['-fsS','--max-time','10','https://titanfitness-club.com/'],{cwd:'/',timeout:15000,maxBuffer:1600000}).stdout;
  if(!front.includes('TITAN STUDIOS'))fail('titan_public_marker_missing');
  if(front.includes('Until that data source is connected'))fail('titan_public_placeholder_present');
  const raw=run(CURL,['-fsS','--max-time','10','-H','Accept: application/json','https://admin.titanfitness-club.com/api/public/clubs'],{cwd:'/',timeout:15000,maxBuffer:1600000}).stdout;
  let clubs;try{clubs=JSON.parse(raw);}catch{fail('titan_clubs_json_invalid');}
  if(clubs===null||typeof clubs!=='object')fail('titan_clubs_json_shape_invalid');
  return true;
}
function cleanupStage(stage){
  if(!stage||!fs.existsSync(stage))return;
  const r=asFitness(GIT,['-C',PROD_ROOT,'worktree','remove','--force',stage],{allowFailure:true,timeout:60000});
  if(r.status!==0){try{fs.rmSync(stage,{recursive:true,force:true});}catch{}}
}
function deploy(){
  assertNoArguments(process.argv.slice(2));
  const pf=preflight();if(!pf.ok)fail('titan_preflight_failed');
  if(pf.already_target){
    if(branchesSha(PROD_ROOT)!==BRANCHES_SHA256)fail('titan_target_source_sha_mismatch');
    if(!serviceActive()||!waitLocal()||!publicSmoke())fail('titan_target_live_verification_failed');
    return {...pf,status:'already_deployed',live_verified:true,rollback_performed:false,production_mutation:false};
  }
  let stage=null,newBuild=null,oldBuild=null,cutover=false;
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  stage=STATE_ROOT+'/'+stamp;
  newBuild=PROD_ROOT+'/.next.handoff-v2-'+stamp;
  oldBuild=PROD_ROOT+'/.next.rollback-v2-'+stamp;
  try{
    git(['fetch','--no-tags','origin',TARGET_REF],{timeout:120000});
    if(git(['rev-parse','FETCH_HEAD']).stdout!==TARGET_SHA)fail('titan_fetch_target_mismatch');
    exactTargetDiff();
    if(git(['diff','--quiet',OLD_SHA,TARGET_SHA,'--','package.json','package-lock.json'],{allowFailure:true}).status!==0)fail('titan_dependency_files_changed');
    fs.mkdirSync(STATE_ROOT,{recursive:true,mode:0o750});
    const appSt=fs.lstatSync(PROD_ROOT);fs.chownSync(STATE_ROOT,appSt.uid,appSt.gid);
    git(['worktree','add','--detach',stage,TARGET_SHA],{timeout:120000});
    for(const n of ENV_FILES){
      const src=path.join(PROD_ROOT,n),dst=path.join(stage,n);
      if(!fs.existsSync(src))continue;
      const st=fs.lstatSync(src);if(st.isSymbolicLink()||!st.isFile())fail('titan_env_file_invalid:'+n);
      fs.copyFileSync(src,dst,fs.constants.COPYFILE_EXCL);fs.chownSync(dst,st.uid,st.gid);fs.chmodSync(dst,st.mode&0o777);
    }
    if(!apiEnvPresent(stage))fail('titan_api_env_missing');
    const nm=path.join(stage,'node_modules');if(fs.existsSync(nm))fail('titan_stage_node_modules_conflict');
    fs.symlinkSync(path.join(PROD_ROOT,'node_modules'),nm,'dir');fs.lchownSync(nm,appSt.uid,appSt.gid);
    asFitness(NODE,['scripts/source-regression.mjs'],{cwd:stage,timeout:120000});
    asFitness(NODE,['scripts/studios-regression.mjs'],{cwd:stage,timeout:120000});
    asFitness(NODE,[path.join(PROD_ROOT,'node_modules/eslint/bin/eslint.js'),'.'],{cwd:stage,timeout:300000,maxBuffer:1800000});
    asFitness(NODE,[path.join(PROD_ROOT,'node_modules/next/dist/bin/next'),'build'],{cwd:stage,timeout:900000,maxBuffer:4500000});
    if(branchesSha(stage)!==BRANCHES_SHA256)fail('titan_stage_branches_sha_mismatch');
    fs.cpSync(path.join(stage,'.next'),newBuild,{recursive:true,preserveTimestamps:true,errorOnExist:true});
    run('/usr/bin/systemctl',['stop',SERVICE],{cwd:'/',timeout:60000});cutover=true;
    git(['reset','--hard',TARGET_SHA],{timeout:120000});
    if(fs.existsSync(path.join(PROD_ROOT,'.next')))fs.renameSync(path.join(PROD_ROOT,'.next'),oldBuild);
    fs.renameSync(newBuild,path.join(PROD_ROOT,'.next'));
    run('/usr/bin/systemctl',['start',SERVICE],{cwd:'/',timeout:60000});
    if(!waitLocal())fail('titan_local_smoke_failed');
    publicSmoke();
    if(currentHead()!==TARGET_SHA)fail('titan_post_head_mismatch');
    if(branchesSha(PROD_ROOT)!==BRANCHES_SHA256)fail('titan_post_branches_sha_mismatch');
    if(!serviceActive())fail('titan_service_inactive_after_deploy');
    cleanupStage(stage);stage=null;
    return {ok:true,schema_version:'prhm.host-action-result.v1',action:ACTION,status:'deployed',
      old_sha:OLD_SHA,target_sha:TARGET_SHA,service_active:true,local_smoke:true,public_smoke:true,
      placeholder_absent:true,clubs_json:true,branches_sha256:BRANCHES_SHA256,exact_target_diff:true,
      rollback_performed:false,production_mutation:true,database_mutation:false,generic_shell:false,fixed_target_only:true};
  }catch(error){
    let rollbackPerformed=false,rollbackError=null;
    if(cutover){
      try{
        run('/usr/bin/systemctl',['stop',SERVICE],{cwd:'/',allowFailure:true,timeout:60000});
        git(['reset','--hard',OLD_SHA],{timeout:120000});
        const live=path.join(PROD_ROOT,'.next');if(fs.existsSync(live))fs.rmSync(live,{recursive:true,force:true});
        if(oldBuild&&fs.existsSync(oldBuild))fs.renameSync(oldBuild,live);
        run('/usr/bin/systemctl',['start',SERVICE],{cwd:'/',timeout:60000});
        if(!waitLocal())fail('titan_rollback_local_smoke_failed');
        rollbackPerformed=true;
      }catch(rb){rollbackError=String(rb?.message||rb);}
    }
    try{if(newBuild&&fs.existsSync(newBuild))fs.rmSync(newBuild,{recursive:true,force:true});}catch{}
    try{cleanupStage(stage);}catch{}
    if(rollbackError)throw new Error('titan_deploy_failed_and_rollback_failed:'+String(error?.message||error)+':'+rollbackError);
    throw new Error('titan_deploy_failed:'+String(error?.message||error)+':rollback_performed='+rollbackPerformed);
  }
}

module.exports={
  ACTION,PROD_ROOT,STATE_ROOT,SERVICE,OLD_SHA,TARGET_SHA,TARGET_REF,BRANCHES_SHA256,
  TARGET_FILES,WRITABLE_PATHS,assertNoArguments,systemdProperties,contract,preflight,deploy
};

if(require.main===module){
  try{const result=deploy();process.stdout.write(JSON.stringify(result)+'\n');}
  catch(error){process.stderr.write(String(error?.stack||error)+'\n');process.exit(1);}
}
