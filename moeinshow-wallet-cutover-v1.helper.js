#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const PREFLIGHT_ACTION='moeinshow_wallet_cutover_preflight_v1';
const APPLY_ACTION='moeinshow_wallet_cutover_apply_v1';
const TARGET_SHA='b6e072a3c98e2228298c1e56f13dc303601cfa4c';
const MOEIN_ROOT='/home/moeinshow/domains/dashboard.moeinshow.com/public_html';
const MOEIN_BARE='/home/moeinshow/git/moeinshow-dashboard-moeinshow-com.git';
const CONFIG_API_ROOT='/srv/prhm-config-center/current/apps/api';
const CONFIG_BASE_URL='https://config.prhm.ir';
const APP_ENV_FILE=path.join(MOEIN_ROOT,'app/_env/prod.php');
const BOOTSTRAP_MARKER='PRHM_CONFIG_CENTER_BOOTSTRAP_V1';
const RESULT_DIR='/var/lib/prhm-agent-selfmaint-exec/moeinshow-wallet-cutover-v1';
const RESULT_FILE=path.join(RESULT_DIR,'latest.json');
const BACKUP_ROOT='/var/backups/prhm-moeinshow-wallet-cutover-v1';
const CREDENTIAL_NAME='moeinshow-wallet-config-v1';
const PUBLISH_ACTOR='host-action:moeinshow_wallet_cutover_apply_v1';

function fail(m){throw new Error(m)}
function shas(v){return crypto.createHash('sha256').update(v).digest('hex')}
function execFile(file,args,opts={}){
  const r=cp.spawnSync(file,args,{encoding:'utf8',timeout:opts.timeout||60000,maxBuffer:2*1024*1024,cwd:opts.cwd||undefined,env:opts.env||process.env});
  if(r.error)throw r.error;
  if(r.status!==0)fail('exec_failed:'+path.basename(file)+':'+String(r.stderr||'').trim().slice(0,300));
  return String(r.stdout||'');
}
function git(args,opts={}){return execFile('/usr/sbin/runuser',['-u','moeinshow','--','/usr/bin/git',...args],{cwd:MOEIN_ROOT,timeout:opts.timeout||60000})}
function php(code,env={}){return execFile('/usr/bin/php',['-r',code],{cwd:CONFIG_API_ROOT,timeout:60000,env:{...process.env,...env}})}
function regularOrMissing(file){if(!fs.existsSync(file))return null;const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(file)!==file)fail('unsafe_file:'+file);return st}
function safeDir(dir){const st=fs.lstatSync(dir);if(st.isSymbolicLink()||!st.isDirectory()||fs.realpathSync(dir)!==dir)fail('unsafe_directory:'+dir);return st}
function ensureOwnedDir(dir,mode,uid,gid){if(fs.existsSync(dir)){safeDir(dir);return false}fs.mkdirSync(dir,{recursive:false,mode});fs.chmodSync(dir,mode);fs.chownSync(dir,uid,gid);return true}
function atomicWrite(file,bytes,mode=0o640,uid,gid){const dir=path.dirname(file);if(!fs.existsSync(dir))fail('parent_directory_missing:'+dir);safeDir(dir);const tmp=file+'.tmp-'+process.pid+'-'+Date.now();let fd;try{fd=fs.openSync(tmp,'wx',mode);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.chmodSync(tmp,mode);if(Number.isInteger(uid)&&Number.isInteger(gid))fs.chownSync(tmp,uid,gid);fs.renameSync(tmp,file)}catch(e){try{if(fd!==undefined)fs.closeSync(fd)}catch{}try{fs.unlinkSync(tmp)}catch{}throw e}}
function stateHash(v){return shas(JSON.stringify(v??null))}
function bootstrapState(){const st=regularOrMissing(APP_ENV_FILE);if(!st)return{exists:false,safe:true,marker:false,sha256:null};const b=fs.readFileSync(APP_ENV_FILE);const text=b.toString('utf8');return{exists:true,safe:text.includes(BOOTSTRAP_MARKER),marker:text.includes(BOOTSTRAP_MARKER),sha256:shas(b)}}

