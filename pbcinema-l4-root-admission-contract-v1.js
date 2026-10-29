'use strict';
// Source-only trust contract for issue #229. NO privileged mutation or installer is exported.
const fs=require('node:fs');
const crypto=require('node:crypto');

const RELEASE=Object.freeze({
  universal_git_sha:'3fb179c95bb1d7b0c4efff2f1f16d256e4da0dc1',
  disabled_profile_digest:'66ba2375326df8d9b771473d3229a4c3207ffb3576253286dc23a60a41176fd2',
  front_sha:'e46294635ac614a91f252c05fa1bad9dac53630f',
  back_sha:'a8bcf98097f56e6e653d89a3ad4a89df799fda87',
  database:'cfpark_park_bazar',
  db_endpoint:'127.0.0.1:3307',
  db_user:'pbcinema_universal_backup',
  secret_file:'/etc/deploy-control/secrets/pbcinema/mysql.cnf',
  vhost_sha256:'bcd905fc86d1980166e365e41358f2efcc979d92c0f5b7e43bf14e7a95f3d059'
});

const TARGETS=Object.freeze({
  base: Object.freeze({path:'/opt/prhm-agent-selfmaint/server.js',sha256:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406'}),
  executor: Object.freeze({path:'/opt/prhm-agent-selfmaint-exec/server.js',sha256:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0'}),
  policy: Object.freeze({path:'/opt/prhm-company-control-plane/config/approval-policy.json',sha256:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174'}),
  mcp: Object.freeze({path:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',sha256:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'}),
  mcp_candidate: Object.freeze({path:'/home/agent/candidates/agent3-safe-delivery-profile-expansion/mcp/src/plugins/hostActionsV2.js',sha256:'48be2ff7e8cff6f48e4f48b88651b26321e917aec1adbba4081a2dd3350d26e7'})
});

const ACTIONS=Object.freeze([
  Object.freeze({action:'pbcinema_mysql_backup_credential_issue_v1',operation:'host_action.pbcinema_mysql_backup_credential_issue_v1',requires: Object.freeze(['root-owned secret directory 0700 and file 0600','single schema SELECT SHOW VIEW TRIGGER EVENT with no global or write grants','verified Docker grant-host source','credential does not appear in logs, argv, Git or API output','rollback newly issued account and credential if verification fails'])}),
  Object.freeze({action:'pbcinema_universal_installer_upgrade_v1',operation:'host_action.pbcinema_universal_installer_upgrade_v1',requires:Object.freeze(['exact reviewed Git SHA and canonical disabled profile digest','first-release legacy+Apache snapshot with tested rollback','restore database in image-pinned network-isolated MariaDB','no Yii migration and no shared PHP-FPM restart','reject changed prod baseline and preserve disabled config until admission succeeds'])})
]);

function sha256(x){return crypto.createHash('sha256').update(x).digest('hex');}
function refuse(reason){throw new Error('pbcinema_root_admission_denied:'+reason);}
function exactApproval(a) {
  if(!a||a.second_confirmation!=='CONFIRM_LEVEL_4_CRITICAL')refuse('critical_confirmation_missing');
  if(a.level!==4||a.risk!=='critical'||a.project!=='control_plane'||a.environment!=='production')refuse('scope');
  if(a.universal_git_sha!==RELEASE.universal_git_sha||a.disabled_profile_digest!==RELEASE.disabled_profile_digest)refuse('release');
  if(!ACTIONS.some(x=>x.action===a.action&&x.operation===a.operation))refuse('action');
  if(a.signed!==true||a.one_time!==true||a.expired!==false||a.consumed!==false)refuse('issuer_state');
  // This function checks decoded metadata only. Signature, replay and expiry MUST
  // be independently verified by the pre-existing trusted issuer, not by this module.
  return true;
}
function inspectOwners({readFile=fs.readFileSync,lstat=fs.lstatSync,targets=TARGETS}={}) {
  const source={};
  for(const [key,target] of Object.entries(targets)){
    let st,bytes;
    try{st=lstat(target.path);bytes=readFile(target.path);}catch{refuse('missing_owner:'+key);}
    if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o022)!==0)refuse('untrusted_owner:'+key);
    if(sha256(bytes)!==target.sha256)refuse('owner_sha_drift:'+key);
    source[key]=bytes.toString('utf8');
  }
  if(!source.base||!source.executor||!source.mcp||!source.mcp_candidate)refuse('incomplete_owner_inventory');
  let policy;
  try{policy=JSON.parse(source.policy);}catch{refuse('policy_json_invalid');}
  if(policy.enabled!==true||policy.default_deny!==true||!policy.operations||!Array.isArray(policy.typed_scopes))refuse('policy_not_fail_closed');
  for(const a of ACTIONS) {
    if(policy.operations[a.operation]!==undefined)refuse('already_registered:'+a.action);
    for(const owner of ['base','executor','mcp','mcp_candidate'])if(source[owner].includes(a.action))refuse('partial_registration:'+owner+':'+a.action);
  }
  return Object.freeze({ready_for_review:true,already_registered:false,production_changed:false,source_sha256:Object.freeze(Object.fromEntries(Object.entries(targets).map(([k,v])=>[k,v.sha256])))});
}
function registrationProposal() {
  // This is a data declaration, NOT a signed request or an executable host action.
  return Object.freeze({schema_version:'prhm.pbcinema-l4-root-registration-contract.v1',
    release:RELEASE,actions:ACTIONS,targets:TARGETS,
    approval:Object.freeze({issuer:'existing trusted approval center',level:4,risk:'critical',one_time:true,critical_literal:'CONFIRM_LEVEL_4_CRITICAL',signed_exact_binding:true}),
    installable:false,reason:'root-provider issuer/executor implementations and independent review are required'});
}
module.exports={RELEASE,TARGETS,ACTIONS,sha256,exactApproval,inspectOwners,registrationProposal};
