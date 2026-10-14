'use strict';
/**
 * V2 merged runtime closure attestation; ephemeral GitHub Actions only.
 * This is never a host staging, signed approval, or deployment command.
 */
const {test}=require('node:test'),assert=require('node:assert/strict');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const path=require('node:path');
const M=require('./manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json');
const P=require('./manifests/honartik-shared-registry-pinned-release-v2.json');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const bridge=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const blob=bytes=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
function git(args){
 const r=cp.spawnSync('git',args,{cwd:__dirname,timeout:15000,maxBuffer:5000000});
 assert.equal(r.status,0,'immutable git reference unavailable: '+args.join(' '));
 return r.stdout;
}
test('runtime manifest is a single coherent fixed V2 release without production authority',()=>{
 assert.equal(M.schema,'prhm.shared-registry.v2.reviewed-runtime-stage.v1');
 assert.equal(M.repo,'prhmonline/prhm-host-actions');
 assert.equal(M.status,'NOT_STAGED');
 assert.equal(M.installation_authorized,false);
 assert.equal(M.level4_consumed,false);
 assert.equal(M.production_mutation,false);
 assert.equal(M.project,'honartik');
 assert.equal(M.project_source_commit,P.source_commit);
 assert.equal(M.release_manifest_commit,P.manifest_commit);
 assert.equal(M.release_manifest_sha256,P.release_manifest_sha256);
 assert.equal(M.approval_arguments_sha256,P.approval_arguments_sha256);
 assert.notEqual(M.runtime_source_commit,M.project_source_commit);
 assert.match(M.runtime_source_commit,/^[a-f0-9]{40}$/);
 assert.equal(M.action,G.ACTION);
 assert.equal(bridge.assertHonartikReleaseIdentity({
  action:G.ACTION,project:'honartik',source_commit:M.project_source_commit,
  manifest_commit:M.release_manifest_commit,manifest_sha256:M.release_manifest_sha256
 },P.release_manifest_path),P.release_manifest_path);
});
test('all 19 effective V2 staging destinations are unique, fixed and Git blob attested',()=>{
 assert.equal(M.files.length,19);
 const dests=new Set(),files=new Set();
 for(const file of M.files){
  assert.deepEqual(Object.keys(file).sort(),
   ['destination','git_blob_sha1','source_commit','source_path']);
  assert.ok(!files.has(file.source_path));
  assert.ok(!dests.has(file.destination));
  files.add(file.source_path);dests.add(file.destination);
  assert.equal(file.destination,M.destination_root+'/'+file.source_path);
  assert.ok(!file.destination.includes('..'));
  assert.match(file.git_blob_sha1,/^[a-f0-9]{40}$/);
  assert.match(file.source_commit,/^[a-f0-9]{40}$/);
  const bytes=git(['show',file.source_commit+':'+file.source_path]);
  assert.equal(blob(bytes),file.git_blob_sha1);
  const line=git(['ls-tree',file.source_commit,'--',file.source_path]).toString();
  assert.match(line,/^100644 blob [a-f0-9]{40}\t/);
 }
 assert.equal(M.independent_entrypoint,
  M.destination_root+'/prhm-action-registry-v2-independent-runner-entry-v1.cjs');
 assert.ok(dests.has(M.independent_entrypoint));
});
test('V2 replacement bridge exact SHA overrides the unusable pinned V1 bridge',()=>{
 const name='prhm-action-registry-host-actions-v2-bridge-v1.cjs';
 const entry=M.files.find(x=>x.source_path===name);
 assert.ok(entry);
 assert.equal(entry.source_commit,M.runtime_source_commit);
 assert.equal(entry.git_blob_sha1,M.bridge_runtime_git_blob_sha1);
 assert.equal(M.replaces_unusable_previous_bridge_blob_sha1,
  P.assets.find(x=>x.git_path===name).git_blob_sha1);
 assert.notEqual(entry.git_blob_sha1,M.replaces_unusable_previous_bridge_blob_sha1);
 assert.equal(entry.git_blob_sha1,'166d9253634df48624aaa75da719253dc1e21508');
 const src=git(['show',entry.source_commit+':'+name]).toString('utf8');
 assert.ok(src.includes('assertHonartikReleaseIdentity'));
 assert.ok(src.includes('honartik-config-center-registry-release-v2.json'));
});
test('every local CommonJS dependency resolves inside the 19-file staged runtime',()=>{
 const staged=new Set(M.files.map(x=>x.source_path));
 for(const a of M.files.filter(x=>x.source_path.endsWith('.cjs'))){
  const src=git(['show',a.source_commit+':'+a.source_path]).toString('utf8');
  for(const [,rel] of src.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)){
   if(rel.startsWith('node:'))continue;
   assert.ok(rel.startsWith('./'),'untrusted dependency: '+a.source_path+' -> '+rel);
   const target=path.posix.normalize(path.posix.join(path.posix.dirname(a.source_path),rel.slice(2)));
   assert.ok(staged.has(target),'missing staged import: '+a.source_path+' -> '+target);
  }
 }
});
test('only the hardened V2 cold-recovery module is staged, never the old V1 success path',()=>{
 const recovery=M.files.filter(x=>x.source_path.includes('durable-recovery'));
 assert.equal(recovery.length,1);
 assert.equal(recovery[0].source_path,'prhm-action-registry-v2-durable-recovery-v1.cjs');
 assert.equal(recovery[0].git_blob_sha1,'51b6224c24ef6d4ec27c1da092dfe5aafbf65ec6');
 assert.equal(recovery[0].source_commit,M.recovery_source_commit);
 assert.equal(M.recovery_requires_negative_mcp_discovery,true);
 const source=git(['show',recovery[0].source_commit+':'+recovery[0].source_path]).toString('utf8');
 assert.match(source,/verifyTargetAbsent/);
 assert.match(source,/target_mcp_tool_still_visible_or_unverified/);
 assert.equal(M.files.some(x=>x.source_path==='prhm-action-registry-durable-recovery-v1.cjs'),false);
});
test('both-worker fresh MCP discovery module is required in the staged V2 closure',()=>{
 assert.equal(M.discovery_requires_both_live_mcp_workers,true);
 const x=M.files.filter(x=>x.source_path==='prhm-action-registry-v2-mcp-discovery-v1.cjs');
 assert.equal(x.length,1);
 assert.equal(x[0].source_commit,M.discovery_source_commit);
 assert.equal(x[0].git_blob_sha1,'c47456483b529226184415e4d6107ed44099051d');
 const source=git(['show',x[0].source_commit+':'+x[0].source_path]).toString('utf8');
 assert.match(source,/prhm-agent-mcp-blue.service/);
 assert.match(source,/prhm-agent-mcp-green.service/);
 assert.match(source,/blue_green_registry_inconsistent/);
});
test('runner entry is pinned to immutable Git and cannot accept custom apply callbacks',()=>{
 const item=M.files.find(x=>x.source_path==='prhm-action-registry-v2-independent-runner-entry-v1.cjs');
 assert.ok(item);
 assert.equal(M.runner_entry_rejects_injected_apply,true);
 assert.equal(item.source_commit,M.runner_entry_source_commit);
 assert.equal(item.git_blob_sha1,'8dd786829aad356c5d207365258cb4c9dd61b95d');
 const src=git(['show',item.source_commit+':'+item.source_path]).toString();
 assert.ok(src.includes('LOADED_CREDENTIALS.has(credential)'));
 assert.ok(src.includes('bridge.applyAfterConsumption({'));
 assert.ok(src.includes('trusted_invocation_schema'));
 assert.equal(src.includes('apply=bridge.applyAfterConsumption'),false);
});
test('signed five-field Ed25519 contract is present in immutable V2 runtime closure',()=>{
 const matches=M.files.filter(x=>x.source_path==='prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
 assert.equal(matches.length,1);
 assert.equal(M.five_field_approval_requires_ed25519_and_consumed_ledger,true);
 assert.equal(matches[0].source_commit,M.five_field_approval_source_commit);
 assert.equal(matches[0].git_blob_sha1,'78001c5d059d26be55fa53adcf5d2d6c84cb6181');
 const src=git(['show',matches[0].source_commit+':'+matches[0].source_path]).toString('utf8');
 assert.match(src,/verifyConsumedRegistrationApproval/);
 assert.match(src,/authorizeConsumeEnvelope/);
 assert.match(src,/CONFIRM_LEVEL_4_CRITICAL/);
 assert.match(src,/arguments_sha256/);
});
test('V2 independent entry cannot be used as an unapproved CLI apply',()=>{
 const r=cp.spawnSync(process.execPath,
 ['prhm-action-registry-v2-independent-runner-entry-v1.cjs'],
 {cwd:__dirname,timeout:10000,encoding:'utf8'});
 assert.equal(r.status,78);
 assert.match(r.stderr,/trusted_host_capabilities_not_staged/);
 assert.equal(r.stdout,'');
 for(const forbidden of ['approval_token','private_key','systemd-run --','/etc/shadow'])
  assert.equal(JSON.stringify(M).includes(forbidden),false);
 assert.equal(M.conditions.length,5);
});