'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const contract=require('./solo-universal-v2-signed-release-contract-v1.cjs');
const P=contract.PINS;
const driver='a'.repeat(40);
const uuid=()=>crypto.randomUUID();
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const publicPem=publicKey.export({type:'spki',format:'pem'});
const fakePin=crypto.createHash('sha256')
  .update(publicKey.export({type:'spki',format:'der'})).digest('hex');
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const now=1794230000;
let passed=0;
function run(name,fn) {
  return Promise.resolve().then(fn).then(()=>{
    passed++; process.stdout.write('PASS '+name+'\n');
  });
}
function issued(claims={}) {
  const body={
    iss:P.issuer,aud:P.audience,operation:P.operation,
    environment:'production',project:'solo_company',
    level:4,risk:'critical',one_time_use:true,
    source_repo:P.source_repo,source_anchor:P.source_anchor,
    driver_git_sha:driver,
    installed_digest:P.installed_digest,
    manifest_preimage_sha256:P.manifest_preimage_sha256,
    candidate_digest:P.candidate_digest,profile_sha256:P.profile_sha256,
    runtime_release:P.runtime_release,
    request_id:uuid(),jti:uuid(),iat:now-2,exp:now+60,
    ...claims,
  };
  const head={alg:'EdDSA',typ:P.type,kid:fakePin.slice(0,16)};
  const input=encode(head)+'.'+encode(body);
  const sig=crypto.sign(null,Buffer.from(input),privateKey).toString('base64url');
  return input+'.'+sig;
}
function verify(token,options={}) {
  return contract.verifySignedPermit({token,publicKeyPem,
    expectedKeySha:fakePin,driverGitSha:driver,nowSec:now,...options});
}
function negative(label,change,pattern) {
  const token=change();
  assert.throws(()=>verify(token),new RegExp(pattern));
  passed++;process.stdout.write('PASS '+label+'\n');
}
const preflight=()=>({
  installed_digest:P.installed_digest,actual_bundle_digest:P.installed_digest,
  installed_manifest_sha256:P.manifest_preimage_sha256,
  candidate_digest:P.candidate_digest,profile_sha256:P.profile_sha256,
  runtime_release:P.runtime_release,
  existing_v1_profiles_valid:true,profile_absent:true,
  service_healthy:true,state_private:true,
  immutable_source_verified:true,root_owned_paths:true,
  no_symlinks:true,protected_targets_unchanged:true,
});
function grant(){
  return {
    verified:true,consumed:true,operation:P.operation,driver_git_sha:driver,
    candidate_digest:P.candidate_digest,profile_sha256:P.profile_sha256,
    jti:uuid(),request_id:uuid(),
  };
}
function mockHost({failure,invalidGrant}={}) {
  const log=[];
  const step=(name,result)=>{
    return (...args)=>{
      log.push(name);
      if(name===failure)throw Error('mocked_'+failure);
      return typeof result==='function'?result(...args):result;
    };
  };
  const methods={
    acquireExclusiveLock:step('lock',{id:'locked-stateful-v2'}),
    preflight:step('preflight',preflight()),
    prepareDurableRollback:step('snapshot',{id:'durable-journal-1'}),
    attestRollbackReady:step('snapshot_fsync',true),
    verifyConsumeSignedL4:step('consume',invalidGrant??grant()),
    installVersionedBundle:step('install_bundle',true),
    installExactProfile:step('install_profile',true),
    attestV2Observation:step('observe',{
      mode:'READ_ONLY_NO_DEPLOY',managed_by_universal:false,
      production_modified:false,runtime_restarted:false,
      solo_deploy_enabled:false,legacy_registry_valid:true,
    }),
    finalizeJournal:step('commit',true),
    restoreJournal:step('restore',true),
    attestRestored:step('verify_rollback',true),
    releaseLock:step('unlock',true),
  };
  return {methods,log};
}
async function main() {
  await run('ed25519 synthetic signature verifies only under test pin',()=>{
    const proof=verify(issued());
    assert.equal(proof.verified,true);
    assert.equal(proof.consumed,false);
    assert.equal(proof.operation,P.operation);
    assert.notEqual(fakePin,P.owner_spki_sha256);
    assert.throws(()=>verify(issued(),{
      expectedKeySha:P.owner_spki_sha256}),/owner_key_pin_mismatch/);
  });
  negative('other operation denied',()=>issued({operation:'host_action.solo_company_runtime_registration_v1'}),'scope_or_time');
  negative('unrelated issuer denied',()=>issued({iss:'prhm-provider-root-of-trust'}),'scope_or_time');
  negative('wrong plan digest denied',()=>issued({profile_sha256:'f'.repeat(64)}),'scope_or_time');
  negative('wrong bundle digest denied',()=>issued({candidate_digest:'f'.repeat(64)}),'scope_or_time');
  negative('wrong manifest preimage denied',()=>issued({manifest_preimage_sha256:'f'.repeat(64)}),'scope_or_time');
  negative('unreviewed driver SHA denied',()=>issued({driver_git_sha:'b'.repeat(40)}),'scope_or_time');
  negative('expired grant denied',()=>issued({iat:now-100,exp:now-10}),'scope_or_time');
  negative('long-lived grant denied',()=>issued({iat:now-1,exp:now+300}),'scope_or_time');
  negative('reused Level3 scope denied',()=>issued({level:3}),'scope_or_time');
  negative('wrong production environment denied',()=>issued({environment:'dev'}),'scope_or_time');
  negative('claim injection denied',()=>issued({managed_by_universal:true}),'scope_or_time');
  negative('noncanonical JWS duplicate claims denied',()=>{
    const original=issued();
    const parts=original.split('.');
    const bad=Buffer.from(
      Buffer.from(parts[1],'base64url').toString('utf8').replace(
        '"level":4','"level":4,"level":4')).toString('base64url');
    return parts[0]+'.'+bad+'.'+parts[2];
  },'noncanonical_json');
  await run('JWS bit flip and invalid signature fail',()=>{
    const parts=issued().split('.');
    const changed=JSON.parse(Buffer.from(parts[1],'base64url'));
    changed.risk='low';
    assert.throws(()=>verify(parts[0]+'.'+encode(changed)+'.'+parts[2]),/signature_invalid/);
  });
  await run('preflight rejects all forged readiness booleans',()=>{
    assert.equal(contract.checkPreflight(preflight()).profile_absent,true);
    for(const key of ['existing_v1_profiles_valid','profile_absent',
      'service_healthy','state_private','immutable_source_verified',
      'root_owned_paths','no_symlinks','protected_targets_unchanged']) {
      const p=preflight();p[key]=false;
      assert.throws(()=>contract.checkPreflight(p),/live_preimage_untrusted/,key);
    }
    const p=preflight();p.installed_manifest_sha256='b'.repeat(64);
    assert.throws(()=>contract.checkPreflight(p),/live_preimage_untrusted/);
  });
  await run('coordinator authorizes before every write',async()=>{
    const {methods,log}=mockHost();
    const x=await contract.coordinateSignedRelease(methods,driver);
    assert.equal(x.status,'COMMITTED');
    assert.equal(x.managed_for_deployment,false);
    assert.deepEqual(log,['lock','preflight','snapshot','snapshot_fsync','consume',
      'install_bundle','install_profile','observe','commit','unlock']);
  });
  await run('invalid consumed grant blocks mutation',async()=>{
    const {methods,log}=mockHost({invalidGrant:{...grant(),consumed:false}});
    await assert.rejects(contract.coordinateSignedRelease(methods,driver),
      /verified_consumed_l4_required/);
    assert(!log.includes('install_bundle'));
    assert(!log.includes('install_profile'));
    assert(!log.includes('restore'));
    assert(log.includes('unlock'));
  });
  for(const stage of ['preflight','snapshot','snapshot_fsync','consume']) {
    await run('failure before write denied: '+stage,async()=>{
      const {methods,log}=mockHost({failure:stage});
      await assert.rejects(contract.coordinateSignedRelease(methods,driver));
      assert(!log.includes('install_bundle'));
      assert(!log.includes('restore'));
      assert(log.includes('unlock'));
    });
  }
  for(const stage of ['install_bundle','install_profile','observe','commit']) {
    await run('after-write failure triggers verified rollback: '+stage,async()=>{
      const {methods,log}=mockHost({failure:stage});
      await assert.rejects(contract.coordinateSignedRelease(methods,driver));
      assert(log.includes('restore'));
      assert(log.includes('verify_rollback'));
      assert(log.includes('unlock'));
      assert(!log.includes('commit') || stage==='commit');
    });
  }
  await run('rollback failure stops with explicit root recovery flag',async()=>{
    const {methods,log}=mockHost({failure:'observe'});
    methods.attestRestored=()=>false;
    await assert.rejects(contract.coordinateSignedRelease(methods,driver),
      /ROLLBACK_FAILED_NEEDS_ROOT_RECOVERY/);
    assert(log.includes('restore'));
  });
  await run('injected broad root host interface is rejected',async()=>{
    await assert.rejects(contract.coordinateSignedRelease({},driver),
      /trusted_root_driver_missing/);
  });
  process.stdout.write('SOLO_UNIVERSAL_V2_SIGNED_RELEASE_SOURCE_TESTS='+passed+' PASS\n');
}
main().catch(e=>{process.stderr.write(String(e.stack)+'\n');process.exitCode=1});
