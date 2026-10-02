'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const IMPL=path.join(__dirname,'cfpark-front-production-closure-v1.js');
function load(){delete require.cache[require.resolve(IMPL)];return require(IMPL)}

test('exports fixed Level-3 CF Park closure contract',()=>{
  const m=load();
  assert.equal(m.ACTION,'cfpark_front_production_closure_v1');
  assert.equal(m.RISK_LEVEL,3);
  assert.equal(m.REPO,'/home/cfpark/domains/cfpark.ir/public_html');
  assert.equal(m.EXPECTED_HEAD,'55edc23883fb08622029611db55173885bf1f41b');
  assert.equal(m.EXPECTED_BRANCH,'main');
  assert.equal(m.EXPECTED_OLD_UPSTREAM,'origin/main');
  assert.equal(m.NEW_UPSTREAM,'origin/production/cfpark');
  assert.equal(m.UNTRACKED_FILE,'src/app/layout.tsx.bak-ga4-20260721-233702');
  assert.equal(m.UNTRACKED_SHA256,'3b5d375fef66d4f214e3a5ebe9d2bab0b082187285158f1d42d0718efaf055f9');
});

test('source exposes no destructive git verbs or deploy/service surface',()=>{
  const source=fs.readFileSync(IMPL,'utf8');
  for(const token of ['checkout','reset','pull','clean','stash','commit','push','merge','rebase']) assert.equal(source.includes("'"+token+"'"),false,token);
  assert.doesNotMatch(source,/systemctl|service\s|npm\s|yarn\s|pm2|deploy/i);
});

test('preflight fails closed on any preimage mismatch',()=>{
  const m=load();
  const base={head:m.EXPECTED_HEAD,branch:m.EXPECTED_BRANCH,upstream:m.EXPECTED_OLD_UPSTREAM,untracked:[m.UNTRACKED_FILE],untracked_sha256:m.UNTRACKED_SHA256};
  assert.equal(m.validatePreimage(base),true);
  for(const patch of [{head:'0'.repeat(40)},{branch:'dev'},{upstream:'origin/dev'},{untracked:[]},{untracked:['x']},{untracked_sha256:'f'.repeat(64)}]){
    assert.throws(()=>m.validatePreimage({...base,...patch}));
  }
});

test('action plan uses only fixed backup fetch set-upstream verify steps',()=>{
  const m=load();
  assert.deepEqual(m.buildPlan().map(x=>x.kind),['backup','fetch','set_upstream','verify']);
  const fetch=m.buildPlan().find(x=>x.kind==='fetch');
  assert.deepEqual(fetch.args,['fetch','origin','refs/heads/production/cfpark:refs/remotes/origin/production/cfpark']);
  const set=m.buildPlan().find(x=>x.kind==='set_upstream');
  assert.deepEqual(set.args,['branch','--set-upstream-to=origin/production/cfpark','main']);
});

test('success path preserves HEAD and returns clean 0/0 state',async()=>{
  const m=load();
  const state={upstream:'origin/main',backedUp:false,removed:false};
  const deps={
    inspect:async()=>({head:m.EXPECTED_HEAD,branch:'main',upstream:state.upstream,untracked:state.removed?[]:[m.UNTRACKED_FILE],untracked_sha256:m.UNTRACKED_SHA256,ahead:0,behind:0}),
    backup:async()=>{state.backedUp=true;state.removed=true;return '/var/backups/cfpark-front-production-closure-v1/file.bak';},
    git:async args=>{if(args[0]==='fetch')return '';if(args[0]==='branch'){state.upstream='origin/production/cfpark';return '';}throw new Error('unexpected_git');},
    restoreUpstream:async old=>{state.upstream=old;}
  };
  const out=await m.runClosure(deps);
  assert.equal(out.ok,true);
  assert.equal(out.head,m.EXPECTED_HEAD);
  assert.equal(out.upstream,'origin/production/cfpark');
  assert.equal(out.dirty,false);
  assert.equal(out.ahead,0);
  assert.equal(out.behind,0);
  assert.equal(state.backedUp,true);
});

test('failure after upstream mutation rolls upstream back and preserves backup',async()=>{
  const m=load();
  const state={upstream:'origin/main',removed:false,backedUp:false,verifyCount:0};
  const deps={
    inspect:async()=>{state.verifyCount++;return {head:state.verifyCount>1?'f'.repeat(40):m.EXPECTED_HEAD,branch:'main',upstream:state.upstream,untracked:state.removed?[]:[m.UNTRACKED_FILE],untracked_sha256:m.UNTRACKED_SHA256,ahead:0,behind:0};},
    backup:async()=>{state.backedUp=true;state.removed=true;return '/var/backups/cfpark-front-production-closure-v1/file.bak';},
    git:async args=>{if(args[0]==='fetch')return '';if(args[0]==='branch'){state.upstream='origin/production/cfpark';return '';}throw new Error('unexpected_git');},
    restoreUpstream:async old=>{state.upstream=old;}
  };
  await assert.rejects(()=>m.runClosure(deps));
  assert.equal(state.upstream,'origin/main');
  assert.equal(state.backedUp,true);
});

test('backup destination is fixed outside the worktree',()=>{
  const m=load();
  assert.equal(m.BACKUP_DIR,'/var/backups/cfpark-front-production-closure-v1');
  assert.equal(m.BACKUP_DIR.startsWith(m.REPO),false);
  assert.throws(()=>m.validateBackupPath('/tmp/file.bak'));
  assert.equal(m.validateBackupPath('/var/backups/cfpark-front-production-closure-v1/layout.tsx.bak'),true);
});
