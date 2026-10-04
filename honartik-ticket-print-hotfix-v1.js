'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='honartik_ticket_print_hotfix_v1';
const OPERATION='host_action.honartik_ticket_print_hotfix_v1';
const PROJECT='honartik_admin_prod';
const ROOT='/home/honartik/domains/dashboard.honartik.ir/public_html';
const FILE_REL='app/modules/api/views/public/print-ticket-new.php';
const FILE_ABS=path.join(ROOT,FILE_REL);
const FILE_DIR=path.dirname(FILE_ABS);
const EXPECTED_BRANCH='main';
const EXPECTED_HEAD='cc489ea93d8b8ab9ebd748db554a460ca49e5683';
const TARGET_COMMIT='a66242e0c6904a6e77eb83913c92be3170f25334';
const LIVE_SHA256='722c7c05c3befa5399452a91bba8b9287acf1f46662d60cc8c68d65249d8e19c';
const TARGET_SHA256='6b76f2c1ff9c48e0e9ff29cefbb77ab1664338c10a1d862ae0f7fa7176308377';
const BACKUP_ROOT='/var/backups/prhm-honartik-ticket-print-hotfix-v1';
const RESULT_ROOT='/var/lib/prhm-agent-selfmaint-exec/honartik-ticket-print-hotfix-v1';
const ALLOWED_GIT_READS=Object.freeze(['rev-parse','diff-tree','status','show']);
const SANDBOX=Object.freeze({
  protectSystem:'strict',
  protectHome:'read-only',
  privateTmp:true,
  noNewPrivileges:true,
  readWritePaths:Object.freeze([FILE_DIR,BACKUP_ROOT,RESULT_ROOT,'/run']),
});
const STATE_KEYS=new Set(['project','root','branch','head','targetCommit','targetParent','changedPaths','liveSha256','targetSha256','wrapperDirty','dirtyPaths','dirtyEntries']);

function fail(code){throw new Error(code)}
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex')}
function sortedUnique(items){return [...new Set((items||[]).map(String))].sort()}
function sameArray(a,b){return JSON.stringify(sortedUnique(a))===JSON.stringify(sortedUnique(b))}

function validatePreconditions(state){
  if(!state||typeof state!=='object'||Array.isArray(state))fail('state_invalid');
  for(const key of Object.keys(state))if(!STATE_KEYS.has(key))fail('unexpected_state_key:'+key);
  if(state.project!==PROJECT)fail('project_mismatch');
  if(state.root!==ROOT)fail('root_mismatch');
  if(state.branch!==EXPECTED_BRANCH)fail('branch_mismatch');
  if(state.head!==EXPECTED_HEAD)fail('head_mismatch');
  if(state.targetCommit!==TARGET_COMMIT)fail('target_commit_mismatch');
  if(state.targetParent!==EXPECTED_HEAD)fail('target_parent_mismatch');
  if(!Array.isArray(state.changedPaths)||state.changedPaths.length!==1||state.changedPaths[0]!==FILE_REL)fail('target_diff_mismatch');
  if(state.liveSha256!==LIVE_SHA256)fail('live_sha_mismatch');
  if(state.targetSha256!==TARGET_SHA256)fail('target_sha_mismatch');
  if(state.wrapperDirty!==false)fail('wrapper_dirty');
  const unrelated=sortedUnique((state.dirtyPaths||[]).filter(p=>p!==FILE_REL));
  const unrelatedEntries=sortedUnique((state.dirtyEntries||[]).filter(line=>dirtyPathFromEntry(line)!==FILE_REL));
  return Object.freeze({ok:true,unrelatedDirtyPaths:Object.freeze(unrelated),unrelatedDirtyEntries:Object.freeze(unrelatedEntries)});
}

function assertUnrelatedDirtyStatePreserved(before,after){
  if(!sameArray(before,after))fail('unrelated_dirty_state_changed');
  return true;
}

async function applyWithIo(io,state){
  const validated=validatePreconditions(state);
  let replaced=false;
  try{
    await io.persistPreimage();
    const target=await io.readTarget();
    await io.verifyTargetSha(target,TARGET_SHA256);
    await io.writeCandidate(target);
    await io.lintCandidate();
    await io.atomicReplace();
    replaced=true;
    await io.verifyLiveSha(TARGET_SHA256);
    if(typeof io.readUnrelatedDirtyEntries==='function'){
      const after=await io.readUnrelatedDirtyEntries();
      assertUnrelatedDirtyStatePreserved(validated.unrelatedDirtyEntries,after);
    }else if(typeof io.readUnrelatedDirtyPaths==='function'){
      const after=await io.readUnrelatedDirtyPaths();
      assertUnrelatedDirtyStatePreserved(validated.unrelatedDirtyPaths,after);
    }
    return Object.freeze({ok:true,action:ACTION,live_sha256:TARGET_SHA256,rollback_performed:false});
  }catch(error){
    if(!replaced)throw error;
    try{
      await io.rollback();
      await io.verifyRollbackSha(LIVE_SHA256);
    }catch(rollbackError){
      const e=new Error('rollback_verification_failed:'+String(rollbackError&&rollbackError.message||rollbackError));
      e.cause=error;
      throw e;
    }
    throw error;
  }finally{
    if(typeof io.cleanup==='function')await io.cleanup();
  }
}

