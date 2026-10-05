'use strict';

function fail(code){const e=new Error(code);e.code=code;return e;}

const TARGETS=Object.freeze({
  honartik_front_prod:Object.freeze({project_id:'honartik_front_prod',enabled:false}),
  honartik_back_prod:Object.freeze({project_id:'honartik_back_prod',enabled:false}),
  pbcinema_front_prod:Object.freeze({project_id:'pbcinema_front_prod',enabled:false}),
  pbcinema_back_prod:Object.freeze({project_id:'pbcinema_back_prod',enabled:false}),
  moeinshow_front_prod:Object.freeze({project_id:'moeinshow_front_prod',enabled:false}),
  moeinshow_back_prod:Object.freeze({project_id:'moeinshow_back_prod',enabled:false}),
  cfpark_front_prod:Object.freeze({project_id:'cfpark_front_prod',repository_root:'/home/cfpark/domains/cfpark.ir/public_html',expected_origin_repo:'prhmonline/cfpark_new_front',expected_branch:'main',expected_upstream:'origin/main',enabled:true}),
  cfpark_back_prod:Object.freeze({project_id:'cfpark_back_prod',enabled:false})
});

function resolveTargetFromRegistry(projectId,registry){
  if(typeof projectId!=='string')throw fail('invalid_project_id');
  const target=registry[projectId];
  if(!target)throw fail('unknown_project_id');
  if(!target.enabled)throw fail('target_not_enabled');
  return Object.freeze({...target});
}
function resolveTarget(projectId){return resolveTargetFromRegistry(projectId,TARGETS);}

function sanitizeOriginRepo(raw){
  if(typeof raw!=='string'||raw.length===0)throw fail('unsafe_or_unrecognized_origin');
  let owner,repo;
  const scp=raw.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if(scp){owner=scp[1];repo=scp[2];}
  else{
    let u;
    try{u=new URL(raw);}catch{throw fail('unsafe_or_unrecognized_origin');}
    if(u.hostname!=='github.com')throw fail('unsafe_or_unrecognized_origin');
    const parts=u.pathname.replace(/^\/+|\/+$/g,'').split('/');
    if(parts.length!==2||!parts[0]||!parts[1])throw fail('unsafe_or_unrecognized_origin');
    owner=parts[0];repo=parts[1].replace(/\.git$/,'');
  }
  if(!/^[A-Za-z0-9_.-]+$/.test(owner)||!/^[A-Za-z0-9_.-]+$/.test(repo))throw fail('unsafe_or_unrecognized_origin');
  return owner+'/'+repo;
}

function countPorcelain(raw){
  let tracked=0,untracked=0;
  for(const rec of String(raw||'').split('\0')){
    if(!rec)continue;
    if(rec.startsWith('?? '))untracked++;
    else tracked++;
  }
  return {tracked_modified_count:tracked,untracked_count:untracked,dirty:(tracked+untracked)>0};
}

function probeRepository(target,execGit){
  if(!target||typeof execGit!=='function')throw fail('invalid_probe_input');
  const inside=String(execGit(['rev-parse','--is-inside-work-tree'])).trim();
  if(inside!=='true')throw fail('not_git_repository');
  const head=String(execGit(['rev-parse','HEAD'])).trim();
  if(!/^[0-9a-f]{40}$/i.test(head))throw fail('invalid_head_sha');
  let branch;
  try{branch=String(execGit(['symbolic-ref','--short','HEAD'])).trim();}
  catch{throw fail('detached_head');}
  if(!branch)throw fail('detached_head');
  if(target.expected_branch&&branch!==target.expected_branch)throw fail('branch_mismatch');
  const counts=countPorcelain(execGit(['status','--porcelain=v1','-z']));
  const origin=sanitizeOriginRepo(String(execGit(['config','--get','remote.origin.url'])).trim());
  if(origin!==target.expected_origin_repo)throw fail('origin_repo_mismatch');
  const upstream=target.expected_upstream;
  if(typeof upstream!=='string'||!upstream)throw fail('missing_upstream');
  try{execGit(['rev-parse','--verify',upstream]);}catch{throw fail('missing_upstream');}
  const ab=String(execGit(['rev-list','--left-right','--count',upstream+'...HEAD'])).trim().split(/\s+/).map(Number);
  if(ab.length!==2||ab.some(n=>!Number.isInteger(n)||n<0))throw fail('invalid_ahead_behind');
  return {
    is_git_repository:true,branch,head_sha:head,origin_repo:origin,upstream_branch:upstream,
    ...counts,ahead:ab[1],behind:ab[0],detached_head:false,remote_tracking_freshness:'unknown'
  };
}

function classifyLocalTracking(o){
  if(o?.dirty===true)return 'DIRTY';
  if(o?.detached_head===true)return 'DETACHED';
  const ahead=Number(o?.ahead),behind=Number(o?.behind);
  if(!Number.isInteger(ahead)||!Number.isInteger(behind)||ahead<0||behind<0)return 'UNKNOWN';
  if(ahead>0&&behind>0)return 'DIVERGED_LOCAL_TRACKING';
  if(ahead>0)return 'AHEAD_LOCAL_TRACKING';
  if(behind>0)return 'BEHIND_LOCAL_TRACKING';
  return 'MATCH_LOCAL_TRACKING';
}

function buildResult(projectId,repositoryRoot,observation){
  return {
    ok:true,
    project_id:projectId,
    repository_root:repositoryRoot,
    is_git_repository:observation.is_git_repository,
    branch:observation.branch,
    head_sha:observation.head_sha,
    origin_repo:observation.origin_repo,
    upstream_branch:observation.upstream_branch,
    dirty:observation.dirty,
    tracked_modified_count:observation.tracked_modified_count,
    untracked_count:observation.untracked_count,
    ahead:observation.ahead,
    behind:observation.behind,
    detached_head:observation.detached_head,
    remote_tracking_freshness:observation.remote_tracking_freshness,
    classification:classifyLocalTracking(observation)
  };
}

module.exports={TARGETS,resolveTarget,sanitizeOriginRepo,probeRepository,classifyLocalTracking,buildResult,_test:{resolveTargetFromRegistry,countPorcelain}};
