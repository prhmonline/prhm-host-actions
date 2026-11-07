'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const release=require('../ops/agent3-universal-backup/release-lock.json');
test('fixed release source is immutable, SHA-pinned and explicitly not installed',()=>{
 assert.equal(release.schema,'prhm.agent3.universal-backup.release-lock.v1');
 assert.equal(release.status,'candidate_not_installed');
 assert.match(release.source_commit_sha,/^[0-9a-f]{40}$/);
 assert.equal(release.approval_level,4);
 assert.equal(release.fixed_action,'agent3_universal_backup_engine_install_v1');
 assert.equal(release.target_host,'prhm-production');
 for(const [name,expected] of Object.entries(release.expected_sha256)){
  assert.match(expected,/^[a-f0-9]{64}$/);
  const bytes=fs.readFileSync(path.join(__dirname,'..',name));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),expected,name);
 }
 assert.equal(Object.keys(release.expected_sha256).length,5);
});
