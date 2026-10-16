'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const collector=require('./deploy-control-l4-fixed-root-evidence-v1.cjs');
const sha0='0'.repeat(64);
function observed(path){
 const pin=collector.ROOT_TARGETS.find(x=>x.path===path);
 if(!pin)throw Error('unallowlisted');
 return {sha256:pin.expected_sha256,uid:pin.uid,gid:pin.gid,
   mode:pin.mode===null?0o600:pin.mode};
}
test('exact root targets include four owners, two old sudoers, one staging, helper, archive',()=>{
 assert.equal(collector.ROOT_TARGETS.length,9);
 assert.equal(collector.ROOT_TARGETS.filter(x=>x.category==='root_owner').length,4);
 assert.equal(collector.ROOT_TARGETS.filter(x=>x.category==='legacy_sudoers').length,2);
 assert.equal(collector.ROOT_TARGETS.filter(x=>x.category==='staging_exception').length,1);
 assert.equal(collector.ROOT_TARGETS.filter(x=>x.category==='rollback_archive').length,1);
 assert.equal(collector.ROOT_TARGETS.filter(x=>x.category==='reviewed_repair_helper').length,1);
 assert.equal(new Set(collector.ROOT_TARGETS.map(x=>x.path)).size,9);
});
test('matching hashes alone NEVER authorize install or claim issuer, sudo, triggers or approval',()=>{
 const report=collector.gatherEvidence(observed);
 assert.equal(report.file_preimage_attested,true);
 assert.deepEqual(report.blockers,['installer_refresh_state_helper_repair_pending']);
 assert.equal(report.helper_repair_pending,true);
 assert.equal(report.helper_state,'reviewed_preimage_repair_pending');
 assert.equal(report.helper_preimage_sha256,collector.HELPER.preimage_sha256);
 assert.equal(report.helper_postimage_sha256,collector.HELPER.postimage_sha256);
 assert.equal(report.root_owner_preimage_attested,true);
 for(const key of ['installation_authorized','may_install','signed_level4_verified',
 'issuer_health_attested','external_deploy_triggers_attested',
 'effective_sudo_grants_attested','host_action_registered_attested',
 'backup_restore_tested_on_host','production_mutation'])
   assert.equal(report[key],false,key);
 assert.equal(report.read_only,true);
});
test('reviewed helper SHA mismatch is a definite blocker, not repaired or repinned',()=>{
 const report=collector.gatherEvidence(path=>{
  const x=observed(path);
  if(path===collector.HELPER.path)x.sha256=sha0;
  return x;
 });
 assert.ok(report.blockers.includes('installer_refresh_helper_preimage_drift'));
 assert.equal(report.may_install,false);
 assert.equal(report.files.find(x=>x.path===collector.HELPER.path).observed_sha256,sha0);
});
test('missing/symlink/unsafe observations do not silently count as success',()=>{
 let reads=0;
 const report=collector.gatherEvidence(path=>{reads++;throw Error('ENOENT_OR_SYMLINK');});
 assert.equal(reads,9);
 assert.equal(report.files.filter(x=>!x.match).length,9);
 assert.equal(report.blockers.length,9);
 assert.equal(report.file_preimage_attested,false);
 assert.equal(report.may_install,false);
 assert.equal(report.files[0].error,'ENOENT_OR_SYMLINK');
});
test('root-owner preimage drift and privilege metadata mismatch are rejected',()=>{
 const root=collector.ROOT_TARGETS.find(x=>x.category==='root_owner').path;
 const report=collector.gatherEvidence(path=>{
  const x=observed(path);
  if(path===root)x.uid=1000;
  return x;
 });
 assert.ok(report.blockers.some(x=>x==='root_owner_preimage_unverified_or_drift:'+root));
 assert.equal(report.files.find(x=>x.path===root).sha_match,true);
 assert.equal(report.files.find(x=>x.path===root).ownership_match,false);
});
test('writable helper rejected even with matching SHA and root uid',()=>{
 const report=collector.gatherEvidence(path=>{
  const x=observed(path);
  if(path===collector.HELPER.path)x.mode=0o666;
  return x;
 });
 assert.ok(report.blockers.includes('installer_refresh_helper_preimage_drift'));
 assert.equal(report.file_preimage_attested,false);
});
test('invalid untrusted observation shape is an error without failing open',()=>{
 const report=collector.gatherEvidence(()=>({sha256:'untrusted',uid:0,gid:0,mode:0o600}));
 assert.equal(report.blockers.length,9);
 assert.equal(report.installation_authorized,false);
});
test('reader refuses unlisted paths; no writer, shell, approval or action exported',()=>{
 assert.throws(()=>collector.readPinned('/etc/shadow'),/unreviewed_target_denied/);
 assert.equal(typeof collector.install,'undefined');
 assert.equal(typeof collector.apply,'undefined');
 assert.equal(typeof collector.shell,'undefined');
 assert.equal(typeof collector.approve,'undefined');
});
test('CLI refuses user-provided arbitrary arguments without reading root files',()=>{
 const p=cp.spawnSync(process.execPath,['deploy-control-l4-fixed-root-evidence-v1.cjs',
   '--install'],{encoding:'utf8',cwd:__dirname,timeout:3000});
 assert.equal(p.status,3);
 assert.match(p.stderr,/root_read_only_flag_required/);
 assert.doesNotMatch(p.stdout,/BEGIN PRIVATE KEY/);
});
test('observed target-postimage hash is NOT mistaken for a clean original baseline',()=>{
 const report=collector.gatherEvidence(path=>{
  const x=observed(path);
  if(path===collector.HELPER.path)x.sha256=collector.HELPER.postimage_sha256;
  return x;
 });
 assert.equal(report.helper_state,'reviewed_postimage_signature_unattested');
 assert.equal(report.helper_repair_pending,false);
 assert.equal(report.file_preimage_attested,false);
 assert.equal(report.reviewed_file_state_attested,true);
 assert.equal(report.helper_reviewed_postimage_attested,true);
 assert.ok(report.blockers.includes('installer_refresh_helper_postimage_signed_l4_not_attested'));
 assert.ok(!report.blockers.includes('installer_refresh_helper_preimage_drift'));
 assert.equal(report.files.find(x=>x.path===collector.HELPER.path).match,true);
 assert.equal(report.signed_level4_verified,false);
 assert.equal(report.may_install,false);
});
test('reviewed preimage and postimage are different fixed 64-digit fingerprints',()=>{
 assert.equal(collector.HELPER.preimage_sha256,
  'b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e');
 assert.equal(collector.HELPER.postimage_sha256,
  'b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb');
 assert.notEqual(collector.HELPER.preimage_sha256,collector.HELPER.postimage_sha256);
});

test('postimage mode or uid drift remains a blocker even when SHA is reviewed',()=>{
 for(const kind of ['uid','mode']){
   const report=collector.gatherEvidence(path=>{
     const x=observed(path);
     if(path===collector.HELPER.path){
       x.sha256=collector.HELPER.postimage_sha256;
       x[kind]=kind==='uid'?1000:0o666;
     }
     return x;
   });
   assert.equal(report.helper_reviewed_postimage_attested,false);
   assert.equal(report.reviewed_file_state_attested,false);
   assert.equal(report.helper_state,'missing_or_unreviewed_drift');
   assert.ok(report.blockers.includes('installer_refresh_helper_preimage_drift'));
   assert.equal(report.signed_level4_verified,false);
   assert.equal(report.may_install,false);
 }
});
