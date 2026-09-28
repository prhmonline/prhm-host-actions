'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const bootstrap=require('./bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js');

function loadHelper(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'drt-v29-cutover-'));
  const file=path.join(dir,'helper.js');
  fs.writeFileSync(file,bootstrap.buildHelperSource(),'utf8');
  delete require.cache[require.resolve(file)];
  return {helper:require(file),dir};
}

test('verification plan is fixed to payload lint plus six no-send runtime probes',t=>{
  const {helper,dir}=loadHelper(); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const plan=helper.buildVerificationPlan('/candidate',bootstrap.PAYLOAD);
  assert.deepEqual(plan.probeApps,['api','backend','frontend','panel','translator','console']);
  assert.deepEqual(plan.probeCommands.map(x=>x.args),[
    ['scripts/probe-runtime-bootstrap.php','api'],
    ['scripts/probe-runtime-bootstrap.php','backend'],
    ['scripts/probe-runtime-bootstrap.php','frontend'],
    ['scripts/probe-runtime-bootstrap.php','panel'],
    ['scripts/probe-runtime-bootstrap.php','translator'],
    ['scripts/probe-runtime-bootstrap.php','console'],
  ]);
  assert.ok(plan.lintFiles.includes('scripts/test-environment-loader.php'));
  assert.ok(plan.lintFiles.includes('api/config/web.php'));
  assert.ok(plan.lintFiles.includes('yii'));
  assert.ok(plan.lintFiles.includes('environments/prod/yii'));
  assert.equal(plan.networkAllowed,false);
  assert.equal(plan.databaseWriteAllowed,false);
  assert.equal(plan.notificationsAllowed,false);
});

test('fixed smoke contract accepts only bounded healthy public response',t=>{
  const {helper,dir}=loadHelper(); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert.equal(helper.smokeContractOk(200,'OK'),true);
  assert.equal(helper.smokeContractOk(302,'redirect'),true);
  assert.equal(helper.smokeContractOk(500,'oops'),false);
  assert.equal(helper.smokeContractOk(200,'Internal Server Error'),false);
});

test('atomic cutover swaps only the pointer and returns previous realpath',t=>{
  const {helper,dir}=loadHelper(); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const releases=path.join(dir,'releases'); fs.mkdirSync(releases);
  const oldRelease=path.join(releases,'old'); const newRelease=path.join(releases,'new');
  fs.mkdirSync(oldRelease); fs.mkdirSync(newRelease);
  const pointer=path.join(dir,'public_html'); fs.symlinkSync(oldRelease,pointer);
  const previous=helper.atomicCutover(pointer,newRelease);
  assert.equal(previous,oldRelease);
  assert.equal(fs.realpathSync(pointer),newRelease);
  assert.equal(fs.existsSync(oldRelease),true);
});

test('rollback restores previous pointer and env bytes after simulated post-cutover failure',t=>{
  const {helper,dir}=loadHelper(); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const releases=path.join(dir,'releases'); fs.mkdirSync(releases);
  const oldRelease=path.join(releases,'old'); const failedRelease=path.join(releases,'failed');
  fs.mkdirSync(oldRelease); fs.mkdirSync(failedRelease);
  const pointer=path.join(dir,'public_html'); fs.symlinkSync(failedRelease,pointer);
  const env=path.join(dir,'production.env'); fs.writeFileSync(env,'NEW_ENV',{mode:0o600});
  const envBackup=path.join(dir,'production.env.backup'); fs.writeFileSync(envBackup,'OLD_ENV',{mode:0o600});
  const result=helper.rollback({pointer,previousRelease:oldRelease,candidateRelease:failedRelease,envPath:env,envBackupPath:envBackup,envPreviouslyExisted:true,cutoverPerformed:true},()=>true);
  assert.equal(result.performed,true);
  assert.equal(result.verified,true);
  assert.equal(fs.realpathSync(pointer),oldRelease);
  assert.equal(fs.readFileSync(env,'utf8'),'OLD_ENV');
  assert.equal(fs.existsSync(failedRelease),true);
});

test('rollback reports incomplete when restored production smoke fails',t=>{
  const {helper,dir}=loadHelper(); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const oldRelease=path.join(dir,'old'); const failedRelease=path.join(dir,'failed');
  fs.mkdirSync(oldRelease); fs.mkdirSync(failedRelease);
  const pointer=path.join(dir,'public_html'); fs.symlinkSync(failedRelease,pointer);
  const result=helper.rollback({pointer,previousRelease:oldRelease,candidateRelease:failedRelease,envPreviouslyExisted:false,cutoverPerformed:true},()=>false);
  assert.equal(result.performed,true);
  assert.equal(result.verified,false);
  assert.equal(result.status,'FAILED_ROLLBACK_INCOMPLETE');
});

test('success result exposes only bounded non-secret closure evidence',t=>{
  const {helper,dir}=loadHelper(); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const r=helper.buildSuccessResult({previousRelease:'/r/old',newRelease:'/r/new'});
  assert.deepEqual({
    ok:r.ok,action:r.action,target_commit:r.target_commit,preflight_passed:r.preflight_passed,
    php_lint_passed:r.php_lint_passed,runtime_probe_passed:r.runtime_probe_passed,
    env_runtime_readability_passed:r.env_runtime_readability_passed,mail_fail_closed:r.mail_fail_closed,
    sms_fail_closed:r.sms_fail_closed,debug_disabled:r.debug_disabled,cutover_performed:r.cutover_performed,
    smoke_passed:r.smoke_passed,database_mutation:r.database_mutation,
    provider_credential_rotation:r.provider_credential_rotation,credential_values_returned:r.credential_values_returned,
    rollback_performed:r.rollback_performed,
  },{
    ok:true,action:'drtarjomeh_security_release_deploy_v1',target_commit:'f22b1d17801239f7539f84e5aa8b91250c87dc58',
    preflight_passed:true,php_lint_passed:true,runtime_probe_passed:true,env_runtime_readability_passed:true,
    mail_fail_closed:true,sms_fail_closed:true,debug_disabled:true,cutover_performed:true,smoke_passed:true,
    database_mutation:false,provider_credential_rotation:false,credential_values_returned:false,rollback_performed:false,
  });
});