function configProbe(){
  const code=String.raw`
require 'vendor/autoload.php';
$app=require 'bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$site=App\Models\Site::query()->where('slug','moeinshow')->first();
$wallet=App\Models\IntegrationCatalog::query()->where('key','payments.wallet')->first();
$saman=App\Models\IntegrationCatalog::query()->where('key','payments.saman')->first();
$mediana=App\Models\IntegrationCatalog::query()->where('key','sms.mediana')->first();
$get=function($catalog)use($site){if(!$site||!$catalog)return null;$i=App\Models\SiteIntegration::query()->where('site_id',$site->id)->where('integration_catalog_id',$catalog->id)->first();return $i?['id'=>$i->id,'enabled'=>(bool)$i->enabled,'public_config_json'=>$i->public_config_json]:null;};
$activeCred=$site?App\Models\MachineCredential::query()->where('site_id',$site->id)->where('name','moeinshow-wallet-config-v1')->whereNull('revoked_at')->count():0;
echo json_encode(['site_found'=>(bool)$site,'site_id'=>$site?->id,'site_revision'=>$site?->config_revision,'wallet_catalog_found'=>(bool)$wallet,'wallet_catalog_active'=>$wallet?(bool)$wallet->active:false,'wallet_catalog_id'=>$wallet?->id,'wallet'=>$get($wallet),'saman'=>$get($saman),'mediana'=>$get($mediana),'active_credential_count'=>$activeCred],JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES);
`;
  const out=php(code).trim();let j;try{j=JSON.parse(out)}catch{fail('config_probe_invalid_json')}return j;
}

function gitState(){
  if(!fs.existsSync(path.join(MOEIN_ROOT,'.git')))fail('moeinshow_git_missing');
  const head=git(['rev-parse','HEAD']).trim();
  const branch=git(['rev-parse','--abbrev-ref','HEAD']).trim();
  const worktree_clean=git(['status','--porcelain','--untracked-files=no']).trim()==='';
  const remote=git(['ls-remote','origin','refs/heads/main'],{timeout:90000}).trim().split(/\s+/)[0]||'';
  let target_local_present=true;try{git(['cat-file','-e',TARGET_SHA+'^{commit}'])}catch{target_local_present=false}
  return{head,branch,worktree_clean,remote_head:remote,remote_target_match:remote===TARGET_SHA,target_local_present};
}

function preflight(){
  const gs=gitState();const bs=bootstrapState();const cs=configProbe();
  const result={ok:false,schema_version:'prhm.host-action-result.v1',action:PREFLIGHT_ACTION,preflight_only:true,target_sha:TARGET_SHA,current_head:gs.head,branch:gs.branch,worktree_clean:gs.worktree_clean,remote_target_match:gs.remote_target_match,target_local_present:gs.target_local_present,site_found:cs.site_found===true,wallet_catalog_found:cs.wallet_catalog_found===true,wallet_catalog_active:cs.wallet_catalog_active===true,bootstrap_file_safe:bs.safe===true,bootstrap_file_exists:bs.exists===true,active_credential_count:Number(cs.active_credential_count||0),site_revision:Number(cs.site_revision||0),saman_state_hash:stateHash(cs.saman),mediana_state_hash:stateHash(cs.mediana),saman_untouched:true,mediana_untouched:true,production_application_mutation:false,database_mutation:false,token_read:false,token_redacted:true,rollback_performed:false};
  result.ok=result.branch==='main'&&result.worktree_clean&&result.remote_target_match&&result.site_found&&result.wallet_catalog_found&&result.wallet_catalog_active&&result.bootstrap_file_safe&&result.active_credential_count===0;
  if(!result.ok)result.blocker='preflight_gate_failed';
  return result;
}

function createBootstrap(token){
  const esc=s=>String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  return "<?php\n// "+BOOTSTRAP_MARKER+"\nreturn [\n    'SERVICE' => [\n        'configCenter' => [\n            'url' => '"+esc(CONFIG_BASE_URL)+"',\n            'token' => '"+esc(token)+"',\n            'timeoutMs' => 700,\n        ],\n    ],\n];\n";
}

