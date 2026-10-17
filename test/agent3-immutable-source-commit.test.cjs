'use strict';
/**
 * CI-only independent immutable Git object provenance for Agent 3 release.
 * Never reads a network endpoint, installs, signs or modifies Production.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const release=require('../ops/agent3-universal-backup/release-lock.json');
const registration=require('../ops/agent3-universal-backup/registration-contract.cjs');
const expectedHandler='ops/agent3-universal-backup/trusted-shared-registrar-dispatch.cjs';
const goneHandler='ops/agent3-universal-backup/trusted-registration-adapter.cjs';
const sha=buf=>crypto.createHash('sha256').update(buf).digest('hex');
function git(args){
 return cp.execFileSync('git',args,{cwd:require('node:path').join(__dirname,'..'),
  timeout:20000,maxBuffer:24*1024*1024});
}
test('release source is a real immutable ancestor commit, not a mutable branch name',()=>{
 assert.match(release.source_commit_sha,/^[0-9a-f]{40}$/);
 assert.equal(release.source_commit_sha,registration.SOURCE_COMMIT);
 assert.equal(release.canonical_registry_handler_path,expectedHandler);
 assert.equal(git(['rev-parse','--verify',release.source_commit_sha+'^{commit}']).toString().trim(),
  release.source_commit_sha);
});
test('five fixed backup installer assets hash exactly to same pinned immutable Git commit',()=>{
 for(const [filename,expected] of Object.entries(release.expected_sha256)){
  const actual=git(['show',release.source_commit_sha+':'+filename]);
  assert.equal(sha(actual),expected,filename);
 }
});
test('immutable release includes reviewed exclusive claim protocol and root fsync journal',()=>{
 const handler=git(['show',release.source_commit_sha+':'+expectedHandler]).toString('utf8');
 const claimPath='ops/agent3-universal-backup/durable-execution-claim.cjs';
 assert.equal(release.durable_claim_source_path,claimPath);
 const journal=git(['show',release.source_commit_sha+':'+claimPath]).toString('utf8');
 assert.match(handler,/root_exclusive_claim_required/);
 assert.equal(release.eager_root_installer_preclaim_required,true);
 const installerCheck=handler.indexOf("const installer=root.getInstaller(a);");
 const consumeClaim=handler.indexOf("const claim=await root.claimExecutionOnce(claimInput);");
 assert.ok(installerCheck>=0 && consumeClaim>installerCheck,
  'Pinned trusted root installer must be verified before consuming durable claim');
 assert.match(handler,/if\(typeof installer!=='function'\)stop\('root_installer_not_callable'\)/);
 assert.match(handler,/durable_exclusive_execution_claim_denied/);
 assert.match(handler,/claimExecutionOnce/);
 assert.match(handler,/function rootWithFixedJournal/);
 assert.match(handler,/durableClaim\.claimExecutionOnce/);
 assert.match(handler,/untrusted_execution_claim_override/);
 assert.equal(release.fixed_journal_binding,
   'trusted-shared-registrar-dispatch.cjs:rootWithFixedJournal -> durable-execution-claim.cjs:claimExecutionOnce');
 assert.match(journal,/O_EXCL/);
 assert.match(journal,/fs\.fsyncSync\(fd\)/);
 assert.match(journal,/fs\.fsyncSync\(directoryFd\)/);
 assert.match(journal,/root_required/);
 assert.match(journal,/EEXIST/);
});
test('immutable source binds native pending request ID through signed Ed25519 and consumed ledger',()=>{
 const paths={
  gateway:'prhm-action-registry-gateway-v1.cjs',
  bridge:'prhm-action-registry-host-actions-v2-bridge-v1.cjs',
  dispatcher:'ops/agent3-universal-backup/trusted-shared-registrar-dispatch.cjs',
  native:'ops/agent3-universal-backup/five-field-native-route-contract.cjs'
 };
 const source=Object.fromEntries(Object.entries(paths).map(([k,p])=>
  [k,git(['show',release.source_commit_sha+':'+p]).toString('utf8')]));
 assert.match(source.gateway,/c\.request_id===expectedRequestId/);
 assert.match(source.gateway,/ledger\.request_id===c\.request_id/);
 assert.match(source.gateway,/expectedRequestId,nowSec:Math\.floor\(Date\.now\(\)\/1000\)/);
 assert.match(source.bridge,/signedApprovalToken:approvalToken,expectedRequestId/);
 assert.match(source.dispatcher,/trusted_native_request_id_required/);
 assert.match(source.dispatcher,/capabilities:narrowed,expectedRequestId/);
 assert.match(source.native,/expectedRequestId:precheck\.request_id/);
 assert.match(source.native,/native_request_expired_or_excessive_ttl/);
});
test('canonical signed dispatcher exists at pinned source and superseded adapter is absent',()=>{
 const body=git(['show',release.source_commit_sha+':'+expectedHandler]).toString('utf8');
 assert.match(body,/function boundRootCapabilities/);
 assert.match(body,/bridge\.applyAfterConsumption/);
 assert.match(body,/signed_approval_required/);
 assert.match(body,/untrusted_audit_record/);
 assert.match(body,/untrusted_owner_path/);
 assert.throws(()=>git(['cat-file','-e',release.source_commit_sha+':'+goneHandler]));
});

test('immutable source contains native five-field registration guard and never treats it as installed',()=>{
 const native='ops/agent3-universal-backup/five-field-native-route-contract.cjs';
 const source=git(['show',release.source_commit_sha+':'+native]).toString('utf8');
 const current=require('node:fs').readFileSync(
  require('node:path').join(__dirname,'..',native),'utf8');
 assert.equal(source,current,'Pinned route code must exactly equal current reviewed route code');
 assert.match(source,/function prepareRequest\(body\)/);
 assert.match(source,/function prepareApply\(/);
 assert.match(source,/function applyFromTrustedNativeExecutor/);
 assert.match(source,/native_request_expired_or_excessive_ttl/);
 assert.match(source,/dispatcher\.dispatch/);
 assert.match(source,/signed_approval_verified:false/);
 assert.match(source,/ready_to_invoke_root_dispatch:false/);
 // The manifest is deliberately absent because no native production bootstrap exists.
 assert.throws(()=>git(['cat-file','-e',release.source_commit_sha+
   ':ops/agent3-universal-backup/registry-release-manifest.json']));
});
