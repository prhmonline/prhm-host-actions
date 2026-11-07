'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const build=require('../ops/agent3-universal-backup/build-registration-manifest.cjs');
const contract=require('../ops/agent3-universal-backup/production-registration-contract.json');
const {OWNERS,SERVICES}=require('../ops/agent3-universal-backup/four-owner-readonly-preflight.cjs');
const gateway=require('../prhm-action-registry-gateway-v1.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(){
 const keys=build.KEYS;
 const owners=Object.fromEntries(keys.map(key=>[key,{
  path:OWNERS[key],sha256:contract.preimage_sha256[key],size:200}]));
 const evidence={
  schema:'prhm.agent3.registry-owner-evidence.v1',
  mode:'READ_ONLY_PREFLIGHT',production_mutation:false,
  enrollment_authorized:false,cryptographically_signed:false,
  owner_count:4,service_count:4,owners,
  hashes:{...contract.preimage_sha256},
  services:SERVICES.map(unit=>({unit,active:true,running:true,loaded:true}))
 };
 return {evidence,
  proposedOwnerBytes:Object.fromEntries(keys.map(k=>[k,Buffer.from('proposed patched owner '+k)])),
  installerBytes:fs.readFileSync(path.join(__dirname,'../ops/agent3-universal-backup/install-candidate.js'))
 };
}
test('offline manifest enforces source lock, four exact owner outputs and level four',()=>{
 const output=build.build(fixture());
 assert.equal(output.mode,'OFFLINE_UNATTESTED_MANIFEST_CANDIDATE');
 assert.equal(output.ready_for_production,false);
 assert.equal(output.installed,false);
 assert.equal(output.approval_consumed,false);
 assert.equal(sha(output.bytes),output.sha256);
 assert.equal(output.manifest.action,'agent3_universal_backup_engine_install_v1');
 assert.equal(output.manifest.approval_level,4);
 assert.equal(output.manifest.assets[0].source_path,build.ASSET_SOURCE);
 assert.equal(output.manifest.assets[0].path,build.ASSET_DEST);
 assert.equal(output.manifest.registry_owners.base.before_sha256,contract.preimage_sha256.base);
 assert.equal(output.manifest.registry_owners.mcp.after_sha256,
   sha(fixture().proposedOwnerBytes.mcp));
 assert.equal(gateway.assertManifest(output.manifest).action,output.manifest.action);
});
test('registration manifest refuses missing, extra or invalid patched owner bytes',()=>{
 for(const mutate of [
  f=>{delete f.proposedOwnerBytes.policy},
  f=>{f.proposedOwnerBytes.untrusted=Buffer.from('wrong')},
  f=>{f.proposedOwnerBytes.mcp='not a buffer'},
  f=>{f.proposedOwnerBytes.base=Buffer.alloc(0)},
  f=>{f.proposedOwnerBytes.executor=Buffer.alloc(20*1024*1024+1)}
 ]){
  const f=fixture();mutate(f);
  assert.throws(()=>build.build(f),/agent3_manifest_candidate_denied/);
 }
});
test('registration manifest rejects forged live hash evidence and changed installer bytes',()=>{
 const f=fixture();f.evidence.hashes.base='0'.repeat(64);
 assert.throws(()=>build.build(f),/preimage_mismatch/);
 const g=fixture();g.installerBytes=Buffer.from('synthetic unexpected installer');
 assert.throws(()=>build.build(g),/installer_source_hash_mismatch/);
});
test('offline module cannot be used as an installation command',()=>{
 const cp=require('node:child_process');
 const result=cp.spawnSync(process.execPath,[
   path.join(__dirname,'../ops/agent3-universal-backup/build-registration-manifest.cjs'),
   '--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,78);
 assert.match(result.stderr,/no CLI registration or install/);
});
