'use strict';

const EXPECTED_PAYLOAD=Object.freeze([
  'api/config/main-local.php','api/config/web.php','api/web/index.php','backend/web/index.php',
  'common/components/DisabledSmsService.php','common/config/base.php','common/config/base_env.php',
  'common/config/env/dev.php','common/config/env/dev_m.php','common/config/env/devmp.php',
  'common/config/env/drtarjomeh-ir.php','common/config/env/prod.php','common/config/load-environment.php',
  'common/config/params.php','console/config/main.php','core/helpers/sms/webservice/mediana.php',
  'environments/prod/yii','frontend/web/index.php','panel/web/index.php','scripts/probe-runtime-bootstrap.php',
  'scripts/test-environment-loader.php','site_configs/drtarjomeh-ir.php','translator/web/index.php','yii',
]);

function runtimeFactory(binding){
  'use strict';
  const fs=require('node:fs');
  const path=require('node:path');
  const crypto=require('node:crypto');
  const cp=require('node:child_process');

  const ACTION='drtarjomeh_security_release_deploy_v1';
  const TARGET_COMMIT='f22b1d17801239f7539f84e5aa8b91250c87dc58';
  const EXPECTED_RELEASE='20260805-011747-672d32f490bd';
  const PRODUCTION_POINTER='/home/drtarjomeh/domains/drtarjomeh.ir/public_html';
  const RELEASES_ROOT='/home/drtarjomeh/domains/drtarjomeh.ir/releases';
  const SOURCE_REPOSITORY='/home/drtarjomeh/domains/drtarjomeh.ir/repository';
  const ENV_PATH='/etc/drtarjomeh/production.env';
  const RESULT='/var/lib/prhm-agent-selfmaint-exec/drtarjomeh-security-release-deploy-v1/latest.json';
  const LOCK='/var/lib/prhm-agent-selfmaint-exec/drtarjomeh-security-release-deploy-v1/run.lock';
  const BACKUP_ROOT='/var/backups/prhm-drtarjomeh-security-release-deploy-v1';
  const PROBE_APPS=Object.freeze(['api','backend','frontend','panel','translator','console']);
  const EXPECTED_PAYLOAD=Object.freeze([
    'api/config/main-local.php','api/config/web.php','api/web/index.php','backend/web/index.php',
    'common/components/DisabledSmsService.php','common/config/base.php','common/config/base_env.php',
    'common/config/env/dev.php','common/config/env/dev_m.php','common/config/env/devmp.php',
    'common/config/env/drtarjomeh-ir.php','common/config/env/prod.php','common/config/load-environment.php',
    'common/config/params.php','console/config/main.php','core/helpers/sms/webservice/mediana.php',
    'environments/prod/yii','frontend/web/index.php','panel/web/index.php','scripts/probe-runtime-bootstrap.php',
    'scripts/test-environment-loader.php','site_configs/drtarjomeh-ir.php','translator/web/index.php','yii',
  ]);
  const SHA=/^[a-f0-9]{64}$/;
  const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  function fail(message){throw new Error(message)}
  function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const v of Object.values(value))deepFreeze(v)}return value}
  const BINDING=deepFreeze(binding);

  function validateBinding(input){
    if(!input||input.schema!=='prhm.drtarjomeh-security-release-binding.v1')fail('binding_schema');
    if(input.target_commit!==TARGET_COMMIT)fail('binding_target_commit');
    if(input.expected_release!==EXPECTED_RELEASE)fail('binding_expected_release');
    const keys=Object.keys(input.manifest||{}).sort();
    if(JSON.stringify(keys)!==JSON.stringify([...EXPECTED_PAYLOAD].sort()))fail('binding_manifest_set');
    for(const rel of keys){
      if(path.isAbsolute(rel)||rel.split('/').some(x=>x===''||x==='.'||x==='..')||path.posix.normalize(rel)!==rel)fail('binding_manifest_path');
      const item=input.manifest[rel];
      if(!item||!SHA.test(String(item.target_sha256||'')))fail('binding_target_sha');
      if(!(item.preimage==='absent'||SHA.test(String(item.preimage||''))))fail('binding_preimage');
      if(!Number.isInteger(item.mode)||![0o644,0o755].includes(item.mode))fail('binding_mode');
    }
    if(!(input.env_preimage==='absent'||SHA.test(String(input.env_preimage||''))))fail('binding_env_preimage');
    if(!Number.isInteger(input.runtime?.uid)||input.runtime.uid<0||!Number.isInteger(input.runtime?.gid)||input.runtime.gid<0)fail('binding_runtime_identity');
    return true;
  }

  function sanitizeText(input,secrets=[]){
    let out=String(input??'');
    for(const secret of secrets){const s=String(secret??'');if(s)out=out.split(s).join('[REDACTED]')}
    return out;
  }
  function hexKey(rng){return Buffer.from(rng(32)).toString('hex')}
  function buildProtectedEnv(values,rng=crypto.randomBytes){
    const required=['dbDsn','dbUser','dbPass','db2Dsn','db2User','db2Pass','operationalEmail','senderEmail','senderName'];
    for(const key of required){if(values?.[key]===undefined||values[key]===null||String(values[key])==='')fail('env_source_missing:'+key)}
    return Object.freeze({
      DRT_YII_ENV:'prod',DRT_YII_DEBUG:'0',DRT_DEBUG_IPS:'',DRT_LOG_TARGETS:'db,file',DRT_BASE_SCHEME:'https',DRT_BASE_HOST:'drtarjomeh.ir',
      DRT_APP_TOKEN:hexKey(rng),DRT_COOKIE_VALIDATION_KEY:hexKey(rng),DRT_API_COOKIE_VALIDATION_KEY:hexKey(rng),
      DRT_DB_DSN:String(values.dbDsn),DRT_DB_USER:String(values.dbUser),DRT_DB_PASS:String(values.dbPass),DRT_DB_PREFIX:'',
      DRT_DB2_DSN:String(values.db2Dsn),DRT_DB2_USER:String(values.db2User),DRT_DB2_PASS:String(values.db2Pass),DRT_DB2_PREFIX:'',
      DRT_OPERATIONAL_EMAIL:String(values.operationalEmail),DRT_SENDER_EMAIL:String(values.senderEmail),DRT_SENDER_NAME:String(values.senderName),
      DRT_MAIL_DRIVER:'file',DRT_MAIL_HOST:'',DRT_MAIL_PORT:'',DRT_MAIL_USERNAME:'',DRT_MAIL_PASSWORD:'',DRT_MAIL_ENCRYPTION:'tls',
      DRT_SMS_ENABLED:'0',DRT_SMS_FROM:'',DRT_SMS_KEY:'',DRT_SLACK_TOKEN:'',DRT_SLACK_CHANNEL_ID:'',DRT_SLACK_CHANNEL_ID_400:'',
      DRT_STORAGE_SCHEME:'https',DRT_STORAGE_HOST:'storage.drtarjomeh.ir',DRT_STORAGE_BASE_URL:'https://storage.drtarjomeh.ir',
    });
  }
  function renderProtectedEnv(env){
    const lines=[];
    for(const [key,raw] of Object.entries(env||{})){
      if(!/^DRT_[A-Z0-9_]+$/.test(key))fail('env_key_invalid');
      const value=String(raw??'');if(/[\r\n\0]/.test(value))fail('env_value_unsafe');
      lines.push(key+"='"+value.replace(/'/g,"'\\''")+"'");
    }
    return lines.join('\n')+'\n';
  }

  function secretExtractorPhp(release){
    const literal=JSON.stringify(String(release));
    return [
      '$root='+literal+';',
      "define('BEENSA_BASE_DIR',$root);",
      "define('BEENSA_APP_DIR',$root.'/console');",
      "define('BEENSA_ENV','prod');",
      "define('IS_CONSOLE_APP',true);",
      "$_SERVER['HTTP_HOST']='drtarjomeh.ir';",
      "require $root.'/common/_global_functions.php';",
      "$c=include $root.'/common/config/env/prod.php';",
      "$o=['dbDsn'=>$c['DB']['dsn']??'', 'dbUser'=>$c['DB']['user']??'', 'dbPass'=>$c['DB']['pass']??'', 'db2Dsn'=>$c['DB2']['dsn']??'', 'db2User'=>$c['DB2']['user']??'', 'db2Pass'=>$c['DB2']['pass']??'', 'operationalEmail'=>$c['adminEmail']??($c['params']['adminEmail']??''), 'senderEmail'=>$c['noreplyEmail']??($c['adminEmail']??''), 'senderName'=>'DrTarjomeh'];",
      "echo base64_encode(json_encode($o,JSON_UNESCAPED_SLASHES));",
    ].join('');
  }
  function deriveCurrentSecrets(adapter,release){
    const r=adapter.runCaptured('/usr/bin/php',['-r',secretExtractorPhp(release)]);
    if(!r||r.status!==0)fail('secret_extract_failed');
    try{
      const decoded=Buffer.from(String(r.stdout||''),'base64').toString('utf8');
      const values=JSON.parse(decoded);
      for(const key of ['dbDsn','dbUser','dbPass','db2Dsn','db2User','db2Pass','operationalEmail','senderEmail','senderName'])if(!values?.[key])fail('secret_extract_invalid');
      return values;
    }catch(_e){fail('secret_extract_failed')}
  }

  function inspectFile(file){
    if(!fs.existsSync(file))return{exists:false};
    const st=fs.lstatSync(file);
    return{exists:true,isFile:st.isFile(),isSymlink:st.isSymbolicLink(),mode:st.mode&0o777,sha256:st.isFile()&&!st.isSymbolicLink()?sha(fs.readFileSync(file)):null,uid:st.uid,gid:st.gid};
  }
  function assertPreimage(rel,expected,file){
    const observed=inspectFile(file);
    if(expected==='absent'){if(observed.exists)fail('preimage_expected_absent:'+rel);return}
    if(!observed.exists||observed.isSymlink||!observed.isFile)fail('preimage_not_regular:'+rel);
    if(observed.sha256!==expected)fail('preimage_sha_mismatch:'+rel);
  }
  function atomicWrite(file,bytes,mode,uid,gid){
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    const tmp=file+'.tmp-'+process.pid+'-'+Date.now();let fd;
    try{fd=fs.openSync(tmp,'wx',mode);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.chmodSync(tmp,mode);if(Number.isInteger(uid)&&Number.isInteger(gid))fs.chownSync(tmp,uid,gid);fs.renameSync(tmp,file)}catch(e){try{if(fd!==undefined)fs.closeSync(fd)}catch{}try{fs.unlinkSync(tmp)}catch{}throw e}
  }
  function atomicCutover(pointer,candidate){
    const st=fs.lstatSync(pointer);if(!st.isSymbolicLink())fail('production_pointer_not_symlink');
    const old=fs.realpathSync(pointer);const cst=fs.lstatSync(candidate);if(cst.isSymbolicLink()||!cst.isDirectory())fail('candidate_release_invalid');
    const tmp=pointer+'.swap-'+process.pid+'-'+Date.now();fs.symlinkSync(candidate,tmp);fs.renameSync(tmp,pointer);if(fs.realpathSync(pointer)!==candidate)fail('cutover_verify_failed');return old;
  }
  function smokeContractOk(status,body){return Number.isInteger(status)&&status>=200&&status<=399&&!String(body??'').includes('Internal Server Error')}
  function buildSuccessResult(state){return Object.freeze({schema:'prhm.host-action-result.v1',ok:true,action:ACTION,target_commit:TARGET_COMMIT,previous_release:String(state.previousRelease||''),new_release:String(state.newRelease||''),preflight_passed:true,php_lint_passed:true,runtime_probe_passed:true,env_runtime_readability_passed:true,mail_fail_closed:true,sms_fail_closed:true,debug_disabled:true,cutover_performed:true,smoke_passed:true,database_mutation:false,provider_credential_rotation:false,credential_values_returned:false,rollback_performed:false})}

  function executeWithAdapter(adapter){
    const state={cutoverPerformed:false,mutated:false,candidateRelease:null,previousRelease:null,envBackup:null};
    let locked=false;let secrets=[];
    try{
      adapter.acquireLock();locked=true;
      adapter.verifyPreflight(BINDING);
      const targetBytes=adapter.readTargetBytes(BINDING);
      const current=adapter.deriveSecrets?adapter.deriveSecrets():deriveCurrentSecrets(adapter,path.join(RELEASES_ROOT,EXPECTED_RELEASE));
      secrets=Object.values(current).filter(v=>typeof v==='string');
      const env=buildProtectedEnv(current);
      state.envBackup=adapter.backupEnv(BINDING);state.mutated=true;
      state.candidateRelease=adapter.createCandidate(targetBytes,BINDING);
      adapter.writeProtectedEnv(env,BINDING);
      adapter.verifyEnvReadable(BINDING);
      adapter.verifyCandidate(state.candidateRelease,BINDING);
      state.previousRelease=adapter.cutover(state.candidateRelease,BINDING);state.cutoverPerformed=true;
      if(adapter.smoke(BINDING)!==true)fail('post_cutover_smoke_failed');
      const result=buildSuccessResult({previousRelease:state.previousRelease,newRelease:state.candidateRelease});
      adapter.persistResult(result);if(locked){adapter.releaseLock();locked=false}return result;
    }catch(error){
      let rb={performed:false,verified:false,status:'FAILED_PRECHECK'};
      if(state.mutated){try{rb=adapter.rollback({...state,envBackup:state.envBackup},BINDING)||rb}catch{rb={performed:true,verified:false,status:'FAILED_ROLLBACK_INCOMPLETE'}}}
      const result={schema:'prhm.host-action-result.v1',ok:false,action:ACTION,target_commit:TARGET_COMMIT,status:rb.status||'FAILED',rollback_performed:rb.performed===true,rollback_verified:rb.verified===true,database_mutation:false,provider_credential_rotation:false,credential_values_returned:false,error:'security_release_failed'};
      try{adapter.persistResult(result)}catch{}if(locked){try{adapter.releaseLock()}catch{}locked=false}return result;
    }finally{for(let i=0;i<secrets.length;i++)secrets[i]=''}
  }

  function runCaptured(file,args,opt={}){const r=cp.spawnSync(file,args,{encoding:opt.encoding===null?null:'utf8',timeout:opt.timeout||60000,maxBuffer:opt.maxBuffer||8*1024*1024,cwd:opt.cwd,uid:opt.uid,gid:opt.gid,env:opt.env||{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C'}});return{status:r.status,error:r.error,stdout:r.stdout||'',stderr:r.stderr||''}}
  function requireOk(result,label){if(result.error||result.status!==0)fail(label)}
  function gitShow(rel){const r=runCaptured('/usr/bin/git',['-C',SOURCE_REPOSITORY,'show',TARGET_COMMIT+':'+rel],{encoding:null,maxBuffer:16*1024*1024});requireOk(r,'git_show_failed');const bytes=Buffer.from(r.stdout);if(sha(bytes)!==BINDING.manifest[rel].target_sha256)fail('target_sha_mismatch:'+rel);return bytes}
  function acquireLock(){fs.mkdirSync(path.dirname(LOCK),{recursive:true,mode:0o700});const fd=fs.openSync(LOCK,'wx',0o600);fs.closeSync(fd)}
  function releaseLock(){try{fs.unlinkSync(LOCK)}catch{}}
  function verifyPreflight(){
    validateBinding(BINDING);
    const expected=path.join(RELEASES_ROOT,EXPECTED_RELEASE);if(fs.realpathSync(PRODUCTION_POINTER)!==expected)fail('unexpected_release');
    const rst=fs.lstatSync(expected);if(rst.isSymbolicLink()||!rst.isDirectory())fail('release_invalid');
    const repo=fs.lstatSync(SOURCE_REPOSITORY);if(repo.isSymbolicLink()||!repo.isDirectory())fail('source_repository_invalid');
    const commit=runCaptured('/usr/bin/git',['-C',SOURCE_REPOSITORY,'cat-file','-e',TARGET_COMMIT+'^{commit}']);requireOk(commit,'target_commit_missing');
    for(const [rel,item] of Object.entries(BINDING.manifest))assertPreimage(rel,item.preimage,path.join(expected,rel));
    const env=inspectFile(ENV_PATH);if(BINDING.env_preimage==='absent'){if(env.exists)fail('env_expected_absent')}else{if(!env.exists||env.isSymlink||!env.isFile||env.mode!==0o600||env.sha256!==BINDING.env_preimage)fail('env_preimage_mismatch')}
  }
  function readTargetBytes(){const out={};for(const rel of EXPECTED_PAYLOAD)out[rel]=gitShow(rel);return out}
  function backupEnv(){
    const observed=inspectFile(ENV_PATH);if(!observed.exists)return{existed:false,path:null};
    if(observed.isSymlink||!observed.isFile||observed.mode!==0o600||observed.sha256!==BINDING.env_preimage)fail('env_backup_precondition');
    fs.mkdirSync(BACKUP_ROOT,{recursive:true,mode:0o700});const backup=path.join(BACKUP_ROOT,'production.env.'+Date.now()+'.bak');fs.copyFileSync(ENV_PATH,backup,fs.constants.COPYFILE_EXCL);fs.chmodSync(backup,0o600);return{existed:true,path:backup,sha256:observed.sha256};
  }
  function createCandidate(targetBytes){
    const current=path.join(RELEASES_ROOT,EXPECTED_RELEASE);const candidate=path.join(RELEASES_ROOT,'security-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex'));
    const copy=runCaptured('/bin/cp',['-a','--reflink=auto',current,candidate],{timeout:300000,maxBuffer:1024*1024});requireOk(copy,'candidate_copy_failed');
    const cst=fs.lstatSync(candidate);if(cst.isSymbolicLink()||!cst.isDirectory())fail('candidate_invalid');
    for(const [rel,item] of Object.entries(BINDING.manifest)){
      const dst=path.join(candidate,rel);const existing=inspectFile(dst);const uid=existing.exists&&!existing.isSymlink?existing.uid:BINDING.runtime.uid;const gid=existing.exists&&!existing.isSymlink?existing.gid:BINDING.runtime.gid;
      atomicWrite(dst,targetBytes[rel],item.mode,uid,gid);if(sha(fs.readFileSync(dst))!==item.target_sha256)fail('candidate_target_sha_mismatch:'+rel);
    }
    return candidate;
  }
  function writeProtectedEnv(env){
    const dir=path.dirname(ENV_PATH);if(fs.existsSync(dir)){const st=fs.lstatSync(dir);if(st.isSymbolicLink()||!st.isDirectory())fail('env_dir_invalid')}else fs.mkdirSync(dir,{mode:0o700});
    atomicWrite(ENV_PATH,Buffer.from(renderProtectedEnv(env)),0o600,BINDING.runtime.uid,BINDING.runtime.gid);
  }
  function verifyEnvReadable(){
    const observed=inspectFile(ENV_PATH);if(!observed.exists||observed.isSymlink||!observed.isFile||observed.mode!==0o600||observed.uid!==BINDING.runtime.uid||observed.gid!==BINDING.runtime.gid)fail('env_runtime_metadata');
    const php="exit(is_readable("+JSON.stringify(ENV_PATH)+")?0:1);";const r=runCaptured('/usr/bin/php',['-r',php],{uid:BINDING.runtime.uid,gid:BINDING.runtime.gid});requireOk(r,'env_runtime_unreadable');
  }
  function verifyCandidate(candidate){
    for(const rel of EXPECTED_PAYLOAD){if(!(rel.endsWith('.php')||rel==='yii'||rel==='environments/prod/yii'))continue;const r=runCaptured('/usr/bin/php',['-l',path.join(candidate,rel)],{uid:BINDING.runtime.uid,gid:BINDING.runtime.gid});requireOk(r,'php_lint_failed')}
    let r=runCaptured('/usr/bin/php',['scripts/test-environment-loader.php'],{cwd:candidate,uid:BINDING.runtime.uid,gid:BINDING.runtime.gid,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/home/drtarjomeh',DRT_ENV_FILE:ENV_PATH}});requireOk(r,'env_loader_test_failed');
    for(const app of PROBE_APPS){r=runCaptured('/usr/bin/php',['scripts/probe-runtime-bootstrap.php',app],{cwd:candidate,uid:BINDING.runtime.uid,gid:BINDING.runtime.gid,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/home/drtarjomeh',DRT_ENV_FILE:ENV_PATH}});requireOk(r,'runtime_probe_failed')}
  }
  function smoke(){
    const r=runCaptured('/usr/bin/curl',['--silent','--show-error','--max-time','20','--write-out','\n__DRT_STATUS__:%{http_code}','https://drtarjomeh.ir/'],{timeout:30000,maxBuffer:4*1024*1024});requireOk(r,'smoke_transport_failed');const text=String(r.stdout||'');const marker=text.lastIndexOf('\n__DRT_STATUS__:');if(marker<0)fail('smoke_status_missing');const body=text.slice(0,marker);const status=Number(text.slice(marker+16).trim());return smokeContractOk(status,body);
  }
  function rollback(state){
    let performed=false;try{
      if(state.cutoverPerformed&&state.previousRelease){atomicCutover(PRODUCTION_POINTER,state.previousRelease);performed=true}
      if(state.envBackup?.existed){fs.copyFileSync(state.envBackup.path,ENV_PATH);fs.chmodSync(ENV_PATH,0o600);performed=true}else if(fs.existsSync(ENV_PATH)){const st=fs.lstatSync(ENV_PATH);if(st.isSymbolicLink())fail('rollback_env_symlink');fs.unlinkSync(ENV_PATH);performed=true}
      const pointerOk=!state.cutoverPerformed||fs.realpathSync(PRODUCTION_POINTER)===state.previousRelease;const smokeOk=smoke();return{performed,verified:pointerOk&&smokeOk,status:pointerOk&&smokeOk?'FAILED_ROLLED_BACK':'FAILED_ROLLBACK_INCOMPLETE'};
    }catch(_e){return{performed:true,verified:false,status:'FAILED_ROLLBACK_INCOMPLETE'}}
  }
  function persistResult(result){fs.mkdirSync(path.dirname(RESULT),{recursive:true,mode:0o700});atomicWrite(RESULT,Buffer.from(JSON.stringify(result,null,2)+'\n'),0o600,0,0);return result}
  function createLiveAdapter(){return{acquireLock,releaseLock,verifyPreflight,readTargetBytes,runCaptured,deriveSecrets:()=>deriveCurrentSecrets({runCaptured},path.join(RELEASES_ROOT,EXPECTED_RELEASE)),backupEnv,createCandidate,writeProtectedEnv,verifyEnvReadable,verifyCandidate,cutover:candidate=>atomicCutover(PRODUCTION_POINTER,candidate),smoke,rollback,persistResult}}

  validateBinding(BINDING);
  module.exports={BINDING,validateBinding,sanitizeText,buildProtectedEnv,renderProtectedEnv,secretExtractorPhp,deriveCurrentSecrets,executeWithAdapter,createLiveAdapter,smokeContractOk,atomicCutover,buildSuccessResult};
  if(require.main===module){const result=executeWithAdapter(createLiveAdapter());process.exitCode=result.ok?0:1}
}

function validateBuilderBinding(binding){
  if(!binding||binding.schema!=='prhm.drtarjomeh-security-release-binding.v1')throw new Error('binding_schema');
  if(binding.target_commit!=='f22b1d17801239f7539f84e5aa8b91250c87dc58')throw new Error('binding_target_commit');
  if(binding.expected_release!=='20260805-011747-672d32f490bd')throw new Error('binding_expected_release');
  const keys=Object.keys(binding.manifest||{}).sort();if(JSON.stringify(keys)!==JSON.stringify([...EXPECTED_PAYLOAD].sort()))throw new Error('binding_manifest_set');
  return true;
}
function buildHelperSource(binding){validateBuilderBinding(binding);return "#!/usr/local/bin/prhm-node\n'use strict';\n("+runtimeFactory.toString()+")("+JSON.stringify(binding)+");\n"}

module.exports={EXPECTED_PAYLOAD,buildHelperSource,validateBuilderBinding};
