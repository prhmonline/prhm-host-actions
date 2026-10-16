'use strict';
// Exact, read-only PRHM production legacy runtime evidence contract.
// NOT a root installer, NOT an approval issuer, NOT an execution gate.
// Every evidence item is an injected read-only snapshot, which MUST be
// independently re-collected and authenticated by the trusted operator.
const crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=c=>{throw new Error('deploy_control_runtime_preflight_'+c)};
const checked=Object.freeze({
 '/opt/prhm-agent-selfmaint/server.js': ['4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',0,0,0o644],
 '/opt/prhm-agent-selfmaint-exec/server.js': ['410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',0,0,0o755],
 '/opt/prhm-company-control-plane/config/approval-policy.json': ['148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',0,0,0o644],
 '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js': ['bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166',0,0,0o600],
 '/etc/sudoers.d/aranob-deploy-runner': ['e097c3bbf78cac08ce8083d695db3ab5a6420462465085ec44ad866d5be0f79d',0,0,0o440],
 '/etc/sudoers.d/deploy-control-honartik': ['5c03114513c2770d3a77d32047c8911ddb5c4adcddea3fd3ed173d376ed5803e',0,0,0o440],
 '/etc/sudoers.d/honartik-staging-canonical-dry-run': ['0c0d3bd5f4830826e34e703c87436fad04676599e1ea2c62570a74705a2b3b19',0,0,0o440],
 '/home/deploy-control/bin/deploy-project': ['ec0252dd5686f74dd82adcfbb2c4b0d546eb71729e99e8d6c2d0ed44f661406a',0,1016,0o750],
 '/home/prhm/deploy/aranob-production.sh': ['4b659571c0e80e3d6dbf58538f6bfdfbfe263a5250c7fbab16ded2606514f58b',1011,1012,0o700],
 '/usr/local/libexec/deploy-control/honartik-front-production': ['ee0ac1f91b1da3058d82aa71426a6dd329fd1e2791766d476634f3e2456a363e',0,0,0o755],
 '/usr/local/libexec/deploy-control/honartik-back-production': ['6bc7e800bc6a5b37943d4de0eda7ccbb2e036016f00f48506553c6a75681a8cf',0,0,0o755],
 '/usr/local/libexec/prhm-agent/honartik-staging-canonical-dry-run': ['c71127722e4a8b93176aa0d1708de2fd083fd11681278af921da682cf0c905b1',0,0,0o755]
});
const permits=Object.freeze([
 '(prhm) NOPASSWD: /home/prhm/deploy/aranob-production.sh *',
 '(root) NOPASSWD: /usr/local/libexec/deploy-control/honartik-front-production *',
 '(honartik) NOPASSWD: /usr/local/libexec/deploy-control/honartik-back-production *',
 '(root) NOPASSWD: /usr/local/libexec/prhm-agent/honartik-staging-canonical-dry-run ""'
]);
const expectedBackup=Object.freeze({
 path:'/root/prhm-cutover-backup-8ntRjFRD/preimage.tar',
 size:215040,
 sha256:'8108ef30c1a5b56fc25bebf52a67857ec77165c4c159354c876e622e0e0304b2'
});
const missing=Object.freeze([
 '/usr/local/libexec/deploy-control/deploy-project-authorized-v1.mjs',
 '/usr/local/libexec/deploy-control/production-approval-core.mjs',
 '/etc/prhm-deploy-control/approval-gate.json',
 '/etc/sudoers.d/prhm-deploy-control-gated'
]);
const sorted=a=>[...a].sort();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function validate(snapshot) {
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||
   !same(sorted(Object.keys(snapshot)),sorted(['files','sudo','backup','issuer','registry','absent'])))
   fail('schema');
 if(!snapshot.files||typeof snapshot.files!=='object'||Array.isArray(snapshot.files)||
   !same(sorted(Object.keys(snapshot.files)),sorted(Object.keys(checked))))
   fail('missing_or_unreviewed_file');
 for(const [p,[digest,uid,gid,mode]] of Object.entries(checked)){
   const f=snapshot.files[p];
   if(!f||Object.keys(f).sort().join('|')!=='gid|mode|sha256|type|uid'||
     f.type!=='regular'||f.sha256!==digest||f.uid!==uid||f.gid!==gid||f.mode!==mode)
      fail('file_preimage_or_ownership_drift');
 }
 if(!Array.isArray(snapshot.sudo)||!same(sorted(snapshot.sudo),sorted(permits))||
     new Set(snapshot.sudo).size!==permits.length)
   fail('unreviewed_sudo_grants');
 const b=snapshot.backup;
 if(!b||b.path!==expectedBackup.path||b.size!==expectedBackup.size||
    b.sha256!==expectedBackup.sha256||b.verified!==true||
    !Array.isArray(b.requiredEntries)||b.requiredEntries.length!==7||
    !same(sorted(b.requiredEntries),sorted([
       'etc/sudoers.d/aranob-deploy-runner','etc/sudoers.d/deploy-control-honartik',
       'etc/sudoers.d/honartik-staging-canonical-dry-run',
       'opt/prhm-agent-selfmaint/server.js','opt/prhm-agent-selfmaint-exec/server.js',
       'opt/prhm-company-control-plane/config/approval-policy.json',
       'home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'
    ])))fail('backup_missing_or_unverified');
 if(!same(sorted(snapshot.absent),sorted(missing)))fail('existing_candidate_unreviewed');
 const i=snapshot.issuer;
 if(!i||i.ok!==true||i.policy_version!=='2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1'||
    i.policy_hash!=='c141ce7d56bf1de9c11a6e98b0abd6d20da9a349a6cbe1735c5bb659e3a70fea'||
    i.algorithm!=='Ed25519'||i.one_time_use!==true||i.operations!==75)
    fail('issuer_not_preimage');
 const r=snapshot.registry;
 if(!r||r.ok!==true||!Array.isArray(r.host_actions_v2)||
    r.host_actions_v2.includes('deploy_control_cutover_install_v1'))
    fail('unexpected_registration_state');
 return Object.freeze({
  ok:true,evidence_only:true,files_checked:Object.keys(checked).length,
  sudo_grants_checked:permits.length,preimage_backup_sha256:expectedBackup.sha256,
  unregistered_action:'deploy_control_cutover_install_v1',
  external_triggers_fully_audited:false,
  signed_level4_approval_verified:false,host_registered:false,
  production_executable:false,may_install:false,
  instructions:'Independent trusted L4 action registration, external trigger review, real rollback and fresh signed exact-SHA human authorization still mandatory.'
 });
}
module.exports=Object.freeze({checked,permits,expectedBackup,missing,validate});