function dbApply(expectedRevision,tokenHash){
  const code=String.raw`
require 'vendor/autoload.php';
$app=require 'bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$out=Illuminate\Support\Facades\DB::transaction(function(){
  $site=App\Models\Site::query()->where('slug','moeinshow')->lockForUpdate()->firstOrFail();
  $expected=(int)getenv('EXPECTED_REVISION'); if((int)$site->config_revision!==$expected) throw new RuntimeException('site_revision_changed');
  $wallet=App\Models\IntegrationCatalog::query()->where('key','payments.wallet')->where('active',true)->firstOrFail();
  $saman=App\Models\IntegrationCatalog::query()->where('key','payments.saman')->first();
  $mediana=App\Models\IntegrationCatalog::query()->where('key','sms.mediana')->first();
  $get=function($catalog)use($site){if(!$catalog)return null;$i=App\Models\SiteIntegration::query()->where('site_id',$site->id)->where('integration_catalog_id',$catalog->id)->first();return $i?['id'=>$i->id,'enabled'=>(bool)$i->enabled,'public_config_json'=>$i->public_config_json]:null;};
  $before=App\Models\SiteIntegration::query()->where('site_id',$site->id)->where('integration_catalog_id',$wallet->id)->first();
  $beforeWallet=$before?['exists'=>true,'id'=>$before->id,'enabled'=>(bool)$before->enabled,'public_config_json'=>$before->public_config_json]:['exists'=>false];
  $integration=$before?:new App\Models\SiteIntegration(['site_id'=>$site->id,'integration_catalog_id'=>$wallet->id]);
  $integration->enabled=true; if(!$integration->exists)$integration->public_config_json=null; $integration->save();
  if(App\Models\MachineCredential::query()->where('site_id',$site->id)->where('name','moeinshow-wallet-config-v1')->whereNull('revoked_at')->exists()) throw new RuntimeException('active_credential_exists');
  $cred=App\Models\MachineCredential::query()->create(['site_id'=>$site->id,'name'=>'moeinshow-wallet-config-v1','token_hash'=>getenv('TOKEN_HASH'),'scopes'=>['config:read']]);
  $publisher=$app->make(App\Services\ConfigPublisher::class);
  $revision=$publisher->publish($site->fresh(),'host-action:moeinshow_wallet_cutover_apply_v1');
  return ['site_id'=>$site->id,'previous_revision'=>$expected,'wallet_before'=>$beforeWallet,'wallet_integration_id'=>$integration->id,'credential_id'=>$cred->id,'revision_id'=>$revision->id,'revision'=>$revision->revision,'saman'=>$get($saman),'mediana'=>$get($mediana)];
},3);
echo json_encode($out,JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES);
`;
  const out=php(code,{EXPECTED_REVISION:String(expectedRevision),TOKEN_HASH:tokenHash}).trim();let j;try{j=JSON.parse(out)}catch{fail('db_apply_invalid_json')}return j;
}

function dbRollback(meta){
  const code=String.raw`
require 'vendor/autoload.php';
$app=require 'bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$meta=json_decode(base64_decode(getenv('ROLLBACK_META_B64')),true,512,JSON_THROW_ON_ERROR);
Illuminate\Support\Facades\DB::transaction(function()use($meta){
  $site=App\Models\Site::query()->whereKey($meta['site_id'])->lockForUpdate()->firstOrFail();
  if(!empty($meta['wallet_before']['exists'])){
    $i=App\Models\SiteIntegration::query()->whereKey($meta['wallet_integration_id'])->firstOrFail();
    $i->enabled=(bool)$meta['wallet_before']['enabled'];$i->public_config_json=$meta['wallet_before']['public_config_json']??null;$i->save();
  }else{App\Models\SiteIntegration::query()->whereKey($meta['wallet_integration_id'])->delete();}
  App\Models\MachineCredential::query()->whereKey($meta['credential_id'])->delete();
  App\Models\ConfigRevision::query()->whereKey($meta['revision_id'])->delete();
  App\Models\AuditLog::query()->where('site_id',$site->id)->where('action','config.published')->where('actor_id','host-action:moeinshow_wallet_cutover_apply_v1')->where('after_json->revision',(int)$meta['revision'])->delete();
  $site->forceFill(['config_revision'=>(int)$meta['previous_revision']])->save();
},3);
echo json_encode(['ok'=>true]);
`;
  const env={ROLLBACK_META_B64:Buffer.from(JSON.stringify(meta)).toString('base64')};php(code,env);
}

function smoke(expectedSamanHash,expectedMedianaHash){
  const code=String.raw`
define('RABINT_APP_DIR',getenv('MOEIN_ROOT').'/app');
define('RABINT_BASE_DIR',getenv('MOEIN_ROOT'));
$env=require RABINT_BASE_DIR.'/env.php';define('RABINT_ENV',$env);
require RABINT_BASE_DIR.'/common/_global_functions.php';
require RABINT_BASE_DIR.'/vendor/autoload.php';
require RABINT_BASE_DIR.'/vendor/yiisoft/yii2/Yii.php';
require RABINT_BASE_DIR.'/common/config/bootstrap.php';
$g=[['class'=>'\\app\\modules\\finance\\addons\\WalletGateway'],['class'=>'\\app\\modules\\finance\\addons\\SamanGateway']];
$r=common\services\configcenter\ConfigCenterRuntime::filterPaymentGateways($g);
$classes=array_values(array_map(fn($x)=>$x['class']??'', $r));
echo json_encode(['wallet_present'=>in_array('\\app\\modules\\finance\\addons\\WalletGateway',$classes,true),'saman_present'=>in_array('\\app\\modules\\finance\\addons\\SamanGateway',$classes,true),'count'=>count($classes)],JSON_THROW_ON_ERROR);
`;
  const runtimeOut=execFile('/usr/bin/php',['-r',code],{cwd:MOEIN_ROOT,timeout:30000,env:{...process.env,MOEIN_ROOT}}).trim();let runtime;try{runtime=JSON.parse(runtimeOut)}catch{fail('runtime_smoke_invalid_json')}
  const cs=configProbe();
  return{runtime_ok:runtime.wallet_present===true&&runtime.saman_present===true,saman_untouched:stateHash(cs.saman)===expectedSamanHash,mediana_untouched:stateHash(cs.mediana)===expectedMedianaHash,revision:cs.site_revision};
}

