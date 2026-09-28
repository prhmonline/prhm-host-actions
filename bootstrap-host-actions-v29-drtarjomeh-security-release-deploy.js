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
const POLICY_VERSION='2026-09-28.1-drtarjomeh-security-release-v1';
const BASE_SHA='de924f7319f3656d788ba5d3f89ef2910bf4b0e3f0b8b074e7cd3a534441d5ea';
const EXEC_SHA='6bba46890db31abc8eca7e7681753a4788c46170033a555a1106e05d0a7a66f9';
const POLICY_SHA='2fedd70a182aa351e269df95a1b9d829f5a0b18defe8871cb4045106948d711a';
const MCP_SHA='b2f95b97dfa7e26ca717dfbec7871bf2f64286952548fb4d6d8e99908aeaacc0';
const ROLLBACK_REFERENCE='host-action-v2:drtarjomeh-security-release-deploy-v1:release-env-rollback';

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

const SMOKE=Object.freeze({host:'drtarjomeh.ir',path:'/',status_min:200,status_max:399,forbidden_body:'Internal Server Error'});
const SHA256=/^[a-f0-9]{64}$/;

function fail(message){throw new Error(message)}
function once(source,anchor,replacement,label){const n=source.split(anchor).length-1;if(n!==1)fail(label+'_anchor_count_'+n);return source.replace(anchor,replacement)}
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
  for(const rel of actual){assertSafeRelativePath(rel);const mode=payload[rel]?.mode;if(!Number.isInteger(mode)||![0o644,0o755].includes(mode))fail('payload_mode_invalid:'+rel)}
  return true;
}
function assertExpectedRelease(realpath){if(realpath!==EXPECTED_RELEASE_REALPATH)fail('unexpected_release');return true}
function assertPreimage(rel,expected,observed){
  assertSafeRelativePath(rel);
  if(expected==='absent'){if(observed?.exists!==false)fail('preimage_expected_absent:'+rel);return true}
  if(!SHA256.test(expected))fail('preimage_expected_sha_invalid:'+rel);
  if(!observed||observed.exists===false||observed.isSymlink===true||observed.isFile!==true)fail('preimage_not_regular:'+rel);
  if(!SHA256.test(String(observed.sha256||''))||observed.sha256!==expected)fail('preimage_sha_mismatch:'+rel);
  return true;
}
function freezeManifest(targetHashes,preimages){
  assertFixedPayload(PAYLOAD);const out={};
  for(const rel of Object.keys(PAYLOAD)){
    const target=targetHashes?.[rel];if(!SHA256.test(String(target||'')))fail('target_sha_invalid:'+rel);
    if(!Object.prototype.hasOwnProperty.call(preimages||{},rel))fail('preimage_missing:'+rel);
    const observed=preimages[rel];let preimage;
    if(observed==='absent')preimage='absent';else{if(!observed||observed.isSymlink===true||observed.isFile!==true||!SHA256.test(String(observed.sha256||'')))fail('preimage_invalid:'+rel);preimage=observed.sha256}
    out[rel]=Object.freeze({target_sha256:target,preimage,mode:PAYLOAD[rel].mode});
  }
  return Object.freeze(out);
}
function assertLiveBaseline(live){
  for(const [key,expected] of Object.entries({base:BASE_SHA,exec:EXEC_SHA,policy:POLICY_SHA,mcp:MCP_SHA})){
    if(live?.[key]!==expected)fail('baseline_sha_mismatch:'+key);
  }
  return true;
}
function buildPolicyCandidate(source){
  const p=JSON.parse(source);
  if(p.schema_version!=='prhm.approval-policy.v1'||p.version!=='2026-09-05.3-autonomous-operator-v1')fail('policy_baseline_mismatch');
  if(p.operations?.[OPERATION]||p.typed_scopes?.some(s=>s?.action===ACTION))fail('already_present');
  p.version=POLICY_VERSION;
  p.operations[OPERATION]={level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,requested_approver:'mohammad',expires_seconds:180,policy_version:POLICY_VERSION,rollback_reference:ROLLBACK_REFERENCE};
  p.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:ACTION,risk:'critical',operation:OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
  return JSON.stringify(p,null,2)+'\n';
}
function buildBaseCandidate(source){
  if(source.includes(ACTION))fail('already_present');
  const anchor="  agent_zdt_source_sha_refresh_publisher_v1: { operation: 'host_action.agent_zdt_source_sha_refresh_publisher_v1', rollback: 'host-action-v2:agent-zdt-source-sha-refresh-publisher-v1:action-backup-restore' }\n});";
  const replacement="  agent_zdt_source_sha_refresh_publisher_v1: { operation: 'host_action.agent_zdt_source_sha_refresh_publisher_v1', rollback: 'host-action-v2:agent-zdt-source-sha-refresh-publisher-v1:action-backup-restore' },\n  drtarjomeh_security_release_deploy_v1: { operation: 'host_action.drtarjomeh_security_release_deploy_v1', rollback: '"+ROLLBACK_REFERENCE+"' }\n});";
  return once(source,anchor,replacement,'base_registry');
}
function buildMcpCandidate(source){
  if(source.includes("'"+ACTION+"'"))fail('already_present');
  const anchor="'control_plane_root_scripts_stage_transport_v1']);";
  const replacement="'control_plane_root_scripts_stage_transport_v1','"+ACTION+"']);";
  return once(source,anchor,replacement,'mcp_enum');
}
function buildExecCandidate(source,helperSha){
  if(!SHA256.test(String(helperSha||'')))fail('helper_sha_invalid');
  if(source.includes(ACTION))fail('already_present');
  const specAnchor="control_plane_root_scripts_stage_transport_v1:{operation:'host_action.control_plane_root_scripts_stage_transport_v1',kind:'control_plane_root_scripts_stage_transport_v1'},";
  let out=once(source,specAnchor,specAnchor+ACTION+":{operation:'"+OPERATION+"',kind:'"+ACTION+"'},",'exec_spec');
  const wrapperAnchor='applyHostActionV2=async function(action){';
  const fn="const DRT_SECURITY_RELEASE_HELPER='/opt/prhm-agent-selfmaint-exec/actions/drtarjomeh-security-release-deploy-v1.js';\nconst DRT_SECURITY_RELEASE_RESULT='/var/lib/prhm-agent-selfmaint-exec/drtarjomeh-security-release-deploy-v1/latest.json';\nfunction applyDrTarjomehSecurityReleaseDeployV1(){const bytes=fs.readFileSync(DRT_SECURITY_RELEASE_HELPER);const helperSha=require('node:crypto').createHash('sha256').update(bytes).digest('hex');if(helperSha!=='"+helperSha+"')throw new Error('drtarjomeh_security_release_helper_sha_mismatch');try{if(fs.existsSync(DRT_SECURITY_RELEASE_RESULT))fs.unlinkSync(DRT_SECURITY_RELEASE_RESULT)}catch{}const unit='prhm-drtarjomeh-security-release-v1-'+Date.now();const args=['--wait','--collect','--quiet','--unit='+unit,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','--property=ReadWritePaths=/home/drtarjomeh/domains/drtarjomeh.ir/releases /etc/drtarjomeh /var/backups/prhm-drtarjomeh-security-release-deploy-v1 /var/lib/prhm-agent-selfmaint-exec /run','--setenv=HOME=/home/drtarjomeh','--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',DRT_SECURITY_RELEASE_HELPER];cp.execFileSync('/usr/bin/systemd-run',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:900000,maxBuffer:1024*1024});const result=JSON.parse(fs.readFileSync(DRT_SECURITY_RELEASE_RESULT,'utf8'));if(!result||result.ok!==true||result.schema!=='prhm.host-action-result.v1'||result.action!=='drtarjomeh_security_release_deploy_v1'||result.database_mutation!==false||result.provider_credential_rotation!==false||result.credential_values_returned!==false)throw new Error('drtarjomeh_security_release_result_invalid');return result}\n";
  out=once(out,wrapperAnchor,fn+wrapperAnchor+"if(action==='"+ACTION+"')return applyDrTarjomehSecurityReleaseDeployV1();",'exec_apply');
  return out;
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
  const PROBE_APPS=Object.freeze(['api','backend','frontend','panel','translator','console']);
  const SMOKE=Object.freeze({host:'drtarjomeh.ir',path:'/',status_min:200,status_max:399,forbidden_body:'Internal Server Error'});
  function fail(message){throw new Error(message)}
  function safeRel(rel){if(typeof rel!=='string'||!rel||path.isAbsolute(rel))fail('unsafe_payload_path');const parts=rel.split('/');if(parts.some(p=>p===''||p==='.'||p==='..')||path.posix.normalize(rel)!==rel)fail('unsafe_payload_path');return rel}
  function sanitizeText(input,secrets=[]){let out=String(input??'');for(const secret of secrets){const s=String(secret??'');if(s)out=out.split(s).join('[REDACTED]')}return out}
  function materializeCandidate(source,candidate,overlays,manifest){
    if(!path.isAbsolute(source)||!path.isAbsolute(candidate)||source===candidate)fail('candidate_path_invalid');const sourceStat=fs.lstatSync(source);if(sourceStat.isSymbolicLink()||!sourceStat.isDirectory())fail('source_release_invalid');if(fs.existsSync(candidate))fail('candidate_exists');fs.cpSync(source,candidate,{recursive:true,preserveTimestamps:true,dereference:false});
    try{for(const [rel,bytes] of Object.entries(overlays||{})){safeRel(rel);if(!Object.prototype.hasOwnProperty.call(manifest||{},rel))fail('overlay_manifest_missing:'+rel);const dst=path.join(candidate,rel);const resolvedParent=path.resolve(path.dirname(dst));const candidateResolved=path.resolve(candidate);if(resolvedParent!==candidateResolved&&!resolvedParent.startsWith(candidateResolved+path.sep))fail('overlay_escape:'+rel);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.writeFileSync(dst,bytes,{mode:manifest[rel].mode});fs.chmodSync(dst,manifest[rel].mode)}return candidate}catch(error){try{fs.rmSync(candidate,{recursive:true,force:true})}catch{}throw error}
  }
  function hexKey(rng){return Buffer.from(rng(32)).toString('hex')}
  function buildProtectedEnv(values,rng=crypto.randomBytes){
    const required=['dbDsn','dbUser','dbPass','db2Dsn','db2User','db2Pass','operationalEmail','senderEmail','senderName'];for(const key of required){if(values?.[key]===undefined||values[key]===null)fail('env_source_missing:'+key)}
    return Object.freeze({DRT_YII_ENV:'prod',DRT_YII_DEBUG:'0',DRT_DEBUG_IPS:'',DRT_LOG_TARGETS:'db,file',DRT_BASE_SCHEME:'https',DRT_BASE_HOST:BASE_HOST,DRT_APP_TOKEN:hexKey(rng),DRT_COOKIE_VALIDATION_KEY:hexKey(rng),DRT_API_COOKIE_VALIDATION_KEY:hexKey(rng),DRT_DB_DSN:String(values.dbDsn),DRT_DB_USER:String(values.dbUser),DRT_DB_PASS:String(values.dbPass),DRT_DB_PREFIX:'',DRT_DB2_DSN:String(values.db2Dsn),DRT_DB2_USER:String(values.db2User),DRT_DB2_PASS:String(values.db2Pass),DRT_DB2_PREFIX:'',DRT_OPERATIONAL_EMAIL:String(values.operationalEmail),DRT_SENDER_EMAIL:String(values.senderEmail),DRT_SENDER_NAME:String(values.senderName),DRT_MAIL_DRIVER:'file',DRT_MAIL_HOST:'',DRT_MAIL_PORT:'',DRT_MAIL_USERNAME:'',DRT_MAIL_PASSWORD:'',DRT_MAIL_ENCRYPTION:'tls',DRT_SMS_ENABLED:'0',DRT_SMS_FROM:'',DRT_SMS_KEY:'',DRT_SLACK_TOKEN:'',DRT_SLACK_CHANNEL_ID:'',DRT_SLACK_CHANNEL_ID_400:'',DRT_STORAGE_SCHEME:'https',DRT_STORAGE_HOST:'storage.drtarjomeh.ir',DRT_STORAGE_BASE_URL:'https://storage.drtarjomeh.ir'});
  }
  function renderProtectedEnv(env){const lines=[];for(const [key,valueRaw] of Object.entries(env||{})){if(!/^DRT_[A-Z0-9_]+$/.test(key))fail('env_key_invalid');const value=String(valueRaw??'');if(/[\r\n\0]/.test(value))fail('env_value_unsafe:'+key);lines.push(key+"='"+value+"'")}return lines.join('\n')+'\n'}
  function assertEnvState(observed,expectedPreimage,runtimeReadable){if(!observed||observed.exists!==true)fail('env_missing');if(observed.isSymlink===true)fail('env_symlink');if(observed.isFile!==true)fail('env_not_regular');if((observed.mode&0o777)!==0o600)fail('env_mode');if(expectedPreimage&&expectedPreimage!=='absent'&&observed.sha256!==expectedPreimage)fail('env_preimage');if(runtimeReadable!==true)fail('env_runtime_unreadable');return true}
  function buildVerificationPlan(candidateRoot,payload){if(!path.isAbsolute(candidateRoot))fail('candidate_root_invalid');const lintFiles=Object.keys(payload||{}).filter(rel=>rel.endsWith('.php')||rel==='yii'||rel==='environments/prod/yii').sort();for(const rel of lintFiles)safeRel(rel);return Object.freeze({lintFiles:Object.freeze(lintFiles),probeApps:PROBE_APPS,probeCommands:Object.freeze(PROBE_APPS.map(app=>Object.freeze({file:'/usr/bin/php',cwd:candidateRoot,args:Object.freeze(['scripts/probe-runtime-bootstrap.php',app])}))),networkAllowed:false,databaseWriteAllowed:false,notificationsAllowed:false})}
  function smokeContractOk(status,body){return Number.isInteger(status)&&status>=SMOKE.status_min&&status<=SMOKE.status_max&&!String(body??'').includes(SMOKE.forbidden_body)}
  function atomicCutover(pointer,candidateRelease){if(!path.isAbsolute(pointer)||!path.isAbsolute(candidateRelease))fail('cutover_path_invalid');const pointerStat=fs.lstatSync(pointer);if(!pointerStat.isSymbolicLink())fail('production_pointer_not_symlink');const candidateStat=fs.lstatSync(candidateRelease);if(candidateStat.isSymbolicLink()||!candidateStat.isDirectory())fail('candidate_release_invalid');const previous=fs.realpathSync(pointer);const temp=pointer+'.drt-cutover-'+process.pid+'-'+Date.now();try{fs.symlinkSync(candidateRelease,temp);fs.renameSync(temp,pointer)}catch(error){try{fs.unlinkSync(temp)}catch{}throw error}if(fs.realpathSync(pointer)!==candidateRelease)fail('cutover_verify_failed');return previous}
  function rollback(state,smokeVerifier){const result={performed:false,verified:false,status:'FAILED_ROLLBACK_INCOMPLETE'};try{if(state?.envPreviouslyExisted===true){if(!state.envPath||!state.envBackupPath)fail('rollback_env_backup_missing');fs.copyFileSync(state.envBackupPath,state.envPath);fs.chmodSync(state.envPath,0o600)}else if(state?.envPath&&fs.existsSync(state.envPath)){const st=fs.lstatSync(state.envPath);if(st.isSymbolicLink())fail('rollback_env_symlink');fs.rmSync(state.envPath,{force:true})}if(state?.cutoverPerformed===true){atomicCutover(state.pointer,state.previousRelease)}result.performed=true;const pointerOk=state?.cutoverPerformed!==true||fs.realpathSync(state.pointer)===state.previousRelease;const smokeOk=typeof smokeVerifier==='function'?smokeVerifier()===true:false;result.verified=pointerOk&&smokeOk;result.status=result.verified?'FAILED_ROLLED_BACK':'FAILED_ROLLBACK_INCOMPLETE';return result}catch(error){result.performed=true;result.error='rollback_failed';return result}}
  function buildSuccessResult(state){return Object.freeze({schema:'prhm.host-action-result.v1',ok:true,action:ACTION,target_commit:TARGET_COMMIT,previous_release:String(state?.previousRelease||''),new_release:String(state?.newRelease||''),preflight_passed:true,php_lint_passed:true,runtime_probe_passed:true,env_runtime_readability_passed:true,mail_fail_closed:true,sms_fail_closed:true,debug_disabled:true,cutover_performed:true,smoke_passed:true,database_mutation:false,provider_credential_rotation:false,credential_values_returned:false,rollback_performed:false})}
  module.exports={ACTION,TARGET_COMMIT,EXPECTED_RELEASE,sanitizeText,materializeCandidate,buildProtectedEnv,renderProtectedEnv,assertEnvState,buildVerificationPlan,smokeContractOk,atomicCutover,rollback,buildSuccessResult};
}

function buildHelperSource(){return "'use strict';\n("+helperModuleFactory.toString()+")();\n"}
function selftest(){assertFixedPayload(PAYLOAD);assertExpectedRelease(EXPECTED_RELEASE_REALPATH);const helper=buildHelperSource();if(!helper.includes(ACTION)||!helper.includes(TARGET_COMMIT))fail('helper_identity_missing');return {ok:true,action:ACTION,target_commit:TARGET_COMMIT,payload_count:Object.keys(PAYLOAD).length}}
if(require.main===module&&process.argv.includes('--selftest-only'))process.stdout.write(JSON.stringify(selftest())+'\n');

module.exports={ACTION,OPERATION,TARGET_COMMIT,EXPECTED_RELEASE,PRODUCTION_POINTER,RELEASES_ROOT,SOURCE_REPOSITORY,ENV_PATH,PAYLOAD,SMOKE,POLICY_VERSION,BASE_SHA,EXEC_SHA,POLICY_SHA,MCP_SHA,assertSafeRelativePath,assertFixedPayload,assertExpectedRelease,assertPreimage,freezeManifest,assertLiveBaseline,buildPolicyCandidate,buildBaseCandidate,buildMcpCandidate,buildExecCandidate,buildHelperSource,selftest};
