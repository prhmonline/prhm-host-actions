'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const install=require('../ops/agent3-universal-backup/install-candidate');
const SHA='a'.repeat(40);
test('installer contract pins exact host, SHA and critical approval',()=>{
 const c=install.contract(SHA);
 assert.equal(c.approval_level,4);
 assert.equal(c.target_host,'prhm-production');
 assert.equal(c.source_sha,SHA);
 assert.equal(c.allow_shell,false);
 assert.equal(c.allow_production_restore,false);
 assert.equal(c.active_link,'/opt/prhm-agent3-universal-backup/current');
 assert.deepEqual(c.files,[...install.FILES]);
 assert.throws(()=>install.contract('main'),/invalid_source_sha/);
});
test('installer has no standalone apply and cannot skip mediator',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../ops/agent3-universal-backup/install-candidate.js'),'utf8');
 assert.match(source,/no_standalone_apply_control_plane_required/);
 assert.doesNotMatch(source,/execSync\(|spawnSync\(|shell:\s*true/);
 await assert.rejects(install.installTransaction({sha:SHA,hashes:{}}),/trusted_mediator_required/);
});
