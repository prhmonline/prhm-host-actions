'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const m=require('./bootstrap-host-actions-v28-honartik-staging-privilege-boundary.js');

test('identity and live SHA pins are fixed',()=>{
  assert.equal(m.ACTION,'honartik_staging_privilege_boundary_install_v1');
  assert.equal(m.OPERATION,'host_action.honartik_staging_privilege_boundary_install_v1');
  assert.equal(m.BASE_SHA,'6ae89522f439babd3b6a9679336aea0fb12bb74993d33234095f872d38ad8cc6');
  assert.equal(m.EXEC_SHA,'409b63bd48b3363eaec2b3921f77ece2767dff93f6143923bdb754fe8f4cf69c');
  assert.equal(m.POLICY_SHA,'9672e88b8c5033b7107e921d25bd4911216e86a8fe593ee67ac2330e0a75bab2');
  assert.equal(m.MCP_SHA,'703a8f8ee0726fac47d008a69c759e3f52254c980cf551ea3f2660cc46321283');
});

test('policy is Level-4 critical and one-time',()=>{
  const p=JSON.parse(m.buildPolicyCandidate(JSON.stringify({schema_version:'prhm.approval-policy.v1',version:'x',operations:{},typed_scopes:[]})));
  assert.equal(p.operations[m.OPERATION].level,4);
  assert.equal(p.operations[m.OPERATION].risk,'critical');
  assert.equal(p.operations[m.OPERATION].requires_second_confirmation,true);
  assert.equal(p.operations[m.OPERATION].one_time_use,true);
  assert.equal(p.typed_scopes.filter(x=>x.action===m.ACTION).length,1);
});

test('base action is not added to Level-3 set',()=>{
  const src="const HOST_ACTION_V2_SPECS = Object.freeze({\\n  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' },\\n});\\nconst HOST_ACTION_V2_LEVEL3 = new Set([\\\"control_plane_root_scripts_stage_transport_v1\\\"]);";
  const out=m.buildBaseCandidate(src);
  assert.match(out,/honartik_staging_privilege_boundary_install_v1/);
  const level3=out.split('\n').find(line=>line.includes('HOST_ACTION_V2_LEVEL3'))||'';
  assert.equal(level3.includes(m.ACTION),false);
});

test('MCP and executor expose only fixed no-input action',()=>{
  assert.match(m.buildMcpCandidate("const HostActionV2=z.enum(['control_plane_root_scripts_stage_transport_v1']);"),/honartik_staging_privilege_boundary_install_v1/);
  const src="const HOST_ACTION_V2_SPECS = Object.freeze({\\n  imotion_credential_bind_v1:{operation:'host_action.imotion_credential_bind_v1',kind:'imotion_credential_bind_v1'},\\n});\\nconst applyHostActionV2Original=applyHostActionV2;\\napplyHostActionV2=async function(action){if(action==='imotion_credential_bind_v1')return applyImotionCredentialBindV1();return applyHostActionV2Original(action);};";
  const out=m.buildExecCandidate(src);
  assert.match(out,/applyHonartikStagingPrivilegeBoundaryInstallV1/);
  assert.match(out,/ProtectSystem=strict/);
  assert.match(out,/ProtectHome=read-only/);
  assert.match(out,/RestrictAddressFamilies=AF_UNIX/);
  assert.equal(out.includes('--property=ReadWritePaths=/usr/local/libexec/deploy-control /etc/sudoers.d /var/backups/deploy-control /var/lib/prhm-agent-selfmaint-exec /run'),true);
  assert.doesNotMatch(out,/bash -lc|sh -c/);
});

test('embedded helper installs dry-run boundary only',()=>{
  const h=m.helperSource();
  assert.equal(m.DRIVER_SHA,'a711ab3d19e8e056cc0ae0bce1f27a3aa2a7f131a9620ef40c62b3ef9a8903b0');
  assert.equal(m.DRY_RUN_SHA,'f43ee26945eff993000d260823d33d7cf33ac64367b224d05484501db6782ba8');
  assert.equal(m.SUDOERS_SHA,'c343029f9e1faf1eafb70c6a36a0a19620fa8ef7a9c6995f03a5fde2bbf69bb3');
  assert.match(h,/dry_run_only:true/);
  assert.match(h,/direct_apply_sudo_allowed:false/);
  assert.match(h,/visudo_candidate_invalid/);
  assert.match(h,/install_failed_rolled_back/);
  assert.equal(h.includes('deploy-runner ALL=(root) NOPASSWD: /usr/local/libexec/deploy-control/honartik-staging-canonical-rebuild *'),false);
});

test('selftest passes',()=>{const r=m.selftest();assert.equal(r.ok,true);assert.equal(r.action,m.ACTION);assert.match(r.helper_sha256,/^[a-f0-9]{64}$/)});

test('bootstrap has preflight and rollback but no app mutation',()=>{
  const s=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v28-honartik-staging-privilege-boundary.js'),'utf8');
  assert.match(s,/--preflight-only/);
  assert.match(s,/install_failed_rolled_back/);
  assert.match(s,/install_failed_rollback_failed/);
  assert.match(s,/production_application_mutation:false/);
  assert.match(s,/staging_application_mutation:false/);
  assert.match(s,/database_mutation:false/);
});
