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
test('canonical signed dispatcher exists at pinned source and superseded adapter is absent',()=>{
 const body=git(['show',release.source_commit_sha+':'+expectedHandler]).toString('utf8');
 assert.match(body,/function boundRootCapabilities/);
 assert.match(body,/bridge\.applyAfterConsumption/);
 assert.match(body,/signed_approval_required/);
 assert.match(body,/untrusted_audit_record/);
 assert.match(body,/untrusted_owner_path/);
 assert.throws(()=>git(['cat-file','-e',release.source_commit_sha+':'+goneHandler]));
});
