'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const harness=require('./deploy-control-cutover-temp-installer-v1.cjs');
const contract=require('./deploy-control-cutover-contract-v1.cjs');
const {PATHS,CHECKPOINTS,run}=harness;

const paths=[
  'PRHM_CUTOVER_LIVE_POLICY_FIXTURE','PRHM_CUTOVER_CANDIDATE_POLICY_FIXTURE',
  'PRHM_CUTOVER_DISPATCHER_FIXTURE','PRHM_CUTOVER_CORE_FIXTURE',
  'PRHM_CUTOVER_SUDOERS_FIXTURE'
].map(x=>process.env[x]);
const haveAll=paths.every(Boolean);
const fxHealth=phase=>({
  ok:true,service:'prhm-company-approval',mode:'mcp-operator',
  algorithm:'Ed25519',one_time_use:true,
  policy_version:phase==='before'?contract.CONTRACT.live_policy_version:contract.CONTRACT.candidate_policy_version,
  policy_hash:phase==='before'?contract.CONTRACT.live_policy_object_sha256:contract.CONTRACT.candidate_policy_object_sha256
});
const legacyA=Buffer.from('deploy-runner ALL=(prhm) NOPASSWD: /home/prhm/deploy/aranob-production.sh *\n');
const legacyH=Buffer.from(
  'deploy-runner ALL=(root) NOPASSWD: /usr/local/libexec/deploy-control/honartik-front-production *\n'+
  'deploy-runner ALL=(honartik) NOPASSWD: /usr/local/libexec/deploy-control/honartik-back-production *\n');