function createMemoryIo(options={}){
  const events=[];
  const failAt=options.failAt||null;
  const maybeFail=(name,code)=>{events.push(name);if(failAt===name)throw new Error(code)};
  return {
    events,
    async persistPreimage(){maybeFail('persistPreimage','preimage_persist_failed')},
    async readTarget(){maybeFail('readTarget','target_read_failed');return options.candidate||Buffer.from('target')},
    async verifyTargetSha(){maybeFail('verifyTargetSha','target_sha_failed')},
    async writeCandidate(){maybeFail('writeCandidate','candidate_write_failed')},
    async lintCandidate(){maybeFail('lintCandidate','php_lint_failed')},
    async atomicReplace(){maybeFail('atomicReplace','atomic_replace_failed')},
    async verifyLiveSha(){maybeFail('verifyLiveSha','post_write_verification_failed')},
    async readUnrelatedDirtyEntries(){events.push('readUnrelatedDirtyEntries');return options.dirtyEntries||[' M app/controllers/AdminController.php','M  common/config/main.php']},
    async readUnrelatedDirtyPaths(){events.push('readUnrelatedDirtyPaths');return options.dirtyPaths||['app/controllers/AdminController.php','common/config/main.php']},
    async rollback(){events.push('rollback')},
    async verifyRollbackSha(){events.push('verifyRollbackSha');if(options.rollbackVerifyFails)throw new Error('rollback_sha_mismatch')},
    async cleanup(){events.push('cleanup')},
  };
}

function gitRead(args,{encoding='utf8'}={}){
  const sub=String(args&&args[0]||'');
  if(!ALLOWED_GIT_READS.includes(sub))fail('git_read_not_allowlisted:'+sub);
  return cp.execFileSync('/usr/bin/git',['-c','safe.directory='+ROOT,'-C',ROOT,...args],{
    encoding,
    timeout:30000,
    maxBuffer:1024*1024,
    env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/home/honartik'},
  });
}

function dirtyPathFromEntry(raw){
  const line=String(raw||'');
  let p=line.length>=4?line.slice(3):'';
  if(p.includes(' -> '))p=p.split(' -> ').pop();
  if(p.startsWith('"')&&p.endsWith('"')){try{p=JSON.parse(p)}catch{}}
  return p;
}
function parseDirtyEntries(porcelain){return sortedUnique(String(porcelain||'').split(/\r?\n/).filter(Boolean))}
function parseDirtyPaths(porcelain){return sortedUnique(parseDirtyEntries(porcelain).map(dirtyPathFromEntry).filter(Boolean))}

function inspectProductionState(){
  const branch=String(gitRead(['rev-parse','--abbrev-ref','HEAD'])).trim();
  const head=String(gitRead(['rev-parse','HEAD'])).trim();
  let targetParent;
  try{targetParent=String(gitRead(['rev-parse',TARGET_COMMIT+'^'])).trim()}catch{fail('target_commit_missing')}
  const changedPaths=String(gitRead(['diff-tree','--no-commit-id','--name-only','-r',EXPECTED_HEAD,TARGET_COMMIT])).trim().split(/\r?\n/).filter(Boolean);
  let targetBytes;
  try{targetBytes=gitRead(['show',TARGET_COMMIT+':'+FILE_REL],{encoding:null})}catch{fail('target_file_missing')}
  const dirtyRaw=String(gitRead(['status','--porcelain=v1']));
  const dirtyEntries=parseDirtyEntries(dirtyRaw);
  const dirtyPaths=parseDirtyPaths(dirtyRaw);
  const wrapperDirty=dirtyPaths.includes(FILE_REL);
  const liveStat=fs.lstatSync(FILE_ABS);
  if(liveStat.isSymbolicLink()||!liveStat.isFile())fail('live_file_not_regular');
  const liveBytes=fs.readFileSync(FILE_ABS);
  return {
    state:{project:PROJECT,root:ROOT,branch,head,targetCommit:TARGET_COMMIT,targetParent,changedPaths,liveSha256:sha256(liveBytes),targetSha256:sha256(targetBytes),wrapperDirty,dirtyPaths,dirtyEntries},
    targetBytes,
    liveBytes,
    liveStat,
  };
}

function ensureDir(dir,mode=0o700){fs.mkdirSync(dir,{recursive:true,mode});fs.chmodSync(dir,mode)}
function preserveMetadata(file,st){fs.chmodSync(file,st.mode&0o777);if(typeof process.geteuid==='function'&&process.geteuid()===0)fs.chownSync(file,st.uid,st.gid)}
function atomicWriteTemp(finalPath,bytes,st,label){
  const dir=path.dirname(finalPath);
  const tmp=path.join(dir,'.'+path.basename(finalPath)+'.'+label+'.'+process.pid+'.'+Date.now());
  const fd=fs.openSync(tmp,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,st.mode&0o777);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  preserveMetadata(tmp,st);
  return tmp;
}

