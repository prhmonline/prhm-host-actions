'use strict';
const crypto=require('node:crypto');
const ACTION='park_bazar_delivery_patch_v1';
const OPERATION='host_action.park_bazar_delivery_patch_v1';
const POLICY_VERSION='2026-09-08.1-park-bazar-delivery-v1';
const POLICY_SHA='494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70';
const EXEC_SHA='451c5a4762a4c7a04d64d526a79cf6e86b0cf7c978c559cf303d874e0f08fc48';
const MCP_SHA='7c566cdb1dbc1dcb4ac9d6a1b0670acc98cbc366a663771937e365d700671510';
const FIXED_FILES=Object.freeze([
  Object.freeze(['app/web/index.php','a66dfb4b4afa2affe8322e302718e0e9010edfd244b30153f88c44a923fa1a18']),
  Object.freeze(['app/yii','63dc92a76e44e9b71ccb28d8a57567d15206229b0fe6e39ebfa257b793bfc1c3']),
  Object.freeze(['app/modules/api/controllers/PublicController.php','7a1ca66ea128ef133b911bc0032a4ad39f8a5a8f2fb900fc60e304d1466bb0c1'])
]);
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function fail(m){throw new Error(m)}
function once(src,anchor,repl,label){const n=src.split(anchor).length-1;if(n!==1)fail(label+'_anchor_count_'+n);return src.replace(anchor,repl)}
function buildPolicyCandidate(source){
  const p=JSON.parse(source);if(p.operations?.[OPERATION]||p.typed_scopes?.some(s=>s?.action===ACTION))fail('already_present');
  if(p.schema_version!=='prhm.approval-policy.v1'||p.version!=='2026-09-05.3-autonomous-operator-v1')fail('policy_baseline_mismatch');
  p.version=POLICY_VERSION;
  p.operations[OPERATION]={level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,requested_approver:'mohammad',expires_seconds:180,policy_version:POLICY_VERSION,rollback_reference:'host-action-v2:park-bazar-delivery-patch-v1:file-and-git-rollback'};
  p.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:ACTION,risk:'critical',operation:OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
  return JSON.stringify(p,null,2)+'\n';
}
function buildMcpCandidate(source){
  if(source.includes("'park_bazar_delivery_patch_v1'"))fail('already_present');
  return once(source,"'control_plane_root_scripts_stage_transport_v1']","'control_plane_root_scripts_stage_transport_v1','park_bazar_delivery_patch_v1']",'mcp_enum');
}
function buildExecCandidate(source,helperSha){
  if(!/^[a-f0-9]{64}$/.test(helperSha))fail('helper_sha_invalid');
  if(source.includes("park_bazar_delivery_patch_v1"))fail('already_present');
  const specAnchor="control_plane_root_scripts_stage_transport_v1:{operation:'host_action.control_plane_root_scripts_stage_transport_v1',kind:'control_plane_root_scripts_stage_transport_v1'},";
  const specRepl=specAnchor+"park_bazar_delivery_patch_v1:{operation:'host_action.park_bazar_delivery_patch_v1',kind:'park_bazar_delivery_patch_v1'},";
  let out=once(source,specAnchor,specRepl,'exec_spec');
  const applyAnchor="if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();";
  const fn="function applyParkBazarDeliveryPatchV1(){const helper='/opt/prhm-agent-selfmaint-exec/actions/park-bazar-delivery-patch-v1.js';const bytes=fs.readFileSync(helper);const helperSha=require('node:crypto').createHash('sha256').update(bytes).digest('hex');if(helperSha!=='"+helperSha+"')throw new Error('park_delivery_helper_sha_mismatch');const m=require(helper);const r=m.apply();if(!r||r.ok!==true||r.action!=='park_bazar_delivery_patch_v1'||r.database_mutation!==false)throw new Error('park_delivery_result_invalid');return r;}\n";
  out=once(out,applyAnchor,fn+applyAnchor+"if(action==='park_bazar_delivery_patch_v1')return applyParkBazarDeliveryPatchV1();",'exec_apply');
  return out;
}
function buildHelperSource(){return String.raw`'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const ACTION='park_bazar_delivery_patch_v1';
const SOURCE='/home/cfpark/domains/dashboard.cfpark.ir/public_html';
const DEST='/home/cfpark/domains/dashboard.park.prhm.ir/public_html';
const PLACE_ID=1;
const EVENT_IDS=Object.freeze([190,193,244]);
const FIXED=Object.freeze({
 'app/web/index.php':'a66dfb4b4afa2affe8322e302718e0e9010edfd244b30153f88c44a923fa1a18',
 'app/yii':'63dc92a76e44e9b71ccb28d8a57567d15206229b0fe6e39ebfa257b793bfc1c3',
 'app/modules/api/controllers/PublicController.php':'7a1ca66ea128ef133b911bc0032a4ad39f8a5a8f2fb900fc60e304d1466bb0c1'});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(m){throw new Error(m)}
function replaceOnce(src,a,b,label){const n=src.split(a).length-1;if(n!==1)fail(label+'_anchor_count_'+n);return src.replace(a,b)}
function transformWeb(src){
 const debug="// if (isMy()){\n    defined('YII_DEBUG') or define('YII_DEBUG', true);\n// }else{\n//     defined('YII_DEBUG') or define('YII_DEBUG', false);\n// }\n\n// if (YII_DEBUG || isMy()) {\n    defined('USER_CAN_DEBUG') or define('USER_CAN_DEBUG', userCanDebug(config('debugersIp', '')));\n// } else {\n//     defined('USER_CAN_DEBUG') or define('USER_CAN_DEBUG', false);\n// }";
 const safe="defined('YII_DEBUG') or define('YII_DEBUG', false);\ndefined('YII_ENV') or define('YII_ENV', 'prod');\ndefined('USER_CAN_DEBUG') or define('USER_CAN_DEBUG', false);";
 let out=replaceOnce(src,debug,safe,'web_debug');
 out=replaceOnce(out,"} catch (\\Exception $e) {\n   var_dump($e->getMessage());\n}","} catch (\\Throwable $e) {\n    error_log('Application bootstrap failure: ' . $e->getMessage());\n    http_response_code(500);\n    echo 'Internal Server Error';\n}",'web_exception');
 return out;
}
function transformCli(src){return replaceOnce(src,"defined('YII_DEBUG') or define('YII_DEBUG', true);\ndefined('YII_ENV') or define('YII_ENV', 'dev');\ndefined('USER_CAN_DEBUG') or define('USER_CAN_DEBUG', true);","defined('YII_DEBUG') or define('YII_DEBUG', false);\ndefined('YII_ENV') or define('YII_ENV', 'prod');\ndefined('USER_CAN_DEBUG') or define('USER_CAN_DEBUG', false);",'cli_debug')}
function transformSlider(src){
 const old='    public function actionSlider()\n    {\n        $slider = Option::get("slider");\n        foreach ($slider as &$item){\n            $item["image"] = Attachment::getUrlById($item["image"]);\n            $item["image_mobile"] = Attachment::getUrlById($item["image_mobile"]);\n        }\n        return $slider;\n    }';
 const next='    public function actionSlider()\n    {\n        $slider = (array) Option::get("slider");\n        $result = [];\n        $localPath = static function ($url) {\n            if (!$url) return $url;\n            $parts = parse_url($url);\n            if (!is_array($parts) || ($parts["host"] ?? "") !== "cfpark.ir") return $url;\n            $out = $parts["path"] ?? "/";\n            if (isset($parts["query"])) $out .= "?" . $parts["query"];\n            if (isset($parts["fragment"])) $out .= "#" . $parts["fragment"];\n            return $out;\n        };\n        foreach ($slider as $item) {\n            $imageId = $item["image"] ?? null;\n            $mobileId = $item["image_mobile"] ?? null;\n            if (!$imageId && !$mobileId) continue;\n            $item["image"] = $imageId ? Attachment::getUrlById($imageId) : "";\n            $item["image_mobile"] = $mobileId ? Attachment::getUrlById($mobileId) : "";\n            if (!$item["image"] && !$item["image_mobile"]) continue;\n            $item["image"] = $localPath($item["image"]);\n            $item["image_mobile"] = $localPath($item["image_mobile"]);\n            if (isset($item["url"])) $item["url"] = $localPath($item["url"]);\n            $result[] = $item;\n        }\n        return $result;\n    }';
 return replaceOnce(src,old,next,'slider');
}
function apply(){
 if(process.getuid&&process.getuid()!==0)fail('root_required');
 const transforms={'app/web/index.php':transformWeb,'app/yii':transformCli,'app/modules/api/controllers/PublicController.php':transformSlider};
 const backups=[];let rollback_performed=false;
 try{
   for(const [rel,expected] of Object.entries(FIXED)){
     const dst=path.join(DEST,rel),st=fs.lstatSync(dst);if(st.isSymbolicLink()||!st.isFile())fail('target_not_regular:'+rel);const before=fs.readFileSync(dst);if(sha(before)!==expected)fail('preimage_sha_mismatch:'+rel);
     const next=Buffer.from(transforms[rel](before.toString('utf8')),'utf8');
     const bak=dst+'.park-bazar-delivery.bak';fs.writeFileSync(bak,before,{mode:st.mode&0o777});backups.push([dst,bak,st]);
     const tmp=dst+'.park-bazar-delivery.tmp';fs.writeFileSync(tmp,next,{mode:st.mode&0o777});fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,dst);
   }
   for(const rel of Object.keys(FIXED)){const f=path.join(DEST,rel);const r=cp.spawnSync('/usr/bin/php',['-l',f],{encoding:'utf8',timeout:10000});if(r.error||r.status!==0)fail('php_lint_failed:'+rel)}
   return {ok:true,schema_version:'prhm.host-action-result.v1',action:ACTION,place_id:PLACE_ID,event_ids:EVENT_IDS,database_mutation:false,production_mutation:true,rollback_performed:false};
 }catch(e){rollback_performed=true;for(const [dst,bak,st] of backups.reverse()){try{const b=fs.readFileSync(bak);const tmp=dst+'.park-bazar-rollback.tmp';fs.writeFileSync(tmp,b,{mode:st.mode&0o777});fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,dst)}catch{}}throw new Error('park_delivery_failed_rolled_back:'+String(e.message||e))}
}
module.exports={ACTION,SOURCE,DEST,PLACE_ID,EVENT_IDS,FIXED,transformWeb,transformCli,transformSlider,apply};
`;}
module.exports={ACTION,OPERATION,POLICY_VERSION,POLICY_SHA,EXEC_SHA,MCP_SHA,FIXED_FILES,buildPolicyCandidate,buildMcpCandidate,buildExecCandidate,buildHelperSource,sha};