function apply(){
  const pf=preflight();if(!pf.ok)fail('preflight_not_green');
  fs.mkdirSync(BACKUP_ROOT,{recursive:true,mode:0o700});fs.mkdirSync(RESULT_DIR,{recursive:true,mode:0o700});
  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+process.pid;
  const backupDir=path.join(BACKUP_ROOT,stamp);fs.mkdirSync(backupDir,{mode:0o700});
  const preHead=pf.current_head;const bs=bootstrapState();const oldBootstrap=bs.exists?fs.readFileSync(APP_ENV_FILE):null;
  const appOwner=safeDir(path.join(MOEIN_ROOT,'app'));const bootstrapSt=regularOrMissing(APP_ENV_FILE);
  const bootstrapMode=bootstrapSt?(bootstrapSt.mode&0o777):0o640;const bootstrapUid=bootstrapSt?.uid??appOwner.uid;const bootstrapGid=bootstrapSt?.gid??appOwner.gid;
  const envDir=path.dirname(APP_ENV_FILE);const envDirCreated=ensureOwnedDir(envDir,0o750,appOwner.uid,appOwner.gid);
  if(oldBootstrap)fs.writeFileSync(path.join(backupDir,'app-env-prod.php.bak'),oldBootstrap,{mode:0o600,flag:'wx'});
  let dbMeta=null;let gitMutated=false;let bootstrapMutated=false;const rollbackErrors=[];
  const token='ccm_'+crypto.randomBytes(32).toString('hex');const tokenHash=shas(token);
  try{
    git(['fetch','--prune','origin','main'],{timeout:120000});
    const remote=git(['rev-parse','origin/main']).trim();if(remote!==TARGET_SHA)fail('remote_target_changed');
    git(['merge','--ff-only',TARGET_SHA],{timeout:120000});gitMutated=git(['rev-parse','HEAD']).trim()!==preHead;
    dbMeta=dbApply(pf.site_revision,tokenHash);
    atomicWrite(APP_ENV_FILE,createBootstrap(token),bootstrapMode,bootstrapUid,bootstrapGid);bootstrapMutated=true;
    const sm=smoke(pf.saman_state_hash,pf.mediana_state_hash);if(!sm.runtime_ok)fail('wallet_runtime_smoke_failed');if(!sm.saman_untouched)fail('saman_changed');if(!sm.mediana_untouched)fail('mediana_changed');
    return{ok:true,schema_version:'prhm.host-action-result.v1',action:APPLY_ACTION,target_sha:TARGET_SHA,deployed_head:git(['rev-parse','HEAD']).trim(),wallet_enabled:true,machine_credential_created:true,machine_credential_scopes:['config:read'],published_revision:dbMeta.revision,bootstrap_installed:true,token_redacted:true,saman_untouched:true,mediana_untouched:true,rollback_performed:false,production_application_mutation:true,database_mutation:true};
  }catch(error){
    if(bootstrapMutated){try{if(bs.exists)atomicWrite(APP_ENV_FILE,oldBootstrap,bootstrapMode,bootstrapUid,bootstrapGid);else fs.unlinkSync(APP_ENV_FILE);if(envDirCreated&&fs.existsSync(envDir)&&fs.readdirSync(envDir).length===0)fs.rmdirSync(envDir)}catch(e){rollbackErrors.push('bootstrap:'+e.message)}}
    if(dbMeta){try{dbRollback(dbMeta)}catch(e){rollbackErrors.push('db:'+e.message)}}
    if(gitMutated){try{git(['reset','--hard',preHead],{timeout:60000})}catch(e){rollbackErrors.push('git:'+e.message)}}
    if(rollbackErrors.length)fail('cutover_failed_rollback_failed:'+String(error&&error.message||error)+':'+rollbackErrors.join('|'));
    fail('cutover_failed_rolled_back:'+String(error&&error.message||error));
  }
}

function writeResult(result){fs.mkdirSync(RESULT_DIR,{recursive:true,mode:0o700});const tmp=RESULT_FILE+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,RESULT_FILE)}
function main(){const a=process.argv.slice(2);if(a.length!==1||!['--preflight','--apply'].includes(a[0]))fail('expected_phase');const r=a[0]==='--preflight'?preflight():apply();writeResult(r);process.stdout.write(JSON.stringify(r)+'\n')}
module.exports={PREFLIGHT_ACTION,APPLY_ACTION,TARGET_SHA,preflight,apply,bootstrapState,configProbe,gitState,createBootstrap,smoke};
if(require.main===module){try{main()}catch(e){console.error(String(e&&e.stack||e));process.exit(1)}}
