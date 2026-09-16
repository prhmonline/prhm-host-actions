'use strict';

const ACTION='cfpark_front_production_closure_v1';
const RISK_LEVEL=3;
const REPO='/home/cfpark/domains/cfpark.ir/public_html';
const EXPECTED_HEAD='55edc23883fb08622029611db55173885bf1f41b';
const EXPECTED_BRANCH='main';
const EXPECTED_OLD_UPSTREAM='origin/main';
const NEW_UPSTREAM='origin/production/cfpark';
const UNTRACKED_FILE='src/app/layout.tsx.bak-ga4-20260721-233702';
const UNTRACKED_SHA256='3b5d375fef66d4f214e3a5ebe9d2bab0b082187285158f1d42d0718efaf055f9';
const BACKUP_DIR='/var/backups/cfpark-front-production-closure-v1';

function fail(code){const e=new Error(code);e.code=code;throw e;}

function validatePreimage(s){
  if(!s||s.head!==EXPECTED_HEAD)fail('head_mismatch');
  if(s.branch!==EXPECTED_BRANCH)fail('branch_mismatch');
  if(s.upstream!==EXPECTED_OLD_UPSTREAM)fail('upstream_mismatch');
  if(!Array.isArray(s.untracked)||s.untracked.length!==1||s.untracked[0]!==UNTRACKED_FILE)fail('untracked_set_mismatch');
  if(s.untracked_sha256!==UNTRACKED_SHA256)fail('untracked_sha_mismatch');
  return true;
}

function validateBackupPath(value){
  if(typeof value!=='string'||!value.startsWith(BACKUP_DIR+'/'))fail('backup_path_invalid');
  return true;
}

function buildPlan(){
  return [
    Object.freeze({kind:'backup',file:UNTRACKED_FILE,sha256:UNTRACKED_SHA256}),
    Object.freeze({kind:'fetch',args:Object.freeze(['fetch','origin','refs/heads/production/cfpark:refs/remotes/origin/production/cfpark'])}),
    Object.freeze({kind:'set_upstream',args:Object.freeze(['branch','--set-upstream-to=origin/production/cfpark','main'])}),
    Object.freeze({kind:'verify'})
  ];
}

async function runClosure(deps){
  if(!deps||typeof deps.inspect!=='function'||typeof deps.backup!=='function'||typeof deps.git!=='function'||typeof deps.restoreUpstream!=='function')fail('invalid_dependencies');
  const before=await deps.inspect();
  validatePreimage(before);
  const oldUpstream=before.upstream;
  let backupPath=null;
  let upstreamChanged=false;
  try{
    backupPath=await deps.backup({repo:REPO,file:UNTRACKED_FILE,sha256:UNTRACKED_SHA256,backup_dir:BACKUP_DIR});
    validateBackupPath(backupPath);
    await deps.git(['fetch','origin','refs/heads/production/cfpark:refs/remotes/origin/production/cfpark']);
    await deps.git(['branch','--set-upstream-to=origin/production/cfpark','main']);
    upstreamChanged=true;
    const after=await deps.inspect();
    if(after.head!==EXPECTED_HEAD)fail('post_head_mismatch');
    if(after.branch!==EXPECTED_BRANCH)fail('post_branch_mismatch');
    if(after.upstream!==NEW_UPSTREAM)fail('post_upstream_mismatch');
    if(!Array.isArray(after.untracked)||after.untracked.length!==0)fail('post_tree_not_clean');
    if(after.ahead!==0||after.behind!==0)fail('post_ahead_behind_mismatch');
    return {ok:true,action:ACTION,head:after.head,branch:after.branch,upstream:after.upstream,dirty:false,ahead:after.ahead,behind:after.behind,backup_path:backupPath};
  }catch(error){
    if(upstreamChanged)await deps.restoreUpstream(oldUpstream);
    throw error;
  }
}

module.exports={ACTION,RISK_LEVEL,REPO,EXPECTED_HEAD,EXPECTED_BRANCH,EXPECTED_OLD_UPSTREAM,NEW_UPSTREAM,UNTRACKED_FILE,UNTRACKED_SHA256,BACKUP_DIR,validatePreimage,validateBackupPath,buildPlan,runClosure};
