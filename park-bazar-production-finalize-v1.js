#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const ACTION='park_bazar_production_finalize_v1';
const ADMIN='/home/cfpark/domains/dashboard.park.prhm.ir/public_html/app';
const WEB='/home/cfpark/domains/dashboard.park.prhm.ir/public_html/app/web/index.php';
const YII='/home/cfpark/domains/dashboard.park.prhm.ir/public_html/app/yii';
const DB='cfpark_park_bazar';
const OPTION_TABLE='system_option';
const OPTION_KEY='slider';
const EVENT_IDS=[190,193,244];
const PLACE_COLUMN='place_id';
const EXPECTED={
  [WEB]:'a66dfb4b4afa2affe8322e302718e0e9010edfd244b30153f88c44a923fa1a18',
  [YII]:'63dc92a76e44e9b71ccb28d8a57567d15206229b0fe6e39ebfa257b793bfc1c3'
};
const STATE='/var/lib/prhm-park-bazar-production-finalize';
const RESULT=STATE+'/result.json';
const BACKUP_ROOT='/var/backups/prhm-park-bazar-production-finalize-v1';
function sha(v){return crypto.createHash('sha256').update(v).digest('hex')}
function fail(m){throw new Error(m)}
function regular(p){try{return fs.statSync(p).isFile()&&!fs.lstatSync(p).isSymbolicLink()&&fs.realpathSync(p)===p}catch{return false}}
function atomicWrite(p,b,mode){const t=p+'.tmp-'+process.pid+'-'+Date.now();fs.writeFileSync(t,b,{mode});fs.renameSync(t,p);fs.chmodSync(p,mode)}
function replaceOne(s,re,to,label){const m=s.match(re);if(!m||m.length<1)fail(label+'_missing');const all=[...s.matchAll(new RegExp(re.source,re.flags.includes('g')?re.flags:re.flags+'g'))];if(all.length!==1)fail(label+'_count_'+all.length);return s.replace(re,to)}
function hardenWebSource(source){
  let s=source;
  s=replaceOne(s,/^[ \t]*defined\('YII_DEBUG'\) or define\('YII_DEBUG', true\);[ \t]*$/m,"defined('YII_DEBUG') or define('YII_DEBUG', false);",'web_debug');
  if(!/^defined\('YII_ENV'\) or define\('YII_ENV', 'prod'\);$/m.test(s)) s=s.replace("defined('YII_DEBUG') or define('YII_DEBUG', false);","defined('YII_DEBUG') or define('YII_DEBUG', false);\ndefined('YII_ENV') or define('YII_ENV', 'prod');");
  s=replaceOne(s,/^[ \t]*defined\('USER_CAN_DEBUG'\) or define\('USER_CAN_DEBUG', userCanDebug\(config\('debugersIp', ''\)\)\);[ \t]*$/m,"defined('USER_CAN_DEBUG') or define('USER_CAN_DEBUG', false);",'web_user_debug');
  s=s.replace(/if \(USER_CAN_DEBUG\) \{[\s\S]*?\} else \{[\s\S]*?\}/m,"ini_set('display_errors', false);\nerror_reporting(0);");
  s=s.replace(/try\s*\{\s*\(new yii\\web\\Application\(\$config\)\)->run\(\);\s*\}\s*catch\s*\(\\Exception \$e\)\s*\{[\s\S]*?\}/m,"(new yii\\web\\Application($config))->run();");
  if(/var_dump\s*\(/.test(s)) fail('web_raw_dump_remains');
  return s;
}
function hardenYiiSource(source){
  let s=source;
  s=replaceOne(s,/^[ \t]*defined\('YII_DEBUG'\) or define\('YII_DEBUG', true\);[ \t]*$/m,"defined('YII_DEBUG') or define('YII_DEBUG', false);",'yii_debug');
  s=replaceOne(s,/^[ \t]*defined\('YII_ENV'\) or define\('YII_ENV', 'dev'\);[ \t]*$/m,"defined('YII_ENV') or define('YII_ENV', 'prod');",'yii_env');
  s=replaceOne(s,/^[ \t]*defined\('USER_CAN_DEBUG'\) or define\('USER_CAN_DEBUG', true\);[ \t]*$/m,"defined('USER_CAN_DEBUG') or define('USER_CAN_DEBUG', false);",'yii_user_debug');
  s=s.replace(/if \(USER_CAN_DEBUG\) \{[\s\S]*?\} else \{[\s\S]*?\}/m,"ini_set('display_errors', false);\nerror_reporting(0);");
  return s;
}
const PHP=String.raw`<?php
$admin='/home/cfpark/domains/dashboard.park.prhm.ir/public_html/app';
define('RABINT_APP_DIR',$admin); define('RABINT_BASE_DIR',dirname($admin));
$env=require RABINT_BASE_DIR.'/env.php'; define('RABINT_ENV',$env);
require RABINT_BASE_DIR.'/common/_global_functions.php';
define('YII_DEBUG',false); define('YII_ENV','prod'); define('USER_CAN_DEBUG',false);
require RABINT_BASE_DIR.'/vendor/autoload.php'; require RABINT_BASE_DIR.'/vendor/yiisoft/yii2/Yii.php';
require RABINT_BASE_DIR.'/common/config/bootstrap.php'; require RABINT_APP_DIR.'/config/bootstrap.php';
$config=require RABINT_APP_DIR.'/config/console.php'; $cls='yii\\console\\Application'; new $cls($config); $db=Yii::$app->db; $db->open();
if((string)$db->createCommand('SELECT DATABASE()')->queryScalar()!=='cfpark_park_bazar') throw new RuntimeException('db_identity_mismatch');
function qn($n){if(!preg_match('/^[A-Za-z0-9_]+$/',$n)) throw new RuntimeException('identifier_invalid'); return chr(96).$n.chr(96);}
function sliderRows($db){
 $pk=$db->createCommand("SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='system_option' AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION")->queryColumn();
 if(count($pk)!==1) throw new RuntimeException('slider_pk_not_single'); $pk=$pk[0];
 $rows=$db->createCommand('SELECT '.qn($pk).' AS pk, '.qn('data').' FROM '.qn('system_option').' WHERE '.qn('key').'=:k',[':k'=>'slider'])->queryAll();
 if(!$rows) throw new RuntimeException('slider_row_missing'); return [$pk,$rows];
}
function transform(&$v,&$count){if(!is_array($v))return; foreach($v as $k=>&$x){if($k==='url'&&is_string($x)){ $p=parse_url($x); if(is_array($p)&&(($p['host']??'')==='cfpark.ir')){$x=str_replace('://cfpark.ir','://park.prhm.ir',$x,$c);$count+=$c;}} elseif(is_array($x)) transform($x,$count);}}
function eventEvidence($db){
 $tables=$db->createCommand("SELECT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME IN ('id','place_id') GROUP BY TABLE_NAME HAVING COUNT(DISTINCT COLUMN_NAME)=2 ORDER BY TABLE_NAME")->queryColumn();
 $hits=[]; foreach($tables as $t){$qs='SELECT COUNT(*) FROM '.qn($t).' WHERE '.qn('place_id').'=:p AND '.qn('id').' IN (190,193,244)'; try{$n=(int)$db->createCommand($qs,[':p'=>1])->queryScalar(); if($n===3)$hits[]=$t;}catch(Throwable $e){}}
 if(count($hits)!==1) throw new RuntimeException('event_scope_not_unique_'.count($hits)); return ['table'=>$hits[0],'place_id'=>1,'event_ids'=>[190,193,244]];
}
$mode=$argv[1]??''; $backup=$argv[2]??''; [$pk,$rows]=sliderRows($db); $events=eventEvidence($db);
if($mode==='snapshot'){$out=['db'=>'cfpark_park_bazar','pk'=>$pk,'rows'=>$rows,'events'=>$events]; file_put_contents($backup,json_encode($out,JSON_UNESCAPED_SLASHES)); echo json_encode(['ok'=>true,'rows'=>count($rows),'events'=>$events]); exit;}
if(!is_file($backup)) throw new RuntimeException('backup_missing'); $snap=json_decode(file_get_contents($backup),true,512,JSON_THROW_ON_ERROR); if(($snap['db']??'')!=='cfpark_park_bazar'||($snap['pk']??'')!==$pk) throw new RuntimeException('backup_identity_mismatch');
if($mode==='apply'){$tx=$db->beginTransaction();$changed=0;try{foreach($rows as $r){$j=json_decode($r['data'],true,512,JSON_THROW_ON_ERROR);$c=0;transform($j,$c);if($c){$new=json_encode($j,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);$n=$db->createCommand()->update('system_option',['data'=>$new],[$pk=>(string)$r['pk'],'data'=>$r['data']])->execute();if($n!==1)throw new RuntimeException('slider_concurrent_change');$changed+=$c;}}$tx->commit();echo json_encode(['ok'=>true,'url_changes'=>$changed,'events'=>$events]);}catch(Throwable $e){if($tx->isActive)$tx->rollBack();throw $e;}exit;}
if($mode==='restore'){$tx=$db->beginTransaction();try{foreach($snap['rows'] as $r){$db->createCommand()->update('system_option',['data'=>$r['data']],[$pk=>(string)$r['pk']])->execute();}$tx->commit();echo json_encode(['ok'=>true,'restored'=>true]);}catch(Throwable $e){if($tx->isActive)$tx->rollBack();throw $e;}exit;}
if($mode==='verify'){[$pk2,$now]=sliderRows($db);$bad=0;foreach($now as $r){$j=json_decode($r['data'],true,512,JSON_THROW_ON_ERROR);$walk=function($v)use(&$walk,&$bad){if(!is_array($v))return;foreach($v as $k=>$x){if($k==='url'&&is_string($x)){if((parse_url($x,PHP_URL_HOST)??'')==='cfpark.ir')$bad++;}elseif(is_array($x))$walk($x);}};$walk($j);}if($bad)throw new RuntimeException('slider_old_host_remains');echo json_encode(['ok'=>true,'old_host_urls'=>0,'events'=>$events]);exit;}
throw new RuntimeException('mode_invalid');`;
function runPhp(script,mode,backup){const r=cp.spawnSync('/usr/bin/php',[script,mode,backup],{encoding:'utf8',timeout:120000,env:{PATH:'/usr/bin:/bin'}});if(r.status!==0)fail('php_'+mode+'_failed:'+(r.stderr||r.stdout||'').trim());return JSON.parse(r.stdout)}
function lint(p){const r=cp.spawnSync('/usr/bin/php',['-l',p],{encoding:'utf8',timeout:30000});if(r.status!==0)fail('php_lint_failed:'+p)}
function execute(){
 fs.mkdirSync(STATE,{recursive:true,mode:0o700}); fs.mkdirSync(BACKUP_ROOT,{recursive:true,mode:0o700});
 for(const p of [WEB,YII]){if(!regular(p))fail('target_invalid:'+p);if(sha(fs.readFileSync(p))!==EXPECTED[p])fail('baseline_sha_mismatch:'+p)}
 const stamp=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14); const bdir=BACKUP_ROOT+'/'+stamp+'-'+process.pid;fs.mkdirSync(bdir,{mode:0o700});
 const wb=fs.readFileSync(WEB),yb=fs.readFileSync(YII);fs.writeFileSync(bdir+'/web.index.php',wb,{mode:0o600});fs.writeFileSync(bdir+'/yii',yb,{mode:0o600});
 const wmode=fs.statSync(WEB).mode&0o777, ymode=fs.statSync(YII).mode&0o777; const script='/run/prhm-park-bazar-production-finalize-'+process.pid+'.php'; const dbbackup=bdir+'/slider.json'; let dbSnap=false,filesChanged=false;
 try{
  fs.writeFileSync(script,PHP,{mode:0o600});runPhp(script,'snapshot',dbbackup);dbSnap=true;
  const nw=Buffer.from(hardenWebSource(wb.toString('utf8'))),ny=Buffer.from(hardenYiiSource(yb.toString('utf8')));atomicWrite(WEB,nw,wmode);atomicWrite(YII,ny,ymode);filesChanged=true;lint(WEB);lint(YII);
  const applied=runPhp(script,'apply',dbbackup);const verified=runPhp(script,'verify',dbbackup);
  const checkW=fs.readFileSync(WEB,'utf8'),checkY=fs.readFileSync(YII,'utf8');if(!checkW.includes("define('YII_DEBUG', false)")||!checkW.includes("define('YII_ENV', 'prod')")||/var_dump\s*\(/.test(checkW))fail('web_verify_failed');if(!checkY.includes("define('YII_DEBUG', false)")||!checkY.includes("define('YII_ENV', 'prod')")||!checkY.includes("define('USER_CAN_DEBUG', false)"))fail('yii_verify_failed');
  const result={ok:true,schema_version:'prhm.host-action-result.v1',action:ACTION,files:[{path:WEB,sha256:sha(fs.readFileSync(WEB))},{path:YII,sha256:sha(fs.readFileSync(YII))}],slider:{url_changes:applied.url_changes,old_host_urls:verified.old_host_urls},events:verified.events,production_application_tree_mutation:true,database_mutation:applied.url_changes>0,destructive_migration:false,backup_dir:bdir,rollback:{performed:false}};fs.writeFileSync(RESULT,JSON.stringify(result)+'\n',{mode:0o600});return result;
 }catch(e){let dbRestored=false,fileRestored=false;try{if(dbSnap)runPhp(script,'restore',dbbackup),dbRestored=true}catch{}try{if(filesChanged){atomicWrite(WEB,wb,wmode);atomicWrite(YII,yb,ymode);fileRestored=true}}catch{};e.rollback={performed:true,database_restored:dbRestored,files_restored:fileRestored};throw e}finally{try{fs.unlinkSync(script)}catch{}}
}
if(require.main===module){try{process.stdout.write(JSON.stringify(execute())+'\n')}catch(e){process.stderr.write(JSON.stringify({error:String(e.message||e),rollback:e.rollback||null})+'\n');process.exitCode=1}}
module.exports={execute,hardenWebSource,hardenYiiSource,PHP};
