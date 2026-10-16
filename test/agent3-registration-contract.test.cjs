'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const gateway=require('../prhm-action-registry-gateway-v1.cjs');
const c=require('../ops/agent3-universal-backup/registration-contract.cjs');
function args(){return {action:c.REGISTRY_ACTION,project:c.PROJECT,
 source_commit:c.SOURCE_COMMIT,manifest_commit:'b'.repeat(40),
 manifest_sha256:'c'.repeat(64)};}
test('registration proposal is exact five-field, Level-4, 180s and cryptographically bound',()=>{
 const request=c.dryRunApprovalRequest(args());
 assert.equal(request.mode,'not_submitted');
 assert.equal(request.requires_level4,true);
 assert.equal(request.target_action,'agent3_universal_backup_engine_install_v1');
 assert.equal(request.approval_request.level,undefined); // risk/TTL establish request; issuer assigns level via policy
 assert.equal(request.approval_request.risk,'critical');
 assert.equal(request.approval_request.ttl_seconds,180);
 assert.equal(request.approval_request.arguments_sha256,gateway.approvalBindingSha(args()));
 assert.equal(request.approval_request.action,c.REGISTRY_ACTION);
 assert.equal(request.approval_request.project,'control_plane');
});
test('ignore forged approval flags and refuse arbitrary enrollment',()=>{
 for(const wrong of [
  {...args(),project:'honartik'},
  {...args(),source_commit:'0'.repeat(40)},
  {...args(),action:'host_action_v2_installer_v1'},
  {...args(),executor:'shell'},
  {...args(),approved:true},
  {...args(),receipt:'CONFIRM_LEVEL_4_CRITICAL'},
  {...args(),manifest_sha256:'not-a-sha'}
 ])assert.throws(()=>c.dryRunApprovalRequest(wrong));
});
test('preinstall gate distinguishes code readiness from installed shared registrar',()=>{
 const live=c.status({gitAttested:true,allFourServicesHealthy:true});
 assert.equal(live.ready,false);
 assert.ok(live.gaps.includes('TRUSTED_REGISTRAR_NOT_INSTALLED'));
 assert.ok(live.gaps.includes('APPROVAL_ROUTE_NOT_REGISTERED'));
 assert.ok(live.gaps.includes('TARGET_INSTALL_ACTION_NOT_REGISTERED'));
 assert.ok(live.gaps.includes('BACKUP_KEY_NOT_PROVISIONED'));
 assert.equal(live.owner_count,4);
 const all=c.status({gitAttested:true,sharedRegistrarVisible:true,
  typedApprovalRouteVisible:true,fourOwnerRollbackVerified:true,
  allFourServicesHealthy:true,liveInstallerRegistered:true,pinnedServiceKeyReady:true});
 assert.equal(all.ready,true);
 assert.equal(all.phase,'preinstall'); // NOT authorized or installed yet!
});
test('only explicitly reviewed manifest schema can match Agent3 installation action',()=>{
 const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
 const owners=Object.fromEntries(Object.entries(gateway.OWNER_PATHS).map(([k,path])=>
  [k,{path,before_sha256:digest('pre:'+k),after_sha256:digest('post:'+k)}]));
 const manifest={schema_version:'prhm.action-registry.release.v1',project:c.PROJECT,
  action:c.INSTALL_ACTION,source_commit:c.SOURCE_COMMIT,risk:'critical',
  approval_level:4,registry_owners:owners,assets:[{
   path:'/opt/prhm-agent-selfmaint-exec/actions/agent3-backup-installer.cjs',
   source_path:'ops/agent3-universal-backup/install-candidate.js',
   sha256:digest('synthetic-fixture-only')}],
  rollback_required:true,health:{services:[
   'prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service',
   'prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service'
  ],tool:c.INSTALL_ACTION},git_path:c.EXPECTED_MANIFEST_PATH};
 const bytes=Buffer.from(JSON.stringify(manifest));
 const ok=c.verifyReviewedManifest({bytes,gitPath:c.EXPECTED_MANIFEST_PATH});
 assert.equal(ok.trusted_install_ready,false);
 assert.equal(ok.release.action,c.INSTALL_ACTION);
 assert.equal(ok.sha256,digest(bytes));
 assert.throws(()=>c.verifyReviewedManifest({bytes,gitPath:'../untrusted.json'}),/pinned_manifest_required/);
 assert.throws(()=>c.verifyReviewedManifest({bytes:Buffer.from(JSON.stringify({...manifest,action:'another_action_v1'})),
   gitPath:c.EXPECTED_MANIFEST_PATH}),/manifest_target_mismatch/);
});
