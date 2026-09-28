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

function helperModuleFactory(){
  'use strict';
  const fs=require('node:fs');
  const path=require('node:path');
  const crypto=require('node:crypto');
  const ACTION='drtarjomeh_security_release_deploy_v1';
  const TARGET_COMMIT='f22b1d17801239f7539f84e5aa8b91250c87dc58';
  const EXPECTED_RELEASE='20260805-011747-672d32f490bd';
  const BASE_HOST='drtarjomeh.ir';

  function fail(message){throw new Error(message)}
  function safeRel(rel){
    if(typeof rel!=='string'||!rel||path.isAbsolute(rel))fail('unsafe_payload_path');
    const parts=rel.split('/');
    if(parts.some(p=>p===''||p==='.'||p==='..')||path.posix.normalize(rel)!==rel)fail('unsafe_payload_path');
    return rel;
  }
  function sanitizeText(input,secrets=[]){
    let out=String(input??'');
    for(const secret of secrets){
      const s=String(secret??'');
      if(s)out=out.split(s).join('[REDACTED]');
    }
    return out;
  }
  function materializeCandidate(source,candidate,overlays,manifest){
    if(!path.isAbsolute(source)||!path.isAbsolute(candidate)||source===candidate)fail('candidate_path_invalid');
    const sourceStat=fs.lstatSync(source);
    if(sourceStat.isSymbolicLink()||!sourceStat.isDirectory())fail('source_release_invalid');
    if(fs.existsSync(candidate))fail('candidate_exists');
    fs.cpSync(source,candidate,{recursive:true,preserveTimestamps:true,dereference:false});
    try{
      for(const [rel,bytes] of Object.entries(overlays||{})){
        safeRel(rel);
        if(!Object.prototype.hasOwnProperty.call(manifest||{},rel))fail('overlay_manifest_missing:'+rel);
        const dst=path.join(candidate,rel);
        const resolvedParent=path.resolve(path.dirname(dst));
        const candidateResolved=path.resolve(candidate);
        if(resolvedParent!==candidateResolved&&!resolvedParent.startsWith(candidateResolved+path.sep))fail('overlay_escape:'+rel);
        fs.mkdirSync(path.dirname(dst),{recursive:true});
        fs.writeFileSync(dst,bytes,{mode:manifest[rel].mode});
        fs.chmodSync(dst,manifest[rel].mode);
      }
      return candidate;
    }catch(error){
      try{fs.rmSync(candidate,{recursive:true,force:true})}catch{}
      throw error;
    }
  }
  function hexKey(rng){return Buffer.from(rng(32)).toString('hex')}
  function buildProtectedEnv(values,rng=crypto.randomBytes){
    const required=['dbDsn','dbUser','dbPass','db2Dsn','db2User','db2Pass','operationalEmail','senderEmail','senderName'];
    for(const key of required){if(values?.[key]===undefined||values[key]===null)fail('env_source_missing:'+key)}
    return Object.freeze({
      DRT_YII_ENV:'prod',DRT_YII_DEBUG:'0',DRT_DEBUG_IPS:'',DRT_LOG_TARGETS:'db,file',
      DRT_BASE_SCHEME:'https',DRT_BASE_HOST:BASE_HOST,
      DRT_APP_TOKEN:hexKey(rng),DRT_COOKIE_VALIDATION_KEY:hexKey(rng),DRT_API_COOKIE_VALIDATION_KEY:hexKey(rng),
      DRT_DB_DSN:String(values.dbDsn),DRT_DB_USER:String(values.dbUser),DRT_DB_PASS:String(values.dbPass),DRT_DB_PREFIX:'',
      DRT_DB2_DSN:String(values.db2Dsn),DRT_DB2_USER:String(values.db2User),DRT_DB2_PASS:String(values.db2Pass),DRT_DB2_PREFIX:'',
      DRT_OPERATIONAL_EMAIL:String(values.operationalEmail),DRT_SENDER_EMAIL:String(values.senderEmail),DRT_SENDER_NAME:String(values.senderName),
      DRT_MAIL_DRIVER:'file',DRT_MAIL_HOST:'',DRT_MAIL_PORT:'',DRT_MAIL_USERNAME:'',DRT_MAIL_PASSWORD:'',DRT_MAIL_ENCRYPTION:'tls',
      DRT_SMS_ENABLED:'0',DRT_SMS_FROM:'',DRT_SMS_KEY:'',
      DRT_SLACK_TOKEN:'',DRT_SLACK_CHANNEL_ID:'',DRT_SLACK_CHANNEL_ID_400:'',
      DRT_STORAGE_SCHEME:'https',DRT_STORAGE_HOST:'storage.drtarjomeh.ir',DRT_STORAGE_BASE_URL:'https://storage.drtarjomeh.ir',
    });
  }
  function renderProtectedEnv(env){
    const lines=[];
    for(const [key,valueRaw] of Object.entries(env||{})){
      if(!/^DRT_[A-Z0-9_]+$/.test(key))fail('env_key_invalid');
      const value=String(valueRaw??'');
      if(/[\r\n\0]/.test(value))fail('env_value_unsafe:'+key);
      lines.push(key+"='"+value+"'");
    }
    return lines.join('\n')+'\n';
  }
  function assertEnvState(observed,expectedPreimage,runtimeReadable){
    if(!observed||observed.exists!==true)fail('env_missing');
    if(observed.isSymlink===true)fail('env_symlink');
    if(observed.isFile!==true)fail('env_not_regular');
    if((observed.mode&0o777)!==0o600)fail('env_mode');
    if(expectedPreimage&&expectedPreimage!=='absent'&&observed.sha256!==expectedPreimage)fail('env_preimage');
    if(runtimeReadable!==true)fail('env_runtime_unreadable');
    return true;
  }

  module.exports={ACTION,TARGET_COMMIT,EXPECTED_RELEASE,sanitizeText,materializeCandidate,buildProtectedEnv,renderProtectedEnv,assertEnvState};
}

function buildHelperSource(){return "'use strict';\n("+helperModuleFactory.toString()+")();\n"}

function selftest(){
  assertFixedPayload(PAYLOAD);
  assertExpectedRelease(EXPECTED_RELEASE_REALPATH);
  const helper=buildHelperSource();
  if(!helper.includes(ACTION)||!helper.includes(TARGET_COMMIT))fail('helper_identity_missing');
  return {ok:true,action:ACTION,target_commit:TARGET_COMMIT,payload_count:Object.keys(PAYLOAD).length};
}

if(require.main===module&&process.argv.includes('--selftest-only')){
  process.stdout.write(JSON.stringify(selftest())+'\n');
}

module.exports={
  ACTION,OPERATION,TARGET_COMMIT,EXPECTED_RELEASE,PRODUCTION_POINTER,RELEASES_ROOT,SOURCE_REPOSITORY,ENV_PATH,
  PAYLOAD,SMOKE,assertSafeRelativePath,assertFixedPayload,assertExpectedRelease,assertPreimage,freezeManifest,buildHelperSource,selftest,
};
