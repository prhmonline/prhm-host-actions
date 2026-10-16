'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const p=require('./deploy-control-live-runtime-evidence-v1.cjs');
const entries=[
 'etc/sudoers.d/aranob-deploy-runner',
 'etc/sudoers.d/deploy-control-honartik',
 'etc/sudoers.d/honartik-staging-canonical-dry-run',
 'opt/prhm-agent-selfmaint/server.js',
 'opt/prhm-agent-selfmaint-exec/server.js',
 'opt/prhm-company-control-plane/config/approval-policy.json',
 'home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'
];
function fixture(){
 const files=Object.fromEntries(Object.entries(p.checked).map(([path,[digest,uid,gid,mode]])=>
   [path,{sha256:digest,uid,gid,mode,type:'regular'}]));
 return {
   files,sudo:[...p.permits],
   backup:{...p.expectedBackup,verified:true,requiredEntries:[...entries]},
   issuer:{
     ok:true,policy_version:'2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1',
     policy_hash:'c141ce7d56bf1de9c11a6e98b0abd6d20da9a349a6cbe1735c5bb659e3a70fea',
     algorithm:'Ed25519',one_time_use:true,operations:75
   },
   registry:{ok:true,host_actions_v2:['host_action_v2_installer_v1','root_scripts_fixed_stage_v1']},
   absent:[...p.missing]
 };
}
function denies(mutator,reason){
 const f=fixture();mutator(f);
 assert.throws(()=>p.validate(f),new RegExp('deploy_control_runtime_preflight_'+reason));
}
test('all exact observed runtime preimages and backup are structurally confirmed, never authorize install',()=>{
 const result=p.validate(fixture());
 assert.equal(result.ok,true);
 assert.equal(result.files_checked,12);
 assert.equal(result.sudo_grants_checked,4);
 assert.equal(result.may_install,false);
 assert.equal(result.host_registered,false);
 assert.equal(result.production_executable,false);
 assert.equal(result.signed_level4_approval_verified,false);
 assert.equal(typeof p.install,'undefined');
 assert.equal(typeof p.apply,'undefined');
});
test('reject unknown evidence schema or absent operator supplied content',()=>{
 denies(f=>{delete f.backup},'schema');
 denies(f=>{f.token='not_allowed'},'schema');
 denies(f=>{delete f.files[Object.keys(f.files)[0]]},'missing_or_unreviewed_file');
 denies(f=>{f.files['/etc/passwd']={}},'missing_or_unreviewed_file');
});
test('reject any changed owner/preimage, symlink, or writable sudoers modes',()=>{
 for(const path of Object.keys(p.checked)){
   denies(f=>{f.files[path].sha256='f'.repeat(64)},'file_preimage_or_ownership_drift');
   denies(f=>{f.files[path].mode=0o777},'file_preimage_or_ownership_drift');
   denies(f=>{f.files[path].type='symlink'},'file_preimage_or_ownership_drift');
 }
 denies(f=>{const k=Object.keys(f.files)[0];f.files[k].uid=1000},'file_preimage_or_ownership_drift');
});
test('exactly 3 historical production grants and unchanged staging grant; refuse extra/missing/duplicates',()=>{
 denies(f=>{f.sudo.push('(ALL) NOPASSWD: ALL')},'unreviewed_sudo_grants');
 denies(f=>{f.sudo.pop()},'unreviewed_sudo_grants');
 denies(f=>{f.sudo[0]=f.sudo[1]},'unreviewed_sudo_grants');
 denies(f=>{f.sudo[0]=f.sudo[0].replace(' *','')},'unreviewed_sudo_grants');
});
test('backup digest, length, archive entries and verified flag are all mandatory',()=>{
 denies(f=>{f.backup.sha256='0'.repeat(64)},'backup_missing_or_unverified');
 denies(f=>{f.backup.size=200},'backup_missing_or_unverified');
 denies(f=>{f.backup.verified=false},'backup_missing_or_unverified');
 denies(f=>{f.backup.requiredEntries.pop()},'backup_missing_or_unverified');
 denies(f=>{f.backup.requiredEntries[0]='etc/shadow'},'backup_missing_or_unverified');
});
test('an installed candidate or missing expected absence requires new review, never silently passes',()=>{
 denies(f=>{f.absent.pop()},'existing_candidate_unreviewed');
 denies(f=>{f.absent.push('/etc/passwd')},'existing_candidate_unreviewed');
 denies(f=>{f.absent[0]=f.absent[1]},'existing_candidate_unreviewed');
});
test('issuer changes and weakened cryptographic/one-time controls refuse preinstallation evidence',()=>{
 denies(f=>{f.issuer.policy_version='2026-10-15.1-deploy-control-l4-installer-enrollment-v1'},'issuer_not_preimage');
 denies(f=>{f.issuer.policy_hash='f'.repeat(64)},'issuer_not_preimage');
 denies(f=>{f.issuer.algorithm='HS256'},'issuer_not_preimage');
 denies(f=>{f.issuer.one_time_use=false},'issuer_not_preimage');
 denies(f=>{f.issuer.operations=76},'issuer_not_preimage');
});
test('new registry action or unhealthy registry invalidates this PRE-install snapshot',()=>{
 denies(f=>{f.registry.host_actions_v2.push('deploy_control_cutover_install_v1')},'unexpected_registration_state');
 denies(f=>{f.registry.ok=false},'unexpected_registration_state');
});
