'use strict';

const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');

const ACTION='drtarjomeh_login_source_sync_v38';
const OPERATION='host_action.drtarjomeh_login_source_sync_v38';
const SOURCE_REPOSITORY='/home/drtarjomeh/domains/drtarjomeh.ir/repository';
const PRODUCTION_POINTER='/home/drtarjomeh/domains/drtarjomeh.ir/public_html';
const EXPECTED_RELEASE='/home/drtarjomeh/domains/drtarjomeh.ir/releases/20261006-224241-0e8686eed30f';
const EXPECTED_REVISION='0e8686eed30fb23bf51ca2bc345a62a227e7bc55';
const REVISION_FILE=path.join(EXPECTED_RELEASE,'REVISION');
const TARGET_BRANCH='fix/drtarjomeh-login-pro-max-canonical-20261007';
const TARGET_REF='refs/heads/'+TARGET_BRANCH;
const WORKTREE_ROOT='/home/drtarjomeh/domains/drtarjomeh.ir/.prhm-worktrees';
const COMMIT_MESSAGE='fix(login): persist Pro Max login UI from production';
const GIT_AUTHOR_NAME='PRHM Agent 3';
const GIT_AUTHOR_EMAIL='agent3@prhm.ir';
const SHA256=/^[a-f0-9]{64}$/;

const PAYLOAD=Object.freeze({
  'core/themes/codebase/views/layouts/login.php':'445270f5571aa2086e185d3407a835ce8ecb6dde4c42d6bf269fdac381d37578',
  'common/themes/metronic/LoginAssets.php':'1ee57afdd72885b48a36d95f223829f108c56b8476ad1765d65cf4969241e3db',
  'common/themes/metronic/web/css/login.css':'83563fc560fc6f353b0ad4f4b1692c667d0486b8484cb2bf1bdfb1d5f67bee3c',
  'common/themes/metronic/views/layouts/base.php':'19d12e90efc39dc173e765596ee8f7eb0751254e55188e5ca97076836205be7e',
  'panel/views/user/login.php':'b178e215668781993548fbe73439c92851ee1b17233e752780d74fc353369e2b',
  'common/themes/metronic/views/user/_loginForm.php':'946000a4d21134fc44551767bd9686cbce252cba2960b17a304361f22ec957c8'
});

const REQUIRED_CHANGED=Object.freeze([
  'core/themes/codebase/views/layouts/login.php',
  'common/themes/metronic/LoginAssets.php',
  'common/themes/metronic/web/css/login.css'
]);

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=m=>{throw new Error(m)};
const cleanEnv=extra=>Object.assign({
  PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  LC_ALL:'C',
  HOME:'/home/drtarjomeh',
  GIT_TERMINAL_PROMPT:'0'
},extra||{});

