'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const x = require('./pbcinema-banners-host-action-registration-v1.cjs');
const baseAnchor="  agent_zdt_source_sha_refresh_publisher_v1: { operation: 'host_action.agent_zdt_source_sha_refresh_publisher_v1', rollback: 'host-action-v2:agent-zdt-source-sha-refresh-publisher-v1:action-backup-restore' }";
const execAnchor="  agent_zdt_source_sha_refresh_publisher_v1:{operation:'host_action.agent_zdt_source_sha_refresh_publisher_v1',kind:'agent_zdt_source_sha_refresh_publisher_v1'}";
const mockPolicy=()=>JSON.stringify({
 schema_version:'prhm.approval-policy.v1',version:x.CURRENT_POLICY_VERSION,
 operations:{'host_action.harden_agent_api_v1':{level:4}},typed_scopes:[]
});
test('fixed source and identity pins',()=>{
 assert.equal(x.ACTION,'pbcinema_banners_release_install_v1');
 assert.equal(x.INSTALLER_SHA256,'572b7f0057c19ade7ff49bd4234dcd4a667018273e0b90099ac93f7f95d8b43f');
 assert.equal(x.PYTHON_HELPER_SHA256,'8d348315a99fdfcc9d3934f39b18996761d777d90e1fac3a37475b08be1f0b69');
 assert.equal(x.DEST,'/usr/local/libexec/deploy-control/pbcinema-banners-release');
});
test('typed policy binds L4 with second confirmation and one-time use',()=>{
 const p=JSON.parse(x.readPolicyCandidate(mockPolicy()));
 const v=p.operations[x.OPERATION];
 assert.equal(p.version,x.POLICY_VERSION);
 assert.deepEqual({level:v.level,risk:v.risk,second:v.requires_second_confirmation,once:v.one_time_use,ttl:v.expires_seconds},{level:4,risk:'critical',second:true,once:true,ttl:180});
 const t=p.typed_scopes.at(-1);
 assert.equal(t.action,x.ACTION);assert.equal(t.tool,'host_action_v2_apply');
 assert.equal(t.environment,'production');assert.equal(t.project,'control_plane');
 assert.equal(t.operation,x.OPERATION);
 assert.deepEqual(t.principals,[{principal_id:'mohammad',roles:['mcp-operator']}]);
});
test('policy refuses unexpected version or duplicate action',()=>{
 const wrong=JSON.parse(mockPolicy());wrong.version='other';
 assert.throws(()=>x.readPolicyCandidate(JSON.stringify(wrong)),/policy_version_not_attested/);
 const twice=x.readPolicyCandidate(mockPolicy());
 assert.throws(()=>x.readPolicyCandidate(twice),/policy_version_not_attested|duplicate_action/);
 const p=JSON.parse(mockPolicy());p.operations[x.OPERATION]={};
 assert.throws(()=>x.readPolicyCandidate(JSON.stringify(p)),/duplicate_action/);
});
test('base action registry patches exactly one anchor',()=>{
 const source=baseAnchor+'\n});';
 const out=x.readBaseCandidate(source);
 assert.match(out,/pbcinema_banners_release_install_v1/);
 assert.throws(()=>x.readBaseCandidate(source+source),/base_registry_anchor_not_unique/);
 assert.throws(()=>x.readBaseCandidate(out),/base_action_already_present/);
});
test('MCP enumeration patches exactly one fixed anchor',()=>{
 const out=x.readMcpCandidate("['control_plane_root_scripts_stage_transport_v1']");
 assert.match(out,/'pbcinema_banners_release_install_v1'/);
 assert.throws(()=>x.readMcpCandidate("'control_plane_root_scripts_stage_transport_v1' 'control_plane_root_scripts_stage_transport_v1'"),/anchor_not_unique/);
});
test('executor action map and dispatch are fixed and unique',()=>{
 const src=execAnchor+"\napplyHostActionV2=async function(action){ return null; };";
 const out=x.readExecCandidate(src);
 assert.match(out, /kind:'pbcinema_banners_release_install_v1'/);
 assert.match(out,/if\(action==='pbcinema_banners_release_install_v1'\)/);
 assert.match(out,/pbcinema_root_stage_dir_untrusted/);
 assert.match(out,/572b7f0057c19ade7ff49bd4234dcd4a667018273e0b90099ac93f7f95d8b43f/);
 assert.throws(()=>x.readExecCandidate(out),/exec_action_already_present/);
});
test('executor injected worker parses and fails without root authority',()=>{
 const source=x.executorDispatchSnippet();
 const context={require,process:{getuid:()=>1000}};
 vm.runInNewContext(source,context);
 assert.equal(typeof context.applyPbcinemaBannersReleaseInstallV1,'function');
 assert.throws(()=>context.applyPbcinemaBannersReleaseInstallV1(),/pbcinema_root_executor_required/);
});
test('generated root worker rejects untrusted staging before command execution',()=>{
 const source=x.executorDispatchSnippet();
 const fakefs={lstatSync:()=>({isDirectory:()=>true,isSymbolicLink:()=>false,uid:5,mode:0o700})};
 const context={
   require:n=>n==='node:fs'?fakefs:require(n),
   process:{getuid:()=>0}
 };
 vm.runInNewContext(source,context);
 assert.throws(()=>context.applyPbcinemaBannersReleaseInstallV1(),/pbcinema_root_stage_dir_untrusted/);
});
test('expected four-owner set and SHA must match; no arbitrary owner accepted',()=>{
 assert.deepEqual(Object.keys(x.EXPECTED_PREIMAGES).sort(),['base','exec','mcp','policy']);
 assert.throws(()=>x.attestSourcePreimages({base:'x',exec:'x',mcp:'x',policy:'x'}),/source_preimage_sha_mismatch/);
 assert.throws(()=>x.candidateBundle({base:'x',exec:'x',policy:'x'}),/owner_set_inexact/);
});
test('source generation never mutates production or registers open-ended command',()=>{
 const src=x.executorDispatchSnippet();
 assert.match(src,/execFileSync\('\/usr\/bin\/bash',\[installer,'--install-approved'\]/);
 assert.doesNotMatch(src,/shell:true|eval\(|curl|wget|git clone|NOPASSWD: ALL/);
 assert.ok(x.ROLLBACK.startsWith('host-action-v2:pbcinema'));
});