function createProductionIo(observed,invocationId){
  ensureDir(BACKUP_ROOT,0o700);ensureDir(RESULT_ROOT,0o700);
  const backupPath=path.join(BACKUP_ROOT,invocationId+'.preimage.php');
  let candidatePath=null;
  return {
    async persistPreimage(){
      const fd=fs.openSync(backupPath,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);
      try{fs.writeFileSync(fd,observed.liveBytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
      if(sha256(fs.readFileSync(backupPath))!==LIVE_SHA256)fail('preimage_persist_sha_mismatch');
    },
    async readTarget(){return observed.targetBytes},
    async verifyTargetSha(bytes,expected){if(sha256(bytes)!==expected)fail('target_sha_mismatch')},
    async writeCandidate(bytes){candidatePath=atomicWriteTemp(FILE_ABS,bytes,observed.liveStat,'candidate')},
    async lintCandidate(){
      if(!candidatePath)fail('candidate_missing');
      try{cp.execFileSync('/usr/bin/php',['-l',candidatePath],{encoding:'utf8',timeout:30000,maxBuffer:256000,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C'}})}catch(error){fail('php_lint_failed:'+String(error.stderr||error.stdout||error.message||error).slice(-1000))}
    },
    async atomicReplace(){if(!candidatePath)fail('candidate_missing');fs.renameSync(candidatePath,FILE_ABS);candidatePath=null},
    async verifyLiveSha(expected){if(sha256(fs.readFileSync(FILE_ABS))!==expected)fail('post_write_verification_failed')},
    async readUnrelatedDirtyEntries(){return parseDirtyEntries(String(gitRead(['status','--porcelain=v1']))).filter(line=>dirtyPathFromEntry(line)!==FILE_REL)},
    async readUnrelatedDirtyPaths(){return parseDirtyPaths(String(gitRead(['status','--porcelain=v1']))).filter(p=>p!==FILE_REL)},
    async rollback(){
      const bytes=fs.readFileSync(backupPath);if(sha256(bytes)!==LIVE_SHA256)fail('rollback_preimage_corrupt');
      const current=fs.lstatSync(FILE_ABS);const tmp=atomicWriteTemp(FILE_ABS,bytes,current,'rollback');fs.renameSync(tmp,FILE_ABS);
    },
    async verifyRollbackSha(expected){if(sha256(fs.readFileSync(FILE_ABS))!==expected)fail('rollback_sha_mismatch')},
    async cleanup(){if(candidatePath){try{fs.unlinkSync(candidatePath)}catch{}candidatePath=null}},
    backupPath,
  };
}

async function runProductionFixed(){
  const invocationId=crypto.randomUUID();
  const observed=inspectProductionState();
  const validated=validatePreconditions(observed.state);
  const io=createProductionIo(observed,invocationId);
  try{
    const result=await applyWithIo(io,observed.state);
    const finalHead=String(gitRead(['rev-parse','HEAD'])).trim();
    if(finalHead!==EXPECTED_HEAD)fail('head_changed_after_apply');
    const finalDirtyEntries=parseDirtyEntries(String(gitRead(['status','--porcelain=v1']))).filter(line=>dirtyPathFromEntry(line)!==FILE_REL);
    assertUnrelatedDirtyStatePreserved(validated.unrelatedDirtyEntries,finalDirtyEntries);
    const out={schema_version:'prhm.host-action-result.v1',ok:true,action:ACTION,invocation_id:invocationId,old_head:EXPECTED_HEAD,target_commit:TARGET_COMMIT,live_sha256:TARGET_SHA256,backup_path:io.backupPath,rollback_performed:false,database_mutation:false,git_ref_mutation:false,unrelated_dirty_state_preserved:true};
    ensureDir(RESULT_ROOT,0o700);fs.writeFileSync(path.join(RESULT_ROOT,'latest.json'),JSON.stringify(out,null,2)+'\n',{mode:0o600});
    return out;
  }catch(error){
    const out={schema_version:'prhm.host-action-result.v1',ok:false,action:ACTION,invocation_id:invocationId,error:String(error&&error.message||error).slice(0,4000),database_mutation:false,git_ref_mutation:false};
    try{ensureDir(RESULT_ROOT,0o700);fs.writeFileSync(path.join(RESULT_ROOT,'latest.json'),JSON.stringify(out,null,2)+'\n',{mode:0o600})}catch{}
    throw error;
  }
}

module.exports={
  ACTION,OPERATION,PROJECT,ROOT,FILE_REL,EXPECTED_BRANCH,EXPECTED_HEAD,TARGET_COMMIT,LIVE_SHA256,TARGET_SHA256,
  BACKUP_ROOT,RESULT_ROOT,SANDBOX,ALLOWED_GIT_READS,
  validatePreconditions,assertUnrelatedDirtyStatePreserved,applyWithIo,createMemoryIo,parseDirtyEntries,parseDirtyPaths,inspectProductionState,runProductionFixed,
};


if(require.main===module){
  runProductionFixed()
    .then(result=>{process.stdout.write(JSON.stringify(result)+'\n')})
    .catch(error=>{process.stderr.write(String(error&&error.message||error)+'\n');process.exitCode=1});
}
