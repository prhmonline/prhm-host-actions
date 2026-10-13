'use strict';
const test=require('node:test'), assert=require('node:assert/strict'),crypto=require('node:crypto');
const g=require('./prhm-action-registry-gateway-v1.cjs');
const SHA=a=>g.sha(Buffer.from(a));
const A={base:Buffer.from('base preimage'),executor:Buffer.from('executor preimage'),
 policy:Buffer.from('policy preimage'),mcp:Buffer.from('mcp preimage')};
const B={base:Buffer.from('base next'),executor:Buffer.from('executor next'),
 policy:Buffer.from('policy next'),mcp:Buffer.from('mcp next')};
const F={
 '/opt/prhm-agent-selfmaint-exec/actions/sample-action.cjs':Buffer.from("'use strict';\nmodule.exports = ()=>42;\n")
};
function manifest(project='honartik',action='honartik_config_center_readonly_enroll_v1'){
 return {
  schema_version:'prhm.action-registry.release.v1',project,action,
  source_commit:'a'.repeat(40),risk:'critical',approval_level:4,
  rollback_required:true,
  registry_owners:Object.fromEntries(Object.keys(g.OWNER_PATHS).map(k=>[
   k,{path:g.OWNER_PATHS[k],before_sha256:g.sha(A[k]),after_sha256:g.sha(B[k])}
  ])),
  assets:Object.entries(F).map(([path,bytes])=>({path,sha256:g.sha(bytes)})),
  health:{services:['prhm-agent-selfmaint.service',
   'prhm-agent-selfmaint-exec.service',
   'prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service'],tool:action}
 };
}
function release(project,action) {
 const m=manifest(project,action),bytes=Buffer.from(JSON.stringify(m));
 return g.attestRelease({manifestBytes:bytes,expectedManifestSha:g.sha(bytes),
  sourceCommit:m.source_commit,
  readOwner:p=>A[Object.keys(g.OWNER_PATHS).find(x=>g.OWNER_PATHS[x]===p)],
  readAsset:p=>F[p]});
}
test('shared gateway supports independent Honartik and MoeinShow immutable manifests',()=>{
 const a=release('honartik','honartik_config_center_readonly_enroll_v1');
 const b=release('moeinshow','moeinshow_config_center_readonly_enroll_v1');
 assert.equal(a.normalized.project,'honartik');assert.equal(b.normalized.project,'moeinshow');
 assert.equal(a.normalized.action!==b.normalized.action,true);
});
test('wrong source commit fails closed',()=>{
 const m=manifest(),buf=Buffer.from(JSON.stringify(m));
 assert.throws(()=>g.attestRelease({manifestBytes:buf,expectedManifestSha:g.sha(buf),
  sourceCommit:'b'.repeat(40),readOwner:()=>null,readAsset:()=>null}),/source_commit_mismatch/);
});
test('unverified/mismatched git bytes fail closed',()=>{
 const m=manifest(),buf=Buffer.from(JSON.stringify(m));
 assert.throws(()=>g.attestRelease({manifestBytes:buf,expectedManifestSha:'f'.repeat(64),
  sourceCommit:m.source_commit,readOwner:()=>null,readAsset:()=>null}),/manifest_sha_mismatch/);
});
test('owner drift blocks registration before mutation',()=>{
 const m=manifest(),buf=Buffer.from(JSON.stringify(m));
 assert.throws(()=>g.attestRelease({manifestBytes:buf,expectedManifestSha:g.sha(buf),
  sourceCommit:m.source_commit,readOwner:()=>Buffer.from('drift'),readAsset:()=>null}),/owner_sha_drift/);
});
test('asset digest drift blocks registration',()=>{
 const m=manifest(),buf=Buffer.from(JSON.stringify(m));
 assert.throws(()=>g.attestRelease({manifestBytes:buf,expectedManifestSha:g.sha(buf),
  sourceCommit:m.source_commit,
  readOwner:p=>A[Object.keys(g.OWNER_PATHS).find(x=>g.OWNER_PATHS[x]===p)],
  readAsset:()=>Buffer.from('bad')}),/asset_sha_drift/);
});
test('project slug can not escape source or path',()=>{
 const m=manifest();m.project='../root';
 assert.throws(()=>g.assertManifest(m),/manifest_security_contract/);
});
test('unrecognized owner path fails closed',()=>{
 const m=manifest();m.registry_owners.policy.path='/etc/ssh/sshd_config';
 assert.throws(()=>g.assertManifest(m),/owner_pin_or_path/);
});
test('arbitrary asset path and nested parent traversal rejected',()=>{
 const m=manifest();m.assets[0].path='/opt/prhm-agent-selfmaint-exec/actions/../../root/pwn';
 assert.throws(()=>g.assertManifest(m),/asset_untrusted_path_or_duplicate/);
});
test('duplicate asset destination rejected',()=>{
 const m=manifest();m.assets.push({...m.assets[0]});
 assert.throws(()=>g.assertManifest(m),/asset_untrusted_path_or_duplicate/);
});
test('widened risk/scope or disabled rollback rejected',()=>{
 for (const [k,v] of [['approval_level',3],['risk','high'],['rollback_required',false]]) {
  const m=manifest();m[k]=v;assert.throws(()=>g.assertManifest(m),/manifest_security_contract/);
 }
});
test('missing either MCP replica health condition fails closed',()=>{
 const m=manifest();m.health.services.pop();assert.throws(()=>g.assertManifest(m),/health_or_registry_discovery_missing/);
});
test('future approval argument hash binds project, release SHA and action',()=>{
 const a={action:g.ACTION,project:'honartik',source_commit:'a'.repeat(40),manifest_sha256:'1'.repeat(64)};
 const b={...a,project:'moeinshow'};
 assert.notEqual(g.approvalBindingSha(a),g.approvalBindingSha(b));
 assert.notEqual(g.approvalBindingSha(a),g.approvalBindingSha({...a,manifest_sha256:'2'.repeat(64)}));
});
test('approval cannot be claimed by boolean or stale record',()=>{
 const a={action:g.ACTION,project:'honartik',source_commit:'a'.repeat(40),manifest_sha256:'1'.repeat(64)};
 assert.throws(()=>g.validateTrustedApproval({approved:true},a),/approval_schema/);
 const proof={action:g.ACTION,operation:g.OPERATION,level:4,risk:'critical',
  request_id:'11111111-1111-4111-8111-111111111111',principal:'mohammad',
  role:'mcp-operator',verified_signature:true,consumed_once:true,
  expires_at:Math.floor(Date.now()/1000)-1,arguments_sha256:g.approvalBindingSha(a),
  manifest_sha256:a.manifest_sha256,source_commit:a.source_commit};
 assert.throws(()=>g.validateTrustedApproval(proof,a),/approval_missing_invalid_expired_or_replayed/);
});
test('non-ready registrar clearly identifies missing trusted bootstrap',()=>{
 const r=g.readiness({release:release('honartik','honartik_config_center_readonly_enroll_v1'),
  registrarInstalled:false,approvalRouteInstalled:false,rollbackReady:false,
  servicesHealthy:true,registeredToolVisible:false});
 assert.equal(r.ready,false);
 assert.deepEqual(r.gaps,['TRUSTED_REGISTRAR_NOT_INSTALLED','APPROVAL_ROUTE_NOT_REGISTERED',
  'ROLLBACK_NOT_VERIFIED','SIGNED_L4_RECEIPT_NOT_CONSUMED','TARGET_TOOL_NOT_REGISTERED']);
});
test('request cannot invoke an installer without signed and consumed approval',async()=>{
 const r=release('honartik','honartik_config_center_readonly_enroll_v1');
 const args={action:g.ACTION,project:r.normalized.project,source_commit:r.source_commit,
  manifest_sha256:r.manifest_sha256};
 let called=0;
 await assert.rejects(g.executeAfterTrustedAuthorization({release:r,args,approval:{approved:true},
  trustedInstaller:async()=>{called++;return{ok:true}},
  readInstalledTool:async()=>true,audit:async()=>{}}),/approval_schema/);
 assert.equal(called,0);
});
test('shared gateway has no CLI install or caller-controlled command',()=>{
 assert.equal(typeof g.executeAfterTrustedAuthorization,'function');
 assert.equal(typeof g.spawn,'undefined');assert.equal(typeof g.exec,'undefined');
 assert.equal(g.ACTION,'prhm_action_registry_install_v1');
});