function safeRel(rel){
  if(typeof rel!=='string'||!rel||path.isAbsolute(rel))fail('unsafe_relative_path');
  const parts=rel.split('/');
  if(parts.some(p=>p===''||p==='.'||p==='..'))fail('unsafe_relative_path');
  if(path.posix.normalize(rel)!==rel)fail('unsafe_relative_path');
  return rel;
}
function assertPayload(){
  const keys=Object.keys(PAYLOAD);
  if(keys.length!==6)fail('payload_count_invalid');
  for(const rel of keys){safeRel(rel);if(!SHA256.test(PAYLOAD[rel]))fail('payload_sha_invalid:'+rel);}
  return true;
}
function regularFile(file,label){
  const st=fs.lstatSync(file);
  if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(file)!==file)fail(label+'_invalid');
  return st;
}
function regularDir(dir,label){
  const st=fs.lstatSync(dir);
  if(st.isSymbolicLink()||!st.isDirectory()||fs.realpathSync(dir)!==dir)fail(label+'_invalid');
  return st;
}
function run(file,args,opt={}){
  const r=cp.spawnSync(file,args,{
    cwd:opt.cwd,
    encoding:opt.encoding===null?null:'utf8',
    timeout:opt.timeout||120000,
    maxBuffer:opt.maxBuffer||8*1024*1024,
    env:cleanEnv(opt.env)
  });
  return r;
}
function must(r,label){
  if(r.error||r.status!==0)fail(label+':'+String(r.stderr||r.stdout||r.error||'').slice(-1200));
  return r;
}
function git(cwd,args,opt={}){
  return run('/usr/bin/git',['-C',cwd,...args],opt);
}
function gitText(cwd,args,label){
  return String(must(git(cwd,args),label).stdout||'').trim();
}
function remoteBranchState(){
  const r=git(SOURCE_REPOSITORY,['ls-remote','--exit-code','--heads','origin',TARGET_REF],{timeout:60000});
  if(r.error)fail('remote_probe_error');
  if(r.status===0){
    const line=String(r.stdout||'').trim();
    const m=line.match(/^([a-f0-9]{40})\s+refs\/heads\//);
    if(!m)fail('remote_probe_invalid');
    return {exists:true,sha:m[1]};
  }
  if(r.status===2)return {exists:false,sha:null};
  fail('remote_probe_failed:'+String(r.stderr||r.stdout||'').slice(-500));
}
function assertRuntimeOwner(sourceStat){
  if(typeof process.getuid!=='function')fail('uid_probe_unavailable');
  if(process.getuid()!==sourceStat.uid)fail('source_owner_runtime_required');
  return true;
}
function assertLivePayload(){
  for(const [rel,expected] of Object.entries(PAYLOAD)){
    const file=path.join(EXPECTED_RELEASE,rel);
    regularFile(file,'live_payload_'+rel.replace(/[^a-z0-9]+/gi,'_'));
    const actual=sha(fs.readFileSync(file));
    if(actual!==expected)fail('live_payload_sha_mismatch:'+rel);
  }
  return true;
}
function assertProductionPointer(){
  const st=fs.lstatSync(PRODUCTION_POINTER);
  if(!st.isSymbolicLink())fail('production_pointer_not_symlink');
  if(fs.realpathSync(PRODUCTION_POINTER)!==EXPECTED_RELEASE)fail('unexpected_active_release');
  return true;
}
function assertRevisionFile(){
  regularFile(REVISION_FILE,'revision_file');
  if(fs.readFileSync(REVISION_FILE,'utf8')!==EXPECTED_REVISION+'\n')fail('release_revision_mismatch');
  return true;
}
function sourceState(){
  const sourceStat=regularDir(SOURCE_REPOSITORY,'source_repository');
  assertRuntimeOwner(sourceStat);
  if(gitText(SOURCE_REPOSITORY,['rev-parse','--is-inside-work-tree'],'git_worktree_probe')!=='true')fail('source_not_git_worktree');
  const head=gitText(SOURCE_REPOSITORY,['rev-parse','HEAD'],'git_head_probe');
  if(head!==EXPECTED_REVISION)fail('source_head_mismatch:'+head);
  const status=gitText(SOURCE_REPOSITORY,['status','--porcelain=v1','--untracked-files=all'],'git_status_probe');
  if(status!=='')fail('source_repository_not_clean');
  gitText(SOURCE_REPOSITORY,['remote','get-url','origin'],'git_origin_missing');
  return {sourceStat,head};
}
function preflight(){
  assertPayload();
  assertProductionPointer();
  assertRevisionFile();
  assertLivePayload();
  const src=sourceState();
  const remote=remoteBranchState();
  if(remote.exists)fail('target_branch_already_exists:'+remote.sha);
  return Object.freeze({
    ok:true,
    action:ACTION,
    operation:OPERATION,
    preflight_only:true,
    expected_revision:EXPECTED_REVISION,
    active_release:EXPECTED_RELEASE,
    source_repository:SOURCE_REPOSITORY,
    target_branch:TARGET_BRANCH,
    payload_count:Object.keys(PAYLOAD).length,
    source_clean:true,
    source_head:src.head,
    remote_branch_absent:true,
    production_mutation:false,
    live_runtime_mutation:false,
    database_mutation:false,
    arbitrary_command:false,
    arbitrary_path:false
  });
}
function ensureWorktreeRoot(sourceStat){
  if(!fs.existsSync(WORKTREE_ROOT)){
    fs.mkdirSync(WORKTREE_ROOT,{recursive:false,mode:0o750});
    fs.chmodSync(WORKTREE_ROOT,0o750);
  }
  const st=regularDir(WORKTREE_ROOT,'worktree_root');
  if(st.uid!==sourceStat.uid)fail('worktree_root_owner_mismatch');
  return st;
}
function assertSafeWorktreeDestination(worktree,rel){
  safeRel(rel);
  const root=path.resolve(worktree);
  const parts=rel.split('/');
  let current=root;
  for(let i=0;i<parts.length-1;i++){
    current=path.join(current,parts[i]);
    const resolved=path.resolve(current);
    if(resolved!==root&&!resolved.startsWith(root+path.sep))fail('worktree_escape:'+rel);
    if(fs.existsSync(current)){
      const st=fs.lstatSync(current);
      if(st.isSymbolicLink()||!st.isDirectory())fail('worktree_parent_invalid:'+rel);
    }else{
      fs.mkdirSync(current,{mode:0o755});
    }
  }
  const dst=path.join(root,rel);
  const resolvedDst=path.resolve(dst);
  if(!resolvedDst.startsWith(root+path.sep))fail('worktree_escape:'+rel);
  if(fs.existsSync(dst)){
    const st=fs.lstatSync(dst);
    if(st.isSymbolicLink()||!st.isFile())fail('worktree_target_invalid:'+rel);
  }
  return dst;
}
function copyPayload(worktree){
  for(const [rel,expected] of Object.entries(PAYLOAD)){
    const src=path.join(EXPECTED_RELEASE,rel);
    const dst=assertSafeWorktreeDestination(worktree,rel);
    fs.copyFileSync(src,dst);
    fs.chmodSync(dst,0o644);
    if(sha(fs.readFileSync(dst))!==expected)fail('copied_payload_sha_mismatch:'+rel);
  }
}
function phpLint(worktree){
  for(const rel of Object.keys(PAYLOAD).filter(x=>x.endsWith('.php'))){
    must(run('/usr/bin/php',['-l',path.join(worktree,rel)],{cwd:worktree,timeout:30000}),'php_lint_failed:'+rel);
  }
  return true;
}
function stagedPaths(worktree){
  const out=gitText(worktree,['diff','--cached','--name-only','--diff-filter=ACMRTUXB'],'git_staged_names');
  return out?out.split(/\r?\n/).filter(Boolean).sort():[];
}
function verifyCommit(worktree,commit){
  if(!/^[a-f0-9]{40}$/.test(commit))fail('commit_sha_invalid');
  const parent=gitText(worktree,['rev-parse',commit+'^'],'commit_parent_probe');
  if(parent!==EXPECTED_REVISION)fail('commit_parent_mismatch');
  for(const [rel,expected] of Object.entries(PAYLOAD)){
    const r=must(git(worktree,['show',commit+':'+rel],{encoding:null}),'commit_blob_read_failed:'+rel);
    if(sha(Buffer.from(r.stdout))!==expected)fail('commit_blob_sha_mismatch:'+rel);
  }
  return true;
}
function cleanupWorktree(worktree){
  if(!worktree)return;
  try{git(SOURCE_REPOSITORY,['worktree','remove','--force',worktree],{timeout:60000});}catch{}
  try{git(SOURCE_REPOSITORY,['worktree','prune'],{timeout:60000});}catch{}
  try{if(fs.existsSync(worktree))fs.rmSync(worktree,{recursive:true,force:true});}catch{}
}
function rollbackRemote(commit){
  if(!commit)return {attempted:false,verified:true};
  try{
    const state=remoteBranchState();
    if(!state.exists)return {attempted:true,verified:true};
    if(state.sha!==commit)return {attempted:false,verified:false,reason:'remote_ref_drift'};
    const r=git(SOURCE_REPOSITORY,['push','--porcelain','origin',':'+TARGET_REF],{timeout:120000});
    if(r.error||r.status!==0)return {attempted:true,verified:false,reason:'remote_delete_failed'};
    const after=remoteBranchState();
    return {attempted:true,verified:after.exists===false};
  }catch{
    return {attempted:true,verified:false,reason:'remote_rollback_probe_failed'};
  }
}
function apply(){
  const pf=preflight();
  const src=sourceState();
  ensureWorktreeRoot(src.sourceStat);
  const worktree=path.join(WORKTREE_ROOT,'drt-login-source-sync-v38-'+process.pid+'-'+Date.now());
  let commit=null;
  let pushed=false;
  let pushAttempted=false;
  try{
    must(git(SOURCE_REPOSITORY,['worktree','add','--detach',worktree,EXPECTED_REVISION],{timeout:120000}),'worktree_add_failed');
    if(gitText(worktree,['rev-parse','HEAD'],'worktree_head_probe')!==EXPECTED_REVISION)fail('worktree_head_mismatch');
    copyPayload(worktree);
    phpLint(worktree);
    must(git(worktree,['add','--',...Object.keys(PAYLOAD)],{timeout:60000}),'git_add_failed');
    const allowedNames=Object.keys(PAYLOAD).slice().sort();
    const actualNames=stagedPaths(worktree);
    if(actualNames.length===0)fail('staged_path_set_empty');
    if(actualNames.some(rel=>!allowedNames.includes(rel)))fail('staged_path_set_unexpected:'+JSON.stringify(actualNames));
    for(const rel of REQUIRED_CHANGED){if(!actualNames.includes(rel))fail('required_changed_path_missing:'+rel);}
    must(git(worktree,['diff','--cached','--check'],{timeout:60000}),'git_diff_check_failed');
    const env={
      GIT_AUTHOR_NAME,
      GIT_AUTHOR_EMAIL,
      GIT_COMMITTER_NAME:GIT_AUTHOR_NAME,
      GIT_COMMITTER_EMAIL:GIT_AUTHOR_EMAIL
    };
    must(git(worktree,['commit','--no-gpg-sign','-m',COMMIT_MESSAGE],{timeout:120000,env}),'git_commit_failed');
    commit=gitText(worktree,['rev-parse','HEAD'],'new_commit_probe');
    verifyCommit(worktree,commit);
    pushAttempted=true;
    must(git(worktree,['push','--porcelain','origin','HEAD:'+TARGET_REF],{timeout:180000}),'git_push_failed');
    pushed=true;
    const remote=remoteBranchState();
    if(!remote.exists||remote.sha!==commit)fail('remote_ref_verify_failed');
    cleanupWorktree(worktree);
    const finalSource=sourceState();
    assertProductionPointer();
    if(finalSource.head!==EXPECTED_REVISION)fail('source_head_changed_after_apply');
    return Object.freeze({
      ok:true,
      schema_version:'prhm.host-action-result.v1',
      action:ACTION,
      operation:OPERATION,
      changed:true,
      source_revision:EXPECTED_REVISION,
      target_branch:TARGET_BRANCH,
      pushed_commit:commit,
      payload_count:Object.keys(PAYLOAD).length,
      php_lint_passed:true,
      staged_path_set_verified:true,
      staged_path_count:actualNames.length,
      commit_payload_verified:true,
      source_head_unchanged:true,
      source_worktree_clean:true,
      production_pointer_unchanged:true,
      production_mutation:false,
      live_runtime_mutation:false,
      database_mutation:false,
      rollback_performed:false,
      arbitrary_command:false,
      arbitrary_path:false
    });
  }catch(error){
    const remoteRollback=pushAttempted?rollbackRemote(commit):{attempted:false,verified:true};
    cleanupWorktree(worktree);
    let sourceOk=false;
    let pointerOk=false;
    try{sourceOk=sourceState().head===EXPECTED_REVISION}catch{}
    try{pointerOk=assertProductionPointer()===true}catch{}
    const suffix=remoteRollback.verified&&sourceOk&&pointerOk?'_rolled_back':'_rollback_incomplete';
    throw new Error('drtarjomeh_login_source_sync_v38_failed'+suffix+':'+String(error&&error.message||error).slice(0,800));
  }
}
function manifest(){
  assertPayload();
  return Object.freeze({
    schema_version:'prhm.drtarjomeh-login-source-sync.v38',
    action:ACTION,
    operation:OPERATION,
    source_repository:SOURCE_REPOSITORY,
    active_release:EXPECTED_RELEASE,
    expected_revision:EXPECTED_REVISION,
    target_branch:TARGET_BRANCH,
    payload:Object.freeze({...PAYLOAD}),
    level:4,
    risk:'critical',
    zero_input:true,
    required_user:'drtarjomeh',
    source_repository_mutation:true,
    remote_git_branch_mutation:true,
    production_mutation:false,
    live_runtime_mutation:false,
    database_mutation:false,
    arbitrary_command:false,
    arbitrary_path:false
  });
}

module.exports=Object.freeze({
  ACTION,OPERATION,SOURCE_REPOSITORY,PRODUCTION_POINTER,EXPECTED_RELEASE,EXPECTED_REVISION,TARGET_BRANCH,TARGET_REF,
  WORKTREE_ROOT,PAYLOAD,REQUIRED_CHANGED,safeRel,assertPayload,assertSafeWorktreeDestination,manifest,preflight,apply
});

if(require.main===module){
  const mode=process.argv[2]||'preflight';
  if(!['preflight','apply'].includes(mode))fail('unexpected_mode');
  process.stdout.write(JSON.stringify(mode==='apply'?apply():preflight())+'\n');
}
