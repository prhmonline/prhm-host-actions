'use strict';
/**
 * SOURCE-ONLY registration proposal for the existing typed Host Actions v2.
 * It is NOT an untrusted CLI/root installer; it never writes production files.
 * A separately authenticated root-owned installer must inspect the four current
 * owner sources, attest preimages, approve and atomically install candidates.
 */
const crypto = require('node:crypto');
const ACTION = 'pbcinema_banners_release_install_v1';
const OPERATION = 'host_action.' + ACTION;
const POLICY_VERSION = '2026-10-19.1-pbcinema-banners-release-install-v1';
const CURRENT_POLICY_VERSION = '2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1';
const ROLLBACK = 'host-action-v2:pbcinema-banners-release-install-v1:fixed-wrapper-and-sudoers-rollback';
const PYTHON_HELPER_SHA256 = '9b858d78dad0fed8e0c431e476cfb6445b5393c53232bcc5f485d36d4341e56f';
const PYTHON_HELPER_PATH = '/root/prhm-reviewed/pbcinema-banners-release-helper.py';
const INSTALLER_PATH = '/root/prhm-reviewed/pbcinema-banners-root-installer.sh';
const INSTALLER_SHA256 = 'a27e1fca92164c6166fb095310ce6613a36e3bceb4cec540226e5dbd74dcfd91';
const DEST = '/usr/local/libexec/deploy-control/pbcinema-banners-release';
const POLICY_OWNER = '/opt/prhm-company-control-plane/config/approval-policy.json';
const BASE_OWNER = '/opt/prhm-agent-selfmaint/server.js';
const EXEC_OWNER = '/opt/prhm-agent-selfmaint-exec/server.js';
const MCP_OWNER = '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js';
const FRONT_SHA = '7e926a28b3b16b475a492a6f180e74cc7ff6543f';
const BACK_SHA = 'c5e8b58426892185c4ee95e662b6d2b641788510';
const EXPECTED_PREIMAGES = Object.freeze({
  // Historical hashes only; these MUST be freshly attested by trusted root.
  // No caller-supplied new hash may implicitly replace these pins.
  base:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
  exec:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
  policy:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',
  mcp:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166',
});
function fail(code){ throw new Error('pbcinema_registration_'+code); }
function sha(x){return crypto.createHash('sha256').update(x).digest('hex');}
function replaceOnce(source,needle,replacement,label){
  if(typeof source!=='string'||source.split(needle).length!==2)fail(label+'_anchor_not_unique');
  return source.replace(needle,replacement);
}
function readPolicyCandidate(raw){
  const policy=JSON.parse(raw);
  if(policy.schema_version!=='prhm.approval-policy.v1' || policy.version!==CURRENT_POLICY_VERSION)fail('policy_version_not_attested');
  if(!policy.operations || !Array.isArray(policy.typed_scopes))fail('policy_schema_incomplete');
  if(policy.operations[OPERATION] || policy.typed_scopes.some(x=>x && x.action===ACTION))fail('duplicate_action');
  policy.version=POLICY_VERSION;
  policy.operations[OPERATION]={
    level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,
    requested_approver:'mohammad',expires_seconds:180,
    policy_version:POLICY_VERSION,rollback_reference:ROLLBACK
  };
  policy.typed_scopes.push({
    tool:'host_action_v2_apply',project:'control_plane',environment:'production',
    action:ACTION,risk:'critical',operation:OPERATION,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
  });
  return JSON.stringify(policy,null,2)+'\n';
}
function readBaseCandidate(source){
  if(source.includes(ACTION))fail('base_action_already_present');
  const anchor = "  agent_zdt_source_sha_refresh_publisher_v1: { operation: 'host_action.agent_zdt_source_sha_refresh_publisher_v1', rollback: 'host-action-v2:agent-zdt-source-sha-refresh-publisher-v1:action-backup-restore' }";
  return replaceOnce(source,anchor,anchor+",\n  "+ACTION+": { operation: '"+OPERATION+"', rollback: '"+ROLLBACK+"' }",'base_registry');
}
function readMcpCandidate(source){
  if(source.includes("'"+ACTION+"'"))fail('mcp_action_already_present');
  const anchor="'control_plane_root_scripts_stage_transport_v1'";
  return replaceOnce(source,anchor,anchor+",'"+ACTION+"'",'mcp_action_enum');
}
function executorDispatchSnippet(){
  return "\nfunction applyPbcinemaBannersReleaseInstallV1(){\n  const fs = require('node:fs');\n  const cp = require('node:child_process');\n  const crypto = require('node:crypto');\n  const dir='/root/prhm-reviewed';\n  const installer=dir+'/pbcinema-banners-root-installer.sh';\n  const helper=dir+'/pbcinema-banners-release-helper.py';\n  const dest='/usr/local/libexec/deploy-control/pbcinema-banners-release';\n  const expectedInstaller='a27e1fca92164c6166fb095310ce6613a36e3bceb4cec540226e5dbd74dcfd91';\n  const expectedHelper='9b858d78dad0fed8e0c431e476cfb6445b5393c53232bcc5f485d36d4341e56f';\n  function hash(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}\n  function strictFile(p,expected){\n    const st=fs.lstatSync(p);\n    if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o022)!==0||hash(p)!==expected)\n      throw new Error('pbcinema_root_stage_invalid_'+p.split('/').pop());\n  }\n  if(process.getuid()!==0)throw new Error('pbcinema_root_executor_required');\n  const parent=fs.lstatSync(dir);\n  if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||(parent.mode&0o077)!==0)\n    throw new Error('pbcinema_root_stage_dir_untrusted');\n  strictFile(installer,expectedInstaller);\n  strictFile(helper,expectedHelper);\n  const output=cp.execFileSync('/usr/bin/bash',[installer,'--install-approved'],{\n    encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe'],\n    env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/root'},\n  });\n  const st=fs.lstatSync(dest);\n  if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||hash(dest)!==expectedHelper)\n    throw new Error('pbcinema_postinstall_wrapper_invalid');\n  if(!output.includes('PBCINEMA_ROOT_INSTALL=PASS'))\n    throw new Error('pbcinema_install_receipt_not_valid');\n  return {ok:true,schema_version:'prhm.host-action-result.v1',\n    action:'pbcinema_banners_release_install_v1',installed:true,\n    root_wrapper_sha256:expectedHelper,database_mutation:false,\n    production_application_mutation:false,rollback_performed:false};\n}\n";
}
function readExecCandidate(source){
  if(source.includes(ACTION))fail('exec_action_already_present');
  const anchor = "  agent_zdt_source_sha_refresh_publisher_v1:{operation:'host_action.agent_zdt_source_sha_refresh_publisher_v1',kind:'agent_zdt_source_sha_refresh_publisher_v1'}";
  let out=replaceOnce(source,anchor,anchor+",\n  "+ACTION+":{operation:'"+OPERATION+"',kind:'"+ACTION+"'}",'exec_spec');
  const apply = "applyHostActionV2=async function(action){";
  out=replaceOnce(out,apply,executorDispatchSnippet()+apply+"if(action==='"+ACTION+"')return applyPbcinemaBannersReleaseInstallV1();",'exec_dispatch');
  return out;
}
function attestSourcePreimages(sources){
  const keys=['base','exec','policy','mcp'];
  if(!sources||Object.keys(sources).sort().join(',')!==keys.sort().join(','))fail('owner_set_inexact');
  for(const k of keys){
    if(typeof sources[k]!=='string'||sha(Buffer.from(sources[k]))!==EXPECTED_PREIMAGES[k])fail('source_preimage_sha_mismatch_'+k);
  }
  return true;
}
function candidateBundle(sources){
  attestSourcePreimages(sources);
  const files={base:readBaseCandidate(sources.base),exec:readExecCandidate(sources.exec),
    policy:readPolicyCandidate(sources.policy),mcp:readMcpCandidate(sources.mcp)};
  return Object.freeze({
    action:ACTION,operation:OPERATION,
    requires_fresh_level4_approval:true,requires_second_confirmation:true,
    live_install_allowed:false,
    expected_python_helper_sha256:PYTHON_HELPER_SHA256,
    expected_reviewed_installer_sha256:INSTALLER_SHA256,
    owner_preimages:EXPECTED_PREIMAGES,
    candidates:Object.freeze(files),
    candidate_sha256:Object.freeze(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,sha(Buffer.from(v))]))),
  });
}
module.exports=Object.freeze({
 ACTION,OPERATION,POLICY_VERSION,CURRENT_POLICY_VERSION,ROLLBACK,INSTALLER_SHA256,
 FRONT_SHA,BACK_SHA,PYTHON_HELPER_SHA256,PYTHON_HELPER_PATH,INSTALLER_PATH,DEST,
 POLICY_OWNER,BASE_OWNER,EXEC_OWNER,MCP_OWNER,EXPECTED_PREIMAGES,
 sha,replaceOnce,readPolicyCandidate,readBaseCandidate,readMcpCandidate,
 readExecCandidate,attestSourcePreimages,candidateBundle,executorDispatchSnippet
});
