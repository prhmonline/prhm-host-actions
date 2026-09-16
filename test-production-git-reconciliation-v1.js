'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const mod=require('./production-git-reconciliation-v1.js');

test('unknown project id fails closed',()=>{
  assert.throws(()=>mod.resolveTarget('unknown_target'),/unknown_project_id/);
});
test('unproven production target stays disabled',()=>{
  assert.throws(()=>mod.resolveTarget('pbcinema_front_prod'),/target_not_enabled/);
});
test('test-only enabled target resolves immutable metadata',()=>{
  const registry={fixture:Object.freeze({project_id:'fixture',repository_root:'/tmp/fixture',expected_origin_repo:'prhmonline/fixture',expected_branch:'main',expected_upstream:'origin/main',enabled:true})};
  const target=mod._test.resolveTargetFromRegistry('fixture',registry);
  assert.equal(target.project_id,'fixture');
  assert.equal(target.expected_origin_repo,'prhmonline/fixture');
  assert.equal(Object.isFrozen(target),true);
});

test('sanitizes supported GitHub remote formats',()=>{
  assert.equal(mod.sanitizeOriginRepo('git@github.com:prhmonline/Honar-front-new.git'),'prhmonline/Honar-front-new');
  assert.equal(mod.sanitizeOriginRepo('ssh://git@github.com/prhmonline/Honar-front-new.git'),'prhmonline/Honar-front-new');
  assert.equal(mod.sanitizeOriginRepo('https://github.com/prhmonline/Honar-front-new.git'),'prhmonline/Honar-front-new');
  assert.equal(mod.sanitizeOriginRepo('https://user:TOP_SECRET_TOKEN@github.com/prhmonline/Honar-front-new.git'),'prhmonline/Honar-front-new');
});

test('rejects unsafe or unrecognized remotes without secret leakage',()=>{
  for(const raw of ['https://evil.example/prhmonline/repo.git','https://github.com/a/b/c.git','not-a-url']){
    assert.throws(()=>mod.sanitizeOriginRepo(raw),/unsafe_or_unrecognized_origin/);
  }
  const serialized=JSON.stringify({repo:mod.sanitizeOriginRepo('https://user:TOP_SECRET_TOKEN@github.com/prhmonline/repo.git')});
  assert.equal(serialized.includes('TOP_SECRET_TOKEN'),false);
});

test('probe uses only fixed read-only git observations and returns counts only',()=>{
  const target=Object.freeze({project_id:'fixture',repository_root:'/tmp/f',expected_origin_repo:'prhmonline/repo',expected_branch:'main',expected_upstream:'origin/main',enabled:true});
  const calls=[];
  const responses=new Map([
    ['rev-parse --is-inside-work-tree','true\n'],
    ['rev-parse HEAD','0123456789abcdef0123456789abcdef01234567\n'],
    ['symbolic-ref --short HEAD','main\n'],
    ['status --porcelain=v1 -z',' M secret.txt\0?? untracked.txt\0'],
    ['config --get remote.origin.url','https://user:TOP_SECRET_TOKEN@github.com/prhmonline/repo.git\n'],
    ['rev-parse --verify origin/main','89abcdef0123456789abcdef0123456789abcdef\n'],
    ['rev-list --left-right --count origin/main...HEAD','2\t1\n']
  ]);
  const execGit=(args)=>{const key=args.join(' ');calls.push(key);if(!responses.has(key))throw new Error('unexpected:'+key);return responses.get(key);};
  const out=mod.probeRepository(target,execGit);
  assert.equal(out.dirty,true);
  assert.equal(out.tracked_modified_count,1);
  assert.equal(out.untracked_count,1);
  assert.equal(out.ahead,1);
  assert.equal(out.behind,2);
  assert.equal(out.origin_repo,'prhmonline/repo');
  const json=JSON.stringify(out);
  assert.equal(json.includes('secret.txt'),false);
  assert.equal(json.includes('untracked.txt'),false);
  assert.equal(json.includes('TOP_SECRET_TOKEN'),false);
  assert.deepEqual(calls,[
    'rev-parse --is-inside-work-tree','rev-parse HEAD','symbolic-ref --short HEAD','status --porcelain=v1 -z','config --get remote.origin.url','rev-parse --verify origin/main','rev-list --left-right --count origin/main...HEAD'
  ]);
});

test('probe rejects origin mismatch and detached head without repair',()=>{
  const base={project_id:'fixture',repository_root:'/tmp/f',expected_origin_repo:'prhmonline/repo',expected_branch:'main',expected_upstream:'origin/main',enabled:true};
  const mismatch=(args)=>{
    const k=args.join(' ');
    if(k==='rev-parse --is-inside-work-tree')return 'true\n';
    if(k==='rev-parse HEAD')return '0123456789abcdef0123456789abcdef01234567\n';
    if(k==='symbolic-ref --short HEAD')return 'main\n';
    if(k==='status --porcelain=v1 -z')return '';
    if(k==='config --get remote.origin.url')return 'https://github.com/evil/repo.git\n';
    throw new Error('unexpected');
  };
  assert.throws(()=>mod.probeRepository(base,mismatch),/origin_repo_mismatch/);
});

