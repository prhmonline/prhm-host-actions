'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const g=require('./deploy-control-cross-repo-route-audit-v1.cjs');
const folder=process.env.PRHM_ROUTE_GIT_BLOB_FIXTURES;
const sha=/^[0-9a-f]{40}$/;
function id(repo,commit){
  const entry=g.ENTRIES.find(x=>x.repo===repo)||g.CENTRAL;
  const typ=commit===entry.main_commit?'main':commit===entry.draft_commit?'draft':null;
  if(!typ)throw Error('untrusted_commit_id');
  return (entry===g.CENTRAL?'central':entry.project)+'-'+typ+'.yml';
}
function reader(repo,commit,p){
  const row=g.ENTRIES.find(x=>x.repo===repo)|| (repo===g.CENTRAL.repo?g.CENTRAL:null);
  assert.ok(row,'untrusted_repo');
  assert.equal(p,row===g.CENTRAL?g.CENTRAL.path:g.FILE);
  return fs.readFileSync(path.join(folder,id(repo,commit)));
}
test('read-only entrypoints and exact branch source identities',()=>{
  assert.deepEqual(Object.keys(g).sort(),['FILE','ENTRIES','CENTRAL','audit'].sort());
  assert.equal(g.ENTRIES.length,3);
  assert.equal(g.CENTRAL.repo,'prhmonline/deploy-control');
  for(const row of [...g.ENTRIES,g.CENTRAL]){
    assert.ok(sha.test(row.main_commit));
    assert.ok(sha.test(row.draft_commit));
    assert.ok(sha.test(row.main_blob));
    assert.ok(sha.test(row.draft_blob));
    assert.notEqual(row.main_commit,row.draft_commit);
    assert.notEqual(row.main_blob,row.draft_blob);
  }
  assert.throws(()=>g.audit(),/trusted_reader_required/);
});
if(!folder){
  test('eight exact GitHub workflow blobs are mandatory',{skip:'Provide PRHM_ROUTE_GIT_BLOB_FIXTURES'},()=>{});
}else{
  test('current main and independent-approval draft workflows differ exactly as reviewed',()=>{
    const result=g.audit(reader);
    assert.equal(result.ok,true);
    assert.equal(result.workflows_verified,8);
    assert.deepEqual(result.app_projects.map(x=>x.project),['aranob','honartik_front','honartik_back']);
    assert.equal(result.central_default_branch_legacy_entrypoint,true);
    assert.equal(result.central_draft_requires_approval_id,true);
    assert.equal(result.central_repository_dispatch_externally_triggerable,true);
    assert.equal(result.external_deployment_hooks_audited,false);
    assert.equal(result.effective_sudo_graph_audited,false);
    assert.equal(result.hosted_ci_pass,false);
    for(const k of ['can_merge','can_deploy','can_authorize'])assert.equal(result[k],false);
  });
  test('source blob change or unpinned main file fails even if it looks safe',()=>{
    const row=g.ENTRIES[0];
    const bad=(repo,commit,p)=>{
      const b=reader(repo,commit,p);
      if(repo===row.repo&&commit===row.main_commit)return Buffer.concat([b,Buffer.from('# drift\n')]);
      return b;
    };
    assert.throws(()=>g.audit(bad),/git_workflow_drift_main_aranob/);
    const missing=(repo,commit,p)=>{
      if(repo===g.CENTRAL.repo&&commit===g.CENTRAL.draft_commit)return null;
      return reader(repo,commit,p);
    };
    assert.throws(()=>g.audit(missing),/git_workflow_drift_central_draft/);
  });
  test('removing a draft approval field, adding a push trigger or changing central executor is denied',()=>{
    const experiments=[
      ['honartik_front-draft.yml',x=>x.replace('"approval_id":"%s"','"approval_missing":"%s"'),/git_workflow_drift_draft_honartik_front/],
      ['aranob-main.yml',x=>x.replace('  workflow_dispatch:', '  push:\\n    branches: [main]\\n  workflow_dispatch:'),/git_workflow_drift_main_aranob/],
      ['central-draft.yml',x=>x.replace('deploy-project-authorized-v1.mjs','deploy-project-legacy.sh'),/git_workflow_drift_central_draft/]
    ];
    for(const [file,change,expected] of experiments){
      const data=Buffer.from(change(fs.readFileSync(path.join(folder,file),'utf8')));
      const keys=file.replace(/\\.yml$/,'').split('-');
      const phase=keys.pop(),project=keys.join('-');
      const entry=project==='central'?g.CENTRAL:g.ENTRIES.find(e=>e.project===project);
      const commit=phase==='main'?entry.main_commit:entry.draft_commit;
      const candidate=(repo,sha,p)=>repo===entry.repo&&sha===commit?data:reader(repo,sha,p);
      assert.throws(()=>g.audit(candidate),expected,file);
    }
  });
  test('wrong repository, commit or workflow path cannot be used as a fixture reader',()=>{
    assert.throws(()=>reader('prhmonline/unknown','a'.repeat(40),g.FILE),/untrusted_repo/);
    assert.throws(()=>reader(g.ENTRIES[0].repo,'f'.repeat(40),g.FILE),/untrusted_commit_id/);
    assert.throws(()=>reader(g.ENTRIES[0].repo,g.ENTRIES[0].main_commit,'../../.env'),/Expected values to be strictly equal/);
  });
}
