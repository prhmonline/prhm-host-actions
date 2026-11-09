'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {FIXED,LEGACY,classify,bundleSourceDigest}=require('./u01-universal-root-trust-current-preflight-v1.cjs');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');

function fixture({registered=false,provider=false,native=false}={}) {
  return {
    installed:{digest:FIXED.currentBundle,previous:FIXED.previousBundle},
    manifestSafe:true,currentPointerValid:true,backupSha256:FIXED.backupSha256,
    engineSha256:FIXED.engineSha256,
    currentSource:{digest:FIXED.currentBundle,fileCount:FIXED.expectedBundleFileCount},
    previousSource:{digest:FIXED.previousBundle,fileCount:FIXED.expectedBundleFileCount},
    owners:Object.fromEntries(Object.entries(FIXED.ownerPreimages).map(([name,v])=>[
      name,{present:true,safe:true,sha256:v.sha256,uid:0,mode:v.mode,
        registrarMentioned:registered}
    ])),
    providerAnchorSafe:provider,nativeRegistrarSafe:native,
    policyRegistration:registered
  };
}
test('pinned 2026-11-09 baseline is exact but root is NOT registered',()=>{
  const result=classify(fixture());
  assert.equal(result.sourcePreimageExact,true);
  assert.equal(result.legacyBackupOnlyCandidateIsObsolete,true);
  assert.equal(result.gates.providerTrustAnchorPresent,false);
  assert.equal(result.gates.rootOwnedNativeRegistrarPresent,false);
  assert.equal(result.gates.apiRegistered,false);
  assert.equal(result.nativeRegistrationReadyForIndependentReview,false);
  assert.equal(result.productionChanged,false);
  assert.equal(result.rootOfTrustMutationAuthorized,false);
});
test('old 47e248 base cannot silently qualify',()=>{
  const s=fixture();
  s.installed.digest=LEGACY.base;
  const x=classify(s);
  assert.equal(x.gates.exactCurrentBundle,false);
  assert.equal(x.sourcePreimageExact,false);
  assert.ok(x.blockers.includes('exactCurrentBundle'));
});
test('modified authority-owner bytes fail closed before any registration',()=>{
  const s=fixture({provider:true,native:true,registered:true});
  s.owners.executor.sha256='0'.repeat(64);
  const x=classify(s);
  assert.equal(x.gates.owner_executor,false);
  assert.equal(x.nativeRegistrationReadyForIndependentReview,false);
});
test('mode and uid drift fail closed',()=>{
  const s=fixture({provider:true,native:true,registered:true});
  s.owners.mcp.mode=0o666;
  s.owners.approvalService.uid=1000;
  const x=classify(s);
  assert.equal(x.gates.owner_mcp,false);
  assert.equal(x.gates.owner_approvalService,false);
});
test('pointer/manifest/backup mismatches fail closed',()=>{
  const s=fixture();
  s.manifestSafe=false;
  s.currentPointerValid=false;
  s.backupSha256='0'.repeat(64);
  const x=classify(s);
  assert.equal(x.gates.safeInstallationManifest,false);
  assert.equal(x.gates.correctCurrentPointer,false);
  assert.equal(x.gates.exactBackup,false);
});
test('partial registration is not a passed gate',()=>{
  const s=fixture({provider:true,native:true});
  s.owners.agentApi.registrarMentioned=true;
  s.owners.executor.registrarMentioned=true;
  const x=classify(s);
  assert.equal(x.gates.apiRegistered,true);
  assert.equal(x.gates.executorRegistered,true);
  assert.equal(x.gates.mcpRegistered,false);
  assert.equal(x.gates.level4PolicyRegistered,false);
  assert.equal(x.nativeRegistrationReadyForIndependentReview,false);
});
test('even synthetically green registration flags never create authorization',()=>{
  const x=classify(fixture({provider:true,native:true,registered:true}));
  assert.equal(x.blockers.length,0);
  assert.equal(x.nativeRegistrationReadyForIndependentReview,true);
  assert.equal(x.rootOfTrustMutationAuthorized,false);
  assert.equal(x.signedProviderBootstrapAccepted,false);
  assert.equal(x.level4ApprovalIssued,false);
  assert.equal(x.approvalOrDispatchRequested,false);
  assert.equal(x.productionChanged,false);
});
test('incomplete snapshot is blocked',()=>{
  const x=classify({installed:{digest:FIXED.currentBundle}});
  assert.equal(x.rootOfTrustMutationAuthorized,false);
  assert.equal(x.sourcePreimageExact,false);
  assert.ok(x.blockers.length>5);
});

test('changed engine bytes reject otherwise matching source-only admission',()=>{
  const s=fixture({provider:true,native:true,registered:true});
  s.engineSha256='f'.repeat(64);
  const x=classify(s);
  assert.equal(x.gates.exactEngine,false);
  assert.equal(x.nativeRegistrationReadyForIndependentReview,false);
});
test('current source closure mismatch fails even when manifest claims exact digest',()=>{
  const s=fixture();
  s.currentSource.digest='0'.repeat(64);
  const x=classify(s);
  assert.equal(x.gates.exactCurrentBundle,true);
  assert.equal(x.gates.currentBundleBytesVerified,false);
  assert.equal(x.sourcePreimageExact,false);
});
test('previous source closure is separately bound',()=>{
  const s=fixture();
  s.previousSource.fileCount=29;
  const x=classify(s);
  assert.equal(x.gates.previousBundleBytesVerified,false);
  assert.equal(x.sourcePreimageExact,false);
});
test('Python bundle digest encoding and malicious source symlink rejection',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'u01-source-only-'));
  try {
    const sub=path.join(dir,'universal');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub,'cli.py'),'# verified fixture\n');
    fs.writeFileSync(path.join(sub,'engine.py'),'pass\n');
    const digest=crypto.createHash('sha256');
    for(const [name,data] of [
      ['universal/cli.py','# verified fixture\n'],
      ['universal/engine.py','pass\n']
    ])digest.update(name+'\0'+data+'\0');
    const actual=bundleSourceDigest(dir);
    assert.equal(actual.digest,digest.digest('hex'));
    assert.equal(actual.fileCount,2);
    fs.symlinkSync('/etc/passwd',path.join(sub,'evil.py'));
    assert.throws(()=>bundleSourceDigest(dir),/source_symlink_forbidden/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