function root(){return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'prhm-cutover-fixture-'))}
const disk=(r,logical)=>path.join(r,logical.slice(1));
function put(r,logical,bytes){
  const target=disk(r,logical);
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  fs.writeFileSync(target,bytes,{mode:0o600});
}
function read(r,logical){
  try{return fs.readFileSync(disk(r,logical))}catch(e){if(e.code==='ENOENT')return null;throw e}
}
function clean(r){fs.rmSync(r,{recursive:true,force:true})}
function getAssets() {
  const [live,policy,helper,core,sudo]=paths.map(x=>fs.readFileSync(x));
  return {live,policy,helper,core,sudo};
}
function patchOnlyForSandbox(helper){
  const old=helper.toString('utf8');
  assert.match(old,/import \{ assertRelease, consumeApprovedRelease \}/);
  assert.match(old,/  const release = await consumeApprovedRelease\(/);
  return Buffer.from(old.replace(
    'import { assertRelease, consumeApprovedRelease }',
    'import { assertRelease, consumeApprovedRelease, verifyIssuerPolicy }'
  ).replace('  const release = await consumeApprovedRelease(',
    '  await verifyIssuerPolicy({baseUrl: config.base_url, expectedPolicyVersion: config.expected_policy_version, expectedPolicyHash: config.expected_policy_hash});\n  const release = await consumeApprovedRelease('));
}
function setup(asset,{synthetic=true}={}){
  const r=root();
  put(r,PATHS.POLICY,asset.live);
  put(r,PATHS.ARANOB,legacyA);
  put(r,PATHS.HONARTIK,legacyH);
  const options={
    mode:'isolated-temp-filesystem',root:r,failureAt:null,
    inputs:{
      policyCandidate:asset.policy,dispatcher:synthetic?patchOnlyForSandbox(asset.helper):asset.helper,
      core:asset.core,gatedSudoers:asset.sudo,issuerBefore:fxHealth('before'),
      issuerAfter:fxHealth('after')
    }
  };
  return {r,options};
}
function equalBefore(r,asset) {
  assert.equal(read(r,PATHS.POLICY).equals(asset.live),true);
  assert.equal(read(r,PATHS.ARANOB).equals(legacyA),true);
  assert.equal(read(r,PATHS.HONARTIK).equals(legacyH),true);
  for(const logical of [PATHS.GATE,PATHS.HELPER,PATHS.CORE])
    assert.equal(read(r,logical),null);
}

test('temp installer has no production main, execute, signed-approval or registration function',()=>{
  assert.deepEqual(Object.keys(harness).sort(),['CHECKPOINTS','PATHS','run'].sort());
  assert.equal(typeof harness.install,'undefined');
  assert.equal(typeof harness.apply,'undefined');
  assert.throws(()=>run({mode:'production',root:'/etc',failureAt:null,inputs:{}}),
    /test_only_invocation/);
  assert.throws(()=>run({mode:'isolated-temp-filesystem',root:'/etc',failureAt:null,inputs:{}}),
    /nonfixture_root_forbidden/);
});

if(!haveAll){
  test('isolated disk fixture requires 5 independently authenticated files',{skip:'Set 5 source fixture env vars'},()=>{});
}else{
  const assets=getAssets();
  test('real unwired dispatcher rejects before filesystem mutation',()=>{
    const {r,options}=setup(assets,{synthetic:false});
    try{
      assert.throws(()=>run(options),/preflight_denied/);
      equalBefore(r,assets);
      assert.equal(fs.existsSync(path.join(r,'.cutover-test-lock')),false);
    }finally{clean(r)}
  });
  test('synthetic future source does a TEMP-ONLY transaction with backed-up preimage',()=>{
    const {r,options}=setup(assets);
    try{
      const result=run(options);
      assert.equal(result.ok,true);
      assert.equal(result.fixture_only,true);
      assert.equal(result.installed_on_host,false);
      assert.equal(result.execution_authorized,false);
      assert.equal(read(r,PATHS.POLICY).equals(assets.policy),true);
      assert.equal(read(r,PATHS.GATE).equals(assets.sudo),true);
      assert.equal(read(r,PATHS.HELPER).equals(options.inputs.dispatcher),true);
      assert.equal(read(r,PATHS.CORE).equals(assets.core),true);
      assert.equal(read(r,PATHS.ARANOB),null);
      assert.equal(read(r,PATHS.HONARTIK),null);
      const manifest=JSON.parse(fs.readFileSync(path.join(result.backup_dir,'manifest.json')));
      assert.equal(manifest.length,6);
      assert.equal(manifest.find(x=>x.logical===PATHS.POLICY).present,true);
      assert.equal(manifest.filter(x=>x.present).length,3);
      assert.match(fs.readFileSync(path.join(r,'cutover-fixture-audit.jsonl'),'utf8'),/fixture_install_success/);
    }finally{clean(r)}
  });
  for(const failureAt of CHECKPOINTS){
    test('disk rollback verifies actual backed-up preimage at '+failureAt,()=>{
      const {r,options}=setup(assets);
      try{
        const result=run({...options,failureAt});
        assert.equal(result.ok,false);
        assert.equal(result.rollback_verified,true);
        assert.equal(result.installed_on_host,false);
        assert.equal(result.failed_at,failureAt);
        equalBefore(r,assets);
        assert.match(fs.readFileSync(path.join(r,'cutover-fixture-audit.jsonl'),'utf8'),/fixture_rollback/);
        assert.equal(fs.existsSync(path.join(r,'.cutover-test-lock')),false);
      }finally{clean(r)}
    });
  }
  test('missing old grant fails closed and cannot create candidate file',()=>{
    const {r,options}=setup(assets);
    try{
      fs.unlinkSync(disk(r,PATHS.HONARTIK));
      assert.throws(()=>run(options),/preimage_missing/);
      assert.equal(read(r,PATHS.GATE),null);
    }finally{clean(r)}
  });
  test('reject symlinked policy file before any backup',()=>{
    const {r,options}=setup(assets);
    try{
      fs.unlinkSync(disk(r,PATHS.POLICY));
      fs.symlinkSync(disk(r,PATHS.ARANOB),disk(r,PATHS.POLICY));
      assert.throws(()=>run(options),/untrusted_fixture_file/);
      assert.equal(read(r,PATHS.GATE),null);
    }finally{clean(r)}
  });
  test('reject symlinked intermediate directory',()=>{
    const {r,options}=setup(assets);
    try{
      fs.renameSync(path.join(r,'opt'),path.join(r,'opt-real'));
      fs.symlinkSync(path.join(r,'opt-real'),path.join(r,'opt'));
      assert.throws(()=>run(options),/untrusted_fixture_parent/);
    }finally{clean(r)}
  });
  test('reject candidate policy drift before disk mutation',()=>{
    const {r,options}=setup(assets);
    try{
      const p=JSON.parse(assets.policy);
      p.operations['deploy.production'].level=0;
      options.inputs.policyCandidate=Buffer.from(JSON.stringify(p));
      assert.throws(()=>run(options),/candidate_policy_hash_drift/);
      equalBefore(r,assets);
    }finally{clean(r)}
  });
  test('a pre-existing fixture candidate asset fails closed',()=>{
    const {r,options}=setup(assets);
    try{
      put(r,PATHS.GATE,Buffer.from('unexpected'));
      assert.throws(()=>run(options),/unexpected_existing_candidate/);
      assert.equal(read(r,PATHS.GATE).toString(),'unexpected');
    }finally{clean(r)}
  });
  test('concurrent/colliding fixture installation lock is refused',()=>{
    const {r,options}=setup(assets);
    try{
      fs.mkdirSync(path.join(r,'.cutover-test-lock'));
      assert.throws(()=>run(options),/EEXIST/);
    }finally{clean(r)}
  });
  test('invalid checkpoint selector rejected without modifying fixture',()=>{
    const {r,options}=setup(assets);
    try{
      assert.throws(()=>run({...options,failureAt:'run_sudo'}),/unknown_failure_point/);
      equalBefore(r,assets);
    }finally{clean(r)}
  });
}
