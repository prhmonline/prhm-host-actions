'use strict';

const path=require('node:path');

const ACTION='drtarjomeh_security_release_deploy_v1';
const OPERATION='host_action.drtarjomeh_security_release_deploy_v1';
const TARGET_COMMIT='f22b1d17801239f7539f84e5aa8b91250c87dc58';
const EXPECTED_RELEASE='20260805-011747-672d32f490bd';
const PRODUCTION_POINTER='/home/drtarjomeh/domains/drtarjomeh.ir/public_html';
const RELEASES_ROOT='/home/drtarjomeh/domains/drtarjomeh.ir/releases';
const SOURCE_REPOSITORY='/home/drtarjomeh/domains/drtarjomeh.ir/repository';
const ENV_PATH='/etc/drtarjomeh/production.env';
const EXPECTED_RELEASE_REALPATH=path.join(RELEASES_ROOT,EXPECTED_RELEASE);

const PAYLOAD=Object.freeze({
  'api/config/main-local.php':Object.freeze({mode:0o644}),
  'api/config/web.php':Object.freeze({mode:0o644}),
  'api/web/index.php':Object.freeze({mode:0o644}),
  'backend/web/index.php':Object.freeze({mode:0o644}),
  'common/components/DisabledSmsService.php':Object.freeze({mode:0o644}),
  'common/config/base.php':Object.freeze({mode:0o644}),
  'common/config/base_env.php':Object.freeze({mode:0o644}),
  'common/config/env/dev.php':Object.freeze({mode:0o644}),
  'common/config/env/dev_m.php':Object.freeze({mode:0o644}),
  'common/config/env/devmp.php':Object.freeze({mode:0o644}),
  'common/config/env/drtarjomeh-ir.php':Object.freeze({mode:0o644}),
  'common/config/env/prod.php':Object.freeze({mode:0o644}),
  'common/config/load-environment.php':Object.freeze({mode:0o644}),
  'common/config/params.php':Object.freeze({mode:0o644}),
  'console/config/main.php':Object.freeze({mode:0o644}),
  'core/helpers/sms/webservice/mediana.php':Object.freeze({mode:0o644}),
  'environments/prod/yii':Object.freeze({mode:0o755}),
  'frontend/web/index.php':Object.freeze({mode:0o644}),
  'panel/web/index.php':Object.freeze({mode:0o644}),
  'scripts/probe-runtime-bootstrap.php':Object.freeze({mode:0o644}),
  'scripts/test-environment-loader.php':Object.freeze({mode:0o644}),
  'site_configs/drtarjomeh-ir.php':Object.freeze({mode:0o644}),
  'translator/web/index.php':Object.freeze({mode:0o644}),
  'yii':Object.freeze({mode:0o755}),
});

const SMOKE=Object.freeze({
  host:'drtarjomeh.ir',
  path:'/',
  status_min:200,
  status_max:399,
  forbidden_body:'Internal Server Error',
});

const SHA256=/^[a-f0-9]{64}$/;

function fail(message){throw new Error(message)}

function assertSafeRelativePath(rel){
  if(typeof rel!=='string'||!rel||path.isAbsolute(rel))fail('unsafe_payload_path');
  const pieces=rel.split('/');
  if(pieces.some(p=>p===''||p==='.'||p==='..'))fail('unsafe_payload_path');
  const normalized=path.posix.normalize(rel);
  if(normalized!==rel||normalized.startsWith('../'))fail('unsafe_payload_path');
  return true;
}

function assertFixedPayload(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))fail('payload_invalid');
  const expected=Object.keys(PAYLOAD).sort();
  const actual=Object.keys(payload).sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))fail('payload_set_mismatch');
  for(const rel of actual){
    assertSafeRelativePath(rel);
    const mode=payload[rel]?.mode;
    if(!Number.isInteger(mode)||![0o644,0o755].includes(mode))fail('payload_mode_invalid:'+rel);
  }
  return true;
}

function assertExpectedRelease(realpath){
  if(realpath!==EXPECTED_RELEASE_REALPATH)fail('unexpected_release');
  return true;
}

function assertPreimage(rel,expected,observed){
  assertSafeRelativePath(rel);
  if(expected==='absent'){
    if(observed?.exists!==false)fail('preimage_expected_absent:'+rel);
    return true;
  }
  if(!SHA256.test(expected))fail('preimage_expected_sha_invalid:'+rel);
  if(!observed||observed.exists===false||observed.isSymlink===true||observed.isFile!==true)fail('preimage_not_regular:'+rel);
  if(!SHA256.test(String(observed.sha256||''))||observed.sha256!==expected)fail('preimage_sha_mismatch:'+rel);
  return true;
}

function freezeManifest(targetHashes,preimages){
  assertFixedPayload(PAYLOAD);
  const out={};
  for(const rel of Object.keys(PAYLOAD)){
    const target=targetHashes?.[rel];
    if(!SHA256.test(String(target||'')))fail('target_sha_invalid:'+rel);
    if(!Object.prototype.hasOwnProperty.call(preimages||{},rel))fail('preimage_missing:'+rel);
    const observed=preimages[rel];
    let preimage;
    if(observed==='absent'){
      preimage='absent';
    }else{
      if(!observed||observed.isSymlink===true||observed.isFile!==true||!SHA256.test(String(observed.sha256||'')))fail('preimage_invalid:'+rel);
      preimage=observed.sha256;
    }
    out[rel]=Object.freeze({target_sha256:target,preimage,mode:PAYLOAD[rel].mode});
  }
  return Object.freeze(out);
}

function selftest(){
  assertFixedPayload(PAYLOAD);
  assertExpectedRelease(EXPECTED_RELEASE_REALPATH);
  return {ok:true,action:ACTION,target_commit:TARGET_COMMIT,payload_count:Object.keys(PAYLOAD).length};
}

if(require.main===module&&process.argv.includes('--selftest-only')){
  process.stdout.write(JSON.stringify(selftest())+'\n');
}

module.exports={
  ACTION,OPERATION,TARGET_COMMIT,EXPECTED_RELEASE,PRODUCTION_POINTER,RELEASES_ROOT,SOURCE_REPOSITORY,ENV_PATH,
  PAYLOAD,SMOKE,assertSafeRelativePath,assertFixedPayload,assertExpectedRelease,assertPreimage,freezeManifest,selftest,
};
