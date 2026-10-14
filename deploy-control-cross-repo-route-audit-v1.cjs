'use strict';
/*
 * Source-only, read-only cross-repository workflow reconciliation.
 * This is NOT a deploy gate, approval issuer, registry route or authorization.
 * GitHub read callbacks are external trusted inputs provided by the reviewer.
 */
const crypto=require('node:crypto');
const FILE='.github/workflows/deploy-production.yml';
const ENTRIES=Object.freeze([
 Object.freeze({project:'aranob',repo:'prhmonline/aranob',
  main_commit:'6236cfdee8fcb54878ed8e225d9287cb09e6d3eb',
  main_blob:'f0334b9d88667ea621d2856e7cdac9eed6b359d3',
  draft_commit:'0454dd4bfb74e3064da36955006dd38426b12b82',
  draft_blob:'8ec2b4abf4a4e5ac3d22709184f2dd9acde50802'}),
 Object.freeze({project:'honartik_front',repo:'prhmonline/Honar-front-new',
  main_commit:'87580ce105eff53d7142d0ca1d5267d0f4097bb2',
  main_blob:'e0b72f6c724f12ed2d368ca000233d8cead904d6',
  draft_commit:'5a13a594fc0081dd202583df3f3d04b06aa34b4f',
  draft_blob:'c4a7a999638280ea1f8223eb75fa7003121ddc7f'}),
 Object.freeze({project:'honartik_back',repo:'prhmonline/honar-back-new',
  main_commit:'502376d0360a338f9522e4a2be5f9dccc91408d7',
  main_blob:'877e023cc640c1e1fdcbeb4989450a17caf7cda6',
  draft_commit:'c3a4b93035698315e1358a298316538bd2d2ce4b',
  draft_blob:'803fa07e2b833dc3660aef108f04179c266da9a6'})
]);
const CENTRAL=Object.freeze({
 repo:'prhmonline/deploy-control',path:'.github/workflows/deploy.yml',
 main_commit:'1910377815b3ed3c3c5da009dbcd12f52ec12629',
 main_blob:'f74c81bda229bdc341a53066b7fecada41dd0391',
 draft_commit:'e9d4b435a8bb73a507b2a7dd4affc4caa455d524',
 draft_blob:'89fe183a7fcd24f26b083f51fa88a7c8548807da'
});
const fail=c=>{throw Error('cross_repo_deploy_route_'+c)};
const gitBlob=b=>crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
function fetchExact(readGitFile,repo,sha,path,blob,label){
  const b=readGitFile(repo,sha,path);
  if(!Buffer.isBuffer(b)||b.length<500||b.length>12000||gitBlob(b)!==blob)
    fail('git_workflow_drift_'+label);
  return b.toString('utf8');
}
function dispatchMode(s,kind){
  if(!/^on:\n  workflow_dispatch:/m.test(s))fail('nonmanual_application_trigger_'+kind);
  if(/^  (?:push|pull_request|schedule|repository_dispatch|workflow_run):/m.test(s))
    fail('automatic_application_trigger_'+kind);
  if(!s.includes('[[ "$GITHUB_REF" == "refs/heads/main" ]]')||
     !s.includes('[[ "$CONFIRMATION" == "DEPLOY PRODUCTION" ]]')||
     !s.includes('"sha":"%s"')||
     !s.includes('"project":"'+kind+'"')||
     !s.includes('https://api.github.com/repos/prhmonline/deploy-control/dispatches'))
    fail('application_dispatch_semantics_'+kind);
}
function audit(readGitFile) {
  if(typeof readGitFile!=='function')fail('trusted_reader_required');
  const routes=[];
  for(const row of ENTRIES){
    const main=fetchExact(readGitFile,row.repo,row.main_commit,FILE,row.main_blob,'main_'+row.project);
    const draft=fetchExact(readGitFile,row.repo,row.draft_commit,FILE,row.draft_blob,'draft_'+row.project);
    dispatchMode(main,row.project);
    dispatchMode(draft,row.project);
    if(main.includes('approval_id')||main.includes('APPROVAL_ID'))
      fail('main_not_legacy_'+row.project);
    if(!draft.includes('      approval_id:')||
       !draft.includes('required: true')||
       !draft.includes('[[ "$APPROVAL_ID" =~')||
       !draft.includes('"approval_id":"%s"'))
      fail('missing_independent_approval_id_'+row.project);
    routes.push(Object.freeze({
      project:row.project,main_manual_only:true,draft_manual_only:true,
      main_sends_independent_approval:false,
      draft_sends_independent_approval:true,
      draft_not_merged_into_main:true
    }));
  }
  const main=fetchExact(readGitFile,CENTRAL.repo,CENTRAL.main_commit,CENTRAL.path,CENTRAL.main_blob,'central_main');
  const draft=fetchExact(readGitFile,CENTRAL.repo,CENTRAL.draft_commit,CENTRAL.path,CENTRAL.draft_blob,'central_draft');
  for(const [label,s] of [['main',main],['draft',draft]]){
    if(!s.includes('  repository_dispatch:')||!s.includes('  workflow_dispatch:')||
       !s.includes('runs-on: [self-hosted, Linux, X64]')||
       !s.includes('bash scripts/validate-event.sh'))
      fail('central_dispatch_contract_'+label);
  }
  if(main.includes('APPROVAL_ID')||main.includes('approval_id')||
     !main.includes('/home/deploy-control/bin/deploy-project "$PROJECT" "$SHA"'))
    fail('central_main_not_legacy');
  if(!draft.includes('APPROVAL_ID:')||!draft.includes('      approval_id:')||
     !draft.includes('bash scripts/validate-event.sh "$PROJECT" "$SHA" "$APPROVAL_ID"')||
     !draft.includes('/usr/local/libexec/deploy-control/deploy-project-authorized-v1.mjs "$PROJECT" "$SHA" "$APPROVAL_ID"')||
     draft.includes('/home/deploy-control/bin/deploy-project "$PROJECT" "$SHA"'))
    fail('central_draft_approval_route_not_bound');
  return Object.freeze({
    ok:true,
    phase:'read_only_git_workflow_audit',
    workflows_verified:8,
    app_projects:Object.freeze(routes),
    central_default_branch_legacy_entrypoint:true,
    central_draft_requires_approval_id:true,
    central_repository_dispatch_externally_triggerable:true,
    // A repo Git scan cannot attest to external webhooks, DeployHQ, server cron,
    // actual runner privileges, installed sudoers or runtime default branch.
    external_deployment_hooks_audited:false,
    effective_sudo_graph_audited:false,
    hosted_ci_pass:false,
    coordinated_rollout_required:true,
    can_merge:false,can_deploy:false,can_authorize:false,
    requires:'independently_reviewed_host_l4_installer_and_issuer_gate_then_sha_pinned_coordinated_cutover'
  });
}
module.exports=Object.freeze({FILE,ENTRIES,CENTRAL,audit});
