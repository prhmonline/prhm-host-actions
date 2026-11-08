'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const child=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
const native=require('./honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs');
const reg=require('./solo-company-runtime-l4-registration-candidate-v1.js');
const tx=require('./solo-company-runtime-signed-registration-transaction-v1.js');
const receipt=require('./solo-company-runtime-provider-signed-receipt-v1.js');
const bridge=require('./solo-company-runtime-native-registration-bridge-v1.js');
function syntheticPlan(){
  return {
    schema:'prhm.solo-runtime.registration-plan.v1',action:tx.ACTION,
    operation:tx.OPERATION,release_sha:reg.RELEASE_SHA,
    source_commits:tx.SOURCE_COMMITS,root_helper_sha:tx.PINS.worker_sha,
    steps:tx.ORDER.map(kind=>{
      const bytes=Buffer.from('fixture-'+kind);
      return {kind,path:tx.TARGETS[kind],bytes,
        before_sha256:kind==='worker'?null:kind==='core'?tx.PINS.core_before:reg.EXPECTED[kind],
        after_sha256:tx.hash(bytes),uid:0,gid:0,mode:0o600};
    })
  };
}
test('six owners/assets exactly match native atomic registrar',()=>{
  const p=syntheticPlan(),converted=bridge.convertExactPlan(p);
  assert.deepEqual(converted.steps.map(s=>s.key),['base','executor','mcp','policy']);
  assert.deepEqual(converted.steps.map(s=>s.path),[
    tx.TARGETS.approval,tx.TARGETS.executor,tx.TARGETS.mcp,tx.TARGETS.policy]);
  assert.deepEqual(converted.assets.map(s=>s.path),[tx.TARGETS.core,tx.TARGETS.worker]);
  assert.equal(converted.sourceCommit,tx.SOURCE_COMMITS.host);
  assert.equal(converted.manifestSha256,receipt.hashPlan(p));
  assert.equal(converted.steps.length+converted.assets.length,6);
});
test('exact asset before-images reject drift and unexpected worker under native lock',()=>{
  const p=syntheticPlan();
  const mapped=bridge.convertExactPlan(p);
  assert.equal(mapped.assets[0].expectedBeforeSha,tx.PINS.core_before);
  assert.equal(mapped.assets[1].expectedBeforeSha,null);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-solo-asset-preimage-'));
  try{
    fs.chmodSync(dir,0o700);
    const corePath=path.join(dir,'core.js');
    const workerPath=path.join(dir,'worker.js');
    const initial=Buffer.from('approved-existing-core');
    const coreAfter=Buffer.from('new-core');
    const workerAfter=Buffer.from('new-worker');
    fs.writeFileSync(corePath,initial,{mode:0o600});
    const assets=[
      {path:corePath,nextBytes:coreAfter,afterSha:tx.hash(coreAfter),
        expectedBeforeSha:tx.hash(initial)},
      {path:workerPath,nextBytes:workerAfter,afterSha:tx.hash(workerAfter),
        expectedBeforeSha:null}
    ];
    assert.equal(native.verifyAssetPreimages(assets)[0].beforeSha,tx.hash(initial));
    fs.writeFileSync(corePath,'concurrent-core-drift');
    assert.throws(()=>native.verifyAssetPreimages(assets),/asset_pinned_preimage_mismatch:0/);
    fs.writeFileSync(corePath,initial);
    fs.writeFileSync(workerPath,'unexpected-existing-worker');
    assert.throws(()=>native.verifyAssetPreimages(assets),/asset_pinned_preimage_mismatch:1/);
    fs.unlinkSync(workerPath);
    fs.unlinkSync(corePath);
    assert.throws(()=>native.verifyAssetPreimages(assets),/asset_missing_pinned_preimage:0/);
    assert.equal(native.verifyAssetPreimages([assets[1]])[0].existed,false);
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
test('unknown path, mutated SHA or unsafe permissions are rejected',()=>{
  const p=syntheticPlan();p.steps[2].path='/etc/arbitrary';
  assert.throws(()=>bridge.convertExactPlan(p),/installation_plan_step_invalid/);
  const q=syntheticPlan();q.steps[1].mode=0o666;
  assert.throws(()=>bridge.convertExactPlan(q),/unsafe_asset_metadata/);
  const r=syntheticPlan();r.steps[0].bytes=Buffer.from('attack');
  assert.throws(()=>bridge.convertExactPlan(r),/installation_plan_step_invalid/);
});
test('signed preflight accepts only exact manifest and returns no execute grant',()=>{
  const p=syntheticPlan();
  const keys=crypto.generateKeyPairSync('ed25519'); // test-only ephemeral key
  const pub=keys.publicKey.export({type:'spki',format:'pem'});
  const fingerprint=tx.hash(keys.publicKey.export({type:'spki',format:'der'}));
  const requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const now=1800000000;
  const header={alg:'EdDSA',typ:receipt.TYPE,kid:fingerprint.slice(0,16)};
  const body={
    iss:receipt.ISSUER,aud:receipt.AUDIENCE,env:'production',
    operation:receipt.OPERATION,action:receipt.ACTION,release_sha:p.release_sha,
    plan_sha256:receipt.hashPlan(p),request_id:requestId,
    jti:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',level:4,risk:'critical',
    one_time_use:true,iat:now,exp:now+90,source_commits:tx.SOURCE_COMMITS
  };
  function token(x){
    const a=Buffer.from(JSON.stringify(header)).toString('base64url');
    const b=Buffer.from(JSON.stringify(x)).toString('base64url');
    return a+'.'+b+'.'+crypto.sign(null,Buffer.from(a+'.'+b),keys.privateKey).toString('base64url');
  }
  const args={plan:p,token:token(body),publicKeyPem:pub,
    pinnedPublicKeySha256:fingerprint,requestId,nowSeconds:now+1};
  const result=bridge.preflightReceipt(args);
  assert.equal(result.verifiedReceipt.verified,true);
  assert.equal(result.authorized,false);
  assert.equal(typeof bridge.apply,'undefined');
  assert.equal(typeof bridge.execute,'undefined');
  assert.throws(()=>bridge.preflightReceipt({...args,token:token({...body,operation:'host_action.other'})}),/scope_invalid/);
  assert.throws(()=>bridge.consumeForTrustedDriver({preflight:result,ledgerDir:'/nonexistent/solo',nowSeconds:now+1}),/ENOENT/);
});
test('script cannot execute itself as installer',()=>{
  const c=child.spawnSync(process.execPath,[path.join(__dirname,'solo-company-runtime-native-registration-bridge-v1.js')],{encoding:'utf8'});
  assert.equal(c.status,64);
  assert.match(c.stderr,/NO_CLI/);
});
