'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const reg=require('./honartik-open-price-yii-registration-transaction-v1.cjs');
const {ACTION,OPERATION,OWNER,FILES,ORDER,SOURCE_COMMIT,sha,gitBlob,validatePlan,
  applyTrustedRegistration}=reg;
let passed=0;
function expectFailure(fn,msg){
  assert.throws(fn,e=>String(e.message).includes(msg));
  passed++;
}
async function expectAsyncFailure(fn,msg){
  await assert.rejects(fn,e=>String(e.message).includes(msg));
  passed++;
}
function plan(){
  const files={};
  for(const key of ORDER){
    const pathName=(FILES[key]||OWNER[key]).path;
    const bytes=FILES[key]?
      fs.readFileSync(path.join(__dirname,FILES[key].source)):
      Buffer.from('reviewed, candidate owner source with typed action: '+ACTION+' '+key);
    files[key]={path:pathName,bytes,sha256:sha(bytes)};
  }
  return {files};
}
(async()=>{
  assert.match(SOURCE_COMMIT,/^[a-f0-9]{40}$/);
  assert.equal(OPERATION,'host_action.honartik_open_price_yii_registration_v1');
  assert.equal(ORDER.length,6);
  assert.deepEqual(Object.keys(OWNER).sort(),['base','executor','mcp','policy']);
  passed++;

  const valid=plan();
  const digests=validatePlan(valid);
  assert.deepEqual(Object.keys(digests).sort(),[...ORDER].sort());
  for(const [key,file] of Object.entries(FILES))
    assert.equal(gitBlob(valid.files[key].bytes),file.gitBlob);
  passed++;

  let x=plan();x.files.base.path='/tmp/untrusted';
  expectFailure(()=>validatePlan(x),'invalid_candidate_base');
  x=plan();x.files.executor.sha256='0'.repeat(64);
  expectFailure(()=>validatePlan(x),'candidate_digest_mismatch_executor');
  x=plan();x.files.mcp.bytes=Buffer.from('no action registration');
  x.files.mcp.sha256=sha(x.files.mcp.bytes);
  expectFailure(()=>validatePlan(x),'owner_missing_specific_registration_mcp');
  x=plan();delete x.files.policy;
  expectFailure(()=>validatePlan(x),'files_not_exact');
  x=plan();x.files.injected={};
  expectFailure(()=>validatePlan(x),'files_not_exact');
  x=plan();x.files.nativeAdapter.bytes=Buffer.from('untrusted source');
  x.files.nativeAdapter.sha256=sha(x.files.nativeAdapter.bytes);
  expectFailure(()=>validatePlan(x),'immutable_source_blob_mismatch_nativeAdapter');

  const called={read:0,consumed:0,writes:0};
  await expectAsyncFailure(()=>applyTrustedRegistration({}),'trusted_capability_missing_readOwner');
  const adapter={
    readOwner:async()=>{called.read++;return {bytes:Buffer.from('not the owner'),sha256:'0'.repeat(64),symlink:false};},
    readSourceBlob:async()=>{throw Error('should not read unverified owner');},
    buildReviewedOwnerCandidate:async()=>{throw Error('should not build unverified owner');},
    assertConsumedLevel4:async()=>{called.consumed++;return {};},
    lock:async()=>({release:async()=>{}}),
    snapshot:async()=>({verified:true}),
    writeExact:async()=>{called.writes++;},
    verifyFile:async()=>{},
    verifyRegistration:async()=>{},
    restoreSnapshot:async()=>{},
    audit:async()=>({persisted:true})
  };
  await expectAsyncFailure(()=>applyTrustedRegistration(adapter),'live_owner_sha_drift_base');
  assert.equal(called.read,1);
  assert.equal(called.consumed,0);
  assert.equal(called.writes,0);
  passed++;

  const child=cp.spawnSync(process.execPath,[path.join(__dirname,'honartik-open-price-yii-registration-transaction-v1.cjs')],
    {encoding:'utf8',timeout:10000});
  assert.equal(child.status,2);
  assert.match(child.stderr,/No CLI/);
  passed++;

  console.log('HONARTIK_SIGNED_REGISTRATION_CONTRACT='+passed+'/'+passed+' PASS');
  console.log('INSTALLER_ACTUALLY_INSTALLED=NO');
})().catch(e=>{console.error(e);process.exitCode=1});
