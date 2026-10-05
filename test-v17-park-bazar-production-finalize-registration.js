const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const mod=require('./bootstrap-host-actions-v17-park-bazar-production-finalize-v1.js');
const ACTION='park_bazar_production_finalize_v1';

test('registration patches exactly the four control-plane surfaces',()=>{
  const base="const HOST_ACTION_V2={\n  honartik_iticket_dark_backend_batch2_v1: { operation: 'host_action.honartik_iticket_dark_backend_batch2_v1', rollback: 'host-action-v2:honartik-iticket-dark-backend-batch2-v1:worktree-file-rollback' },\n};\n";
  const executor="const HOST_ACTION_V2_SPECS={\n  honartik_iticket_dark_backend_batch2_v1:{operation:'host_action.honartik_iticket_dark_backend_batch2_v1',kind:'honartik_iticket_dark_backend_batch2_v1'},\n};\n"+
    "const HONARTIK_ITICKET_BATCH2_HELPER='/opt/prhm-agent-selfmaint-exec/actions/honartik-iticket-dark-backend-batch2-v1.js';\n"+
    "const applyHostActionV2Original=applyHostActionV2;\napplyHostActionV2=async function(action){if(action==='honartik_iticket_dark_backend_batch2_v1')return applyHonartikIticketDarkBackendBatch2V1();return applyHostActionV2Original(action);};\n";
  const mcp="const HostActionV2=z.enum(['agent_zero_downtime_bootstrap_v1','honartik_iticket_dark_backend_batch2_v1','host_action_v2_installer_v1']);\n";
  const policy=JSON.stringify({version:'old',operations:{'host_action.honartik_iticket_dark_backend_batch2_v1':{level:4}},typed_scopes:[{tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:'honartik_iticket_dark_backend_batch2_v1',risk:'critical',operation:'host_action.honartik_iticket_dark_backend_batch2_v1',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]},null,2)+'\n';
  const out=mod.buildPatchedFrom({base,executor,mcp,policy});
  for(const key of ['base','executor','mcp','policy']) assert.match(out[key],new RegExp(ACTION));
  assert.match(out.executor,/applyParkBazarProductionFinalizeV1/);
  assert.match(out.executor,/ProtectSystem=strict/);
  assert.match(out.executor,/ProtectHome=read-only/);
  assert.match(out.executor,/ReadWritePaths=\/home\/cfpark\/domains\/dashboard\.park\.prhm\.ir\/public_html\/app \/var\/lib\/prhm-park-bazar-production-finalize \/var\/backups\/prhm-park-bazar-production-finalize-v1 \/run/);
  const p=JSON.parse(out.policy);
  assert.equal(p.operations['host_action.'+ACTION].level,4);
  assert.equal(p.typed_scopes.filter(x=>x.action===ACTION).length,1);
});

test('embedded helper is SHA-bound, fixed-scope, rollback-capable, and excludes unsafe migration primitives',()=>{
  assert.equal(mod.verifyEmbeddedHelper(),true);
  const helper=Buffer.from(mod.HELPER_B64,'base64').toString('utf8');
  for(const needle of [
    '/home/cfpark/domains/dashboard.park.prhm.ir/public_html/app/web/index.php',
    '/home/cfpark/domains/dashboard.park.prhm.ir/public_html/app/yii',
    'cfpark_park_bazar','system_option','slider','place_id','190','193','244',
    '/var/backups/prhm-park-bazar-production-finalize-v1','rollback'
  ]) assert.match(helper,new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  for(const forbidden of ['DROP DATABASE','CREATE DATABASE','sshpass','assets/js/app.js','/home/cfpark/domains/cfpark.ir/public_html']) assert.equal(helper.includes(forbidden),false,forbidden);
});

test('file hardening renderer produces production-safe PHP entrypoints',()=>{
  const web=`<?php\ndefined('YII_DEBUG') or define('YII_DEBUG', true);\ndefined('USER_CAN_DEBUG') or define('USER_CAN_DEBUG', userCanDebug(config('debugersIp', '')));\nif (USER_CAN_DEBUG) { error_reporting(E_ALL); ini_set('display_errors', true); } else { ini_set('display_errors', false); error_reporting(0); }\ntry { (new yii\\web\\Application($config))->run(); } catch (\\Exception $e) { var_dump($e->getMessage()); }\n`;
  const yii=`#!/usr/bin/env php\n<?php\ndefined('YII_DEBUG') or define('YII_DEBUG', true);\ndefined('YII_ENV') or define('YII_ENV', 'dev');\ndefined('USER_CAN_DEBUG') or define('USER_CAN_DEBUG', true);\nif (USER_CAN_DEBUG) { error_reporting(E_ALL); ini_set('display_errors', true); } else { ini_set('display_errors', false); error_reporting(0); }\n`;
  const w=mod.hardenWebSource(web), y=mod.hardenYiiSource(yii);
  assert.match(w,/define\('YII_DEBUG', false\)/);
  assert.match(w,/define\('YII_ENV', 'prod'\)/);
  assert.match(w,/define\('USER_CAN_DEBUG', false\)/);
  assert.doesNotMatch(w,/var_dump\(/);
  assert.match(y,/define\('YII_DEBUG', false\)/);
  assert.match(y,/define\('YII_ENV', 'prod'\)/);
  assert.match(y,/define\('USER_CAN_DEBUG', false\)/);
});
