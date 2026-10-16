'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const manifest=JSON.parse(fs.readFileSync('manifests/deploy-control-l4-fixed-action-source-registration-v1.json','utf8'));
const tx=require('./deploy-control-l4-privileged-transaction-v1.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
test('immutable registration identifies a real bounded source module, not a generic root command',()=>{
 assert.equal(manifest.schema_version,'prhm.deploy-control.l4-fixed-action.source-registration.v1');
 assert.equal(manifest.source_repository,'prhmonline/prhm-host-actions');
 assert.match(manifest.source_commit,/^[a-f0-9]{40}$/);
 assert.equal(manifest.source_path,'deploy-control-l4-privileged-transaction-v1.cjs');
 const bytes=fs.readFileSync(manifest.source_path);
 // The manifest must reference bytes already committed in a prior Git commit,
 // not a self-referential or unconstrained HEAD source.
 const pinned=cp.execFileSync('git',['show',manifest.source_commit+':'+manifest.source_path],{maxBuffer:1024*1024});
 assert.deepEqual(pinned,bytes);
 assert.equal(sha(bytes),manifest.source_sha256);
 const blob=crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
 assert.equal(blob,manifest.source_git_blob);
 assert.equal(typeof tx.applyFixedCutover,'function');
 assert.equal(typeof tx.exec,'undefined');assert.equal(typeof tx.shell,'undefined');
});
test('operation, authorization level, one-time scope and fixed caller are exact',()=>{
 assert.equal(manifest.action,tx.ACTION);
 assert.equal(manifest.operation,tx.OPERATION);
 assert.equal(manifest.level,4);assert.equal(manifest.risk,'critical');
 assert.equal(manifest.requires_second_confirmation,true);
 assert.equal(manifest.one_time_use,true);
 assert.equal(manifest.tool,'host_action_v2_apply');
 assert.equal(manifest.typed_scope.operation,tx.OPERATION);
 assert.equal(manifest.typed_scope.principal_id,'mohammad');
 assert.equal(manifest.typed_scope.role,'mcp-operator');
 assert.equal(manifest.typed_scope.project,'control_plane');
 assert.equal(manifest.typed_scope.environment,'production');
 assert.equal(manifest.typed_scope.risk,'critical');
});
test('source registration cannot be mistaken for live tool registration or signed release',()=>{
 assert.equal(manifest.registered_in_git,true);
 assert.equal(manifest.registered_on_host,false);
 assert.equal(manifest.approved,false);
 assert.equal(manifest.production_executable,false);
 assert.equal(manifest.stage,'reviewed-source-registration-only');
 assert.ok(manifest.requires.includes('approved_fixed_host_action_v2_owner_patches'));
 assert.ok(manifest.requires.includes('root_registry_installation_with_signed_level4_authorization'));
});
test('exact three-application dispatcher, policy and recovery archive remain pinned',()=>{
 assert.equal(manifest.central_dispatcher.commit,'1e16bbb633a2d7b62d1322fe4c93bf9df346a748');
 assert.equal(manifest.central_dispatcher.preconsumption_issuer_attestation,true);
 assert.equal(manifest.policy.commit,'acffc7f9e02073f7aaf6ba92777f7acff6481f81');
 assert.equal(manifest.policy.raw_sha256,'ed527c12ee330b8e1f5616fcb0c712eb89dddd9395197b2d855f00d3deea0678');
 assert.equal(manifest.rollback.sha256,tx.BACKUP.sha256);
 assert.equal(manifest.rollback.required,true);
 assert.equal(manifest.rollback.runtime_only,true);
 assert.equal(manifest.rollback.git_history_unchanged,true);
 assert.equal(Object.keys(manifest.root_owner_preimages).length,4);
});
test('private token stays outside source registry and privileged root capability boundary',()=>{
 const raw=fs.readFileSync('manifests/deploy-control-l4-fixed-action-source-registration-v1.json','utf8');
 assert.doesNotMatch(raw,/"executor_token"\s*:/);
 assert.doesNotMatch(raw,/BEGIN.*PRIVATE KEY/);
 assert.ok(tx.CAPABILITIES.includes('readPrivateExecutorToken'));
 assert.ok(tx.CAPABILITIES.includes('consumeSignedExactLevel4Authorization'));
 assert.ok(tx.CAPABILITIES.includes('restoreJournalAndReload'));
 assert.ok(tx.CAPABILITIES.includes('attestRootFileSha256'));
 assert.equal(tx.CAPABILITIES.includes('shell'),false);
});

test('registered L4 action must be attested in trusted preflight before any permit is consumed',()=>{
 const content=fs.readFileSync(manifest.source_path,'utf8');
 const before=content.indexOf("fail('fixed_l4_action_not_registered_before_approval')");
 const consumption=content.indexOf('await h.consumeSignedExactLevel4Authorization(SCOPE)');
 const freezing=content.indexOf('await h.freezeAllDeployEntrypoints()');
 assert.ok(before>0,'independent registry guard is mandatory');
 assert.ok(before<freezing,'registry guard must run before freezing external deployments');
 assert.ok(before<consumption,'registry guard must run before one-time permit consumption');
 assert.ok(content.includes("if(await h.getFixedToolDiscovery(ACTION)!==true)"));
});