test('classifies local tracking deterministically',()=>{
  assert.equal(mod.classifyLocalTracking({dirty:true,detached_head:false,ahead:0,behind:0}),'DIRTY');
  assert.equal(mod.classifyLocalTracking({dirty:false,detached_head:true,ahead:0,behind:0}),'DETACHED');
  assert.equal(mod.classifyLocalTracking({dirty:false,detached_head:false,ahead:0,behind:0}),'MATCH_LOCAL_TRACKING');
  assert.equal(mod.classifyLocalTracking({dirty:false,detached_head:false,ahead:1,behind:0}),'AHEAD_LOCAL_TRACKING');
  assert.equal(mod.classifyLocalTracking({dirty:false,detached_head:false,ahead:0,behind:2}),'BEHIND_LOCAL_TRACKING');
  assert.equal(mod.classifyLocalTracking({dirty:false,detached_head:false,ahead:1,behind:2}),'DIVERGED_LOCAL_TRACKING');
});

test('buildResult exposes approved keys only',()=>{
  const obs={is_git_repository:true,branch:'main',head_sha:'0123456789abcdef0123456789abcdef01234567',origin_repo:'prhmonline/repo',upstream_branch:'origin/main',dirty:false,tracked_modified_count:0,untracked_count:0,ahead:0,behind:0,detached_head:false,remote_tracking_freshness:'unknown'};
  const out=mod.buildResult('fixture','/fixed/path',obs);
  const approved=new Set(['ok','project_id','repository_root','is_git_repository','branch','head_sha','origin_repo','upstream_branch','dirty','tracked_modified_count','untracked_count','ahead','behind','detached_head','remote_tracking_freshness','classification']);
  assert.equal(Object.keys(out).every(k=>approved.has(k)),true);
  assert.equal(out.classification,'MATCH_LOCAL_TRACKING');
});

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');

test('executor source contains no write-capable git command surface',()=>{
  const source=fs.readFileSync(path.join(__dirname,'production-git-reconciliation-v1.js'),'utf8');
  for(const token of ['fetch','pull','checkout','reset','clean','stash','commit','push','merge','rebase','config --add','config --global']){
    assert.equal(source.includes("'"+token+"'"),false,token);
    assert.equal(source.includes('"'+token+'"'),false,token);
  }
});

test('hostile project ids fail before any git executor can run',()=>{
  for(const value of ['../../etc','honartik_front_prod;rm -rf /','$(id)','/home/prhm/...','https://evil.example/repo.git']){
    let calls=0;
    assert.throws(()=>{mod.resolveTarget(value);calls++;},/unknown_project_id/);
    assert.equal(calls,0);
  }
});

function snapshotTree(root){
  const out={};
  function walk(dir){for(const name of fs.readdirSync(dir).sort()){const full=path.join(dir,name);const rel=path.relative(root,full);const st=fs.lstatSync(full);if(st.isDirectory()){out[rel]={type:'dir',mode:st.mode&0o777};walk(full);}else if(st.isFile()){out[rel]={type:'file',mode:st.mode&0o777,sha:crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')};}}}
  walk(root);return out;
}

test('real fixture probe leaves git repo bytes and refs unchanged',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-git-reconcile-'));
  try{
    cp.execFileSync('git',['init','-b','main'],{cwd:dir,stdio:'ignore'});
    cp.execFileSync('git',['config','user.email','fixture@example.test'],{cwd:dir});
    cp.execFileSync('git',['config','user.name','Fixture'],{cwd:dir});
    fs.writeFileSync(path.join(dir,'a.txt'),'hello\n');
    cp.execFileSync('git',['add','a.txt'],{cwd:dir});
    cp.execFileSync('git',['commit','-m','init'],{cwd:dir,stdio:'ignore'});
    cp.execFileSync('git',['remote','add','origin','https://github.com/prhmonline/fixture.git'],{cwd:dir});
    cp.execFileSync('git',['update-ref','refs/remotes/origin/main','HEAD'],{cwd:dir});
    const before=snapshotTree(dir);
    const target={project_id:'fixture',repository_root:dir,expected_origin_repo:'prhmonline/fixture',expected_branch:'main',expected_upstream:'origin/main',enabled:true};
    const execGit=(args)=>cp.execFileSync('git',args,{cwd:dir,encoding:'utf8'});
    const out=mod.probeRepository(target,execGit);
    assert.equal(out.dirty,false);
    const after=snapshotTree(dir);
    assert.deepEqual(after,before);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('verified CF Park frontend target is the only enabled production mapping',()=>{
  const target=mod.resolveTarget('cfpark_front_prod');
  assert.equal(target.repository_root,'/home/cfpark/domains/cfpark.ir/public_html');
  assert.equal(target.expected_origin_repo,'prhmonline/cfpark_new_front');
  assert.equal(target.expected_branch,'main');
  assert.equal(target.expected_upstream,'origin/main');
  assert.equal(target.enabled,true);
  for(const id of ['honartik_front_prod','honartik_back_prod','pbcinema_front_prod','pbcinema_back_prod','moeinshow_front_prod','moeinshow_back_prod','cfpark_back_prod']){
    assert.throws(()=>mod.resolveTarget(id),/target_not_enabled/);
  }
});
