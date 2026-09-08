'use strict';
const crypto=require('node:crypto');
const ACTION='park_bazar_delivery_patch_v1';
const OPERATION='host_action.park_bazar_delivery_patch_v1';
const POLICY_VERSION='2026-09-08.1-park-bazar-delivery-v1';
const POLICY_SHA='494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70';
const EXEC_SHA='451c5a4762a4c7a04d64d526a79cf6e86b0cf7c978c559cf303d874e0f08fc48';
const MCP_SHA='7c566cdb1dbc1dcb4ac9d6a1b0670acc98cbc366a663771937e365d700671510';
const BASE_SHA='a23b4fec52123f8ad484f31576281c2f1933f24a3c811cd98c28e764a292e315';
const PATHS=Object.freeze({base:'/opt/prhm-agent-selfmaint/server.js',exec:'/opt/prhm-agent-selfmaint-exec/server.js',policy:'/opt/prhm-company-control-plane/config/approval-policy.json',mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',helper:'/opt/prhm-agent-selfmaint-exec/actions/park-bazar-delivery-patch-v1.js'});
const INSTALL_BACKUP_ROOT='/var/backups/prhm-park-bazar-delivery-v27-installer';
const INSTALL_RESULT='/var/lib/prhm-agent-selfmaint-exec/park-bazar-delivery-v27-installer/latest.json';
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
function buildBaseCandidate(source){
  if(source.includes('park_bazar_delivery_patch_v1'))fail('already_present');
  const anchor="  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' }\n});";
  const repl="  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' },\n  park_bazar_delivery_patch_v1: { operation: 'host_action.park_bazar_delivery_patch_v1', rollback: 'host-action-v2:park-bazar-delivery-patch-v1:file-and-git-rollback' }\n});";
  return once(source,anchor,repl,'base_spec');
}
function buildExecCandidate(source,helperSha){
  if(!/^[a-f0-9]{64}$/.test(helperSha))fail('helper_sha_invalid');
  if(source.includes("park_bazar_delivery_patch_v1"))fail('already_present');
  const specAnchor="control_plane_root_scripts_stage_transport_v1:{operation:'host_action.control_plane_root_scripts_stage_transport_v1',kind:'control_plane_root_scripts_stage_transport_v1'},";
  const specRepl=specAnchor+"park_bazar_delivery_patch_v1:{operation:'host_action.park_bazar_delivery_patch_v1',kind:'park_bazar_delivery_patch_v1'},";
  let out=once(source,specAnchor,specRepl,'exec_spec');
  const applyAnchor="if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();";
  const fn="const PARK_BAZAR_DELIVERY_HELPER='/opt/prhm-agent-selfmaint-exec/actions/park-bazar-delivery-patch-v1.js';\nconst PARK_BAZAR_DELIVERY_RESULT='/var/lib/prhm-agent-selfmaint-exec/park-bazar-delivery-patch-v1/latest.json';\nfunction applyParkBazarDeliveryPatchV1(){const bytes=fs.readFileSync(PARK_BAZAR_DELIVERY_HELPER);const helperSha=require('node:crypto').createHash('sha256').update(bytes).digest('hex');if(helperSha!=='"+helperSha+"')throw new Error('park_delivery_helper_sha_mismatch');try{if(fs.existsSync(PARK_BAZAR_DELIVERY_RESULT))fs.unlinkSync(PARK_BAZAR_DELIVERY_RESULT)}catch{}const u='prhm-park-bazar-delivery-v1-'+Date.now();const a=['--wait','--collect','--quiet','--unit='+u,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','--property=ReadWritePaths=/home/cfpark /var/backups /var/lib/prhm-agent-selfmaint-exec','--setenv=HOME=/home/cfpark','--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',PARK_BAZAR_DELIVERY_HELPER];cp.execFileSync('/usr/bin/systemd-run',a,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:600000,maxBuffer:1024*1024});const r=readJson(PARK_BAZAR_DELIVERY_RESULT);if(!r||r.ok!==true||r.action!=='park_bazar_delivery_patch_v1'||r.database_mutation!==false||r.remote_parity!==true||r.destination_sha_parity!==true)throw new Error('park_delivery_result_invalid');return r}\n";
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
const WORKTREE='/home/cfpark/worktrees/park-bazar-delivery-v27';
const BRANCH='feature/park-bazar-delivery-v27-app';
const CANONICAL_MAIN='38a6702d7ec1d3a3bc608d65b51168bd68e6437c';
const PLACE_ID=1;
const EVENT_IDS=Object.freeze([190,193,244]);
const BACKUP_ROOT='/var/backups/park-bazar-delivery-v27';
const RESULT='/var/lib/prhm-agent-selfmaint-exec/park-bazar-delivery-patch-v1/latest.json';
const FIXED=Object.freeze({
 'app/web/index.php':'a66dfb4b4afa2affe8322e302718e0e9010edfd244b30153f88c44a923fa1a18',
 'app/yii':'63dc92a76e44e9b71ccb28d8a57567d15206229b0fe6e39ebfa257b793bfc1c3',
 'app/modules/api/controllers/PublicController.php':'7a1ca66ea128ef133b911bc0032a4ad39f8a5a8f2fb900fc60e304d1466bb0c1'});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(m){throw new Error(m)}
function replaceOnce(src,a,b,label){const n=src.split(a).length-1;if(n!==1)fail(label+'_anchor_count_'+n);return src.replace(a,b)}
function run(file,args,opt={}){const r=cp.spawnSync(file,args,{encoding:'utf8',timeout:opt.timeout||120000,maxBuffer:1024*1024,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/home/cfpark',...(opt.env||{})}});if(r.error)fail('exec_error:'+file+':'+r.error.message);if(r.status!==0)fail('exec_failed:'+file+':'+r.status+':'+String(r.stderr||'').slice(-900));return String(r.stdout||'').trim()}
function git(args,opt={}){return run('/usr/bin/git',['-C',SOURCE,...args],opt)}
function gitWt(args,opt={}){const fixed=args[0]==='commit'?{GIT_AUTHOR_NAME:'PRHM Automation',GIT_AUTHOR_EMAIL:'deploy@prhm.ir',GIT_COMMITTER_NAME:'PRHM Automation',GIT_COMMITTER_EMAIL:'deploy@prhm.ir'}:{};return run('/usr/bin/git',['-C',WORKTREE,...args],{...opt,env:{...fixed,...(opt.env||{})}})}
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
const TRANSFORMS=Object.freeze({'app/web/index.php':transformWeb,'app/yii':transformCli,'app/modules/api/controllers/PublicController.php':transformSlider});
function atomicWrite(file,bytes,st){const tmp=file+'.park-bazar-'+process.pid+'-'+Date.now()+'.tmp';let fd;try{fd=fs.openSync(tmp,'wx',st.mode&0o777);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.chmodSync(tmp,st.mode&0o777);fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,file)}catch(e){try{if(fd!==undefined)fs.closeSync(fd)}catch{}try{fs.unlinkSync(tmp)}catch{}throw e}}
function ensureFixedPreimages(root){for(const [rel,expected] of Object.entries(FIXED)){const f=path.join(root,rel);const st=fs.lstatSync(f);if(st.isSymbolicLink()||!st.isFile())fail('target_not_regular:'+rel);if(sha(fs.readFileSync(f))!==expected)fail('preimage_sha_mismatch:'+rel)}}
function phpLint(root){for(const rel of Object.keys(FIXED)){const r=cp.spawnSync('/usr/bin/php',['-l',path.join(root,rel)],{encoding:'utf8',timeout:10000});if(r.error||r.status!==0)fail('php_lint_failed:'+rel)}}
function deleteRemoteBranch(){try{git(['push','origin',':refs/heads/'+BRANCH],{timeout:120000})}catch{}}
function cleanupWorktree(){try{if(fs.existsSync(WORKTREE))git(['worktree','remove','--force',WORKTREE])}catch{}try{git(['branch','-D',BRANCH])}catch{}}
function prepareGitWorktree(){
 if(fs.existsSync(WORKTREE))fail('worktree_already_exists');
 git(['fetch','origin','main']);
 const main=git(['rev-parse','origin/main']);if(main!==CANONICAL_MAIN)fail('canonical_main_sha_mismatch:'+main);
 const local=cp.spawnSync('/usr/bin/git',['-C',SOURCE,'show-ref','--verify','--quiet','refs/heads/'+BRANCH],{encoding:'utf8',timeout:10000});if(local.error)fail('local_branch_probe_error');if(local.status===0)fail('local_branch_already_exists');if(local.status!==1)fail('local_branch_probe_failed');
 const remote=cp.spawnSync('/usr/bin/git',['-C',SOURCE,'ls-remote','--heads','origin','refs/heads/'+BRANCH],{encoding:'utf8',timeout:120000,maxBuffer:65536});if(remote.error)fail('remote_branch_probe_error');if(remote.status!==0)fail('remote_branch_probe_failed');if(String(remote.stdout||'').trim())fail('remote_branch_already_exists');
 fs.mkdirSync(path.dirname(WORKTREE),{recursive:true,mode:0o750});
 git(['worktree','add','-b',BRANCH,WORKTREE,'origin/main']);
 ensureFixedPreimages(WORKTREE);
}
function buildGitCommit(){
 for(const [rel,expected] of Object.entries(FIXED)){const f=path.join(WORKTREE,rel);const before=fs.readFileSync(f);if(sha(before)!==expected)fail('worktree_preimage_changed:'+rel);fs.writeFileSync(f,Buffer.from(TRANSFORMS[rel](before.toString('utf8')),'utf8'))}
 phpLint(WORKTREE);gitWt(['diff','--check']);
 const changed=gitWt(['status','--porcelain','--',...Object.keys(FIXED)]).split(/\r?\n/).filter(Boolean);if(changed.length!==3)fail('changed_path_count_'+changed.length);
 gitWt(['add','--',...Object.keys(FIXED)]);
 gitWt(['commit','-m','fix(park-bazar): harden tenant delivery']);
 const commit_sha=gitWt(['rev-parse','HEAD']);if(!/^[a-f0-9]{40}$/.test(commit_sha))fail('commit_sha_invalid');
 gitWt(['push','origin','HEAD:refs/heads/'+BRANCH]);
 const line=git(['ls-remote','origin','refs/heads/'+BRANCH]);const remote_sha=String(line).split(/\s+/)[0]||'';if(remote_sha!==commit_sha)fail('remote_sha_mismatch');
 return {commit_sha,remote_sha};
}
function deployFromWorktree(backupDir){
 const deployed=[];fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
 for(const rel of Object.keys(FIXED)){
   const src=path.join(WORKTREE,rel),dst=path.join(DEST,rel),dstSt=fs.lstatSync(dst);if(dstSt.isSymbolicLink()||!dstSt.isFile())fail('destination_not_regular:'+rel);if(sha(fs.readFileSync(dst))!==FIXED[rel])fail('destination_preimage_mismatch:'+rel);
   const backup=path.join(backupDir,rel.replace(/\//g,'__'));fs.writeFileSync(backup,fs.readFileSync(dst),{mode:0o600,flag:'wx'});atomicWrite(dst,fs.readFileSync(src),dstSt);deployed.push({rel,dst,backup,st:dstSt});
   if(sha(fs.readFileSync(dst))!==sha(fs.readFileSync(src)))fail('destination_sha_parity:'+rel);
 }
 phpLint(DEST);return deployed;
}
function restoreDeployed(deployed){for(const x of [...deployed].reverse()){try{atomicWrite(x.dst,fs.readFileSync(x.backup),x.st)}catch{}}}
function runtimeVerify(){
 const urls=['/home','/theater/190','/theater/193','/theater/244'];for(const u of urls){const r=cp.spawnSync('/usr/bin/curl',['-fsS','--max-time','10','http://127.0.0.1:8081'+u],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024});if(r.error||r.status!==0)fail('runtime_probe_failed:'+u);if(u==='/home'&&/background-image\s*:\s*url\(\s*\)/i.test(r.stdout||''))fail('empty_slider_background_remaining');}
}
function apply(){
 if(process.getuid&&process.getuid()!==0)fail('root_required');ensureFixedPreimages(SOURCE);ensureFixedPreimages(DEST);
 let pushed=false,worktree=false,deployed=[];const backupDir=path.join(BACKUP_ROOT,new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+process.pid);
 try{
   prepareGitWorktree();worktree=true;const gitState=buildGitCommit();pushed=true;deployed=deployFromWorktree(backupDir);runtimeVerify();
   return {ok:true,schema_version:'prhm.host-action-result.v1',action:ACTION,place_id:PLACE_ID,event_ids:EVENT_IDS,canonical_main_sha:CANONICAL_MAIN,commit_sha:gitState.commit_sha,remote_sha:gitState.remote_sha,remote_parity:true,destination_sha_parity:true,database_mutation:false,production_mutation:true,rollback_performed:false};
 }catch(e){restoreDeployed(deployed);if(pushed)deleteRemoteBranch();if(worktree)cleanupWorktree();throw new Error('park_delivery_failed_rolled_back:'+String(e.message||e))}
}
function writeResult(value){fs.mkdirSync(path.dirname(RESULT),{recursive:true,mode:0o700});const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');const st={mode:0o600,uid:0,gid:0};atomicWrite(RESULT,bytes,st)}
if(require.main===module){try{const r=apply();writeResult(r);process.stdout.write(JSON.stringify(r)+'\n')}catch(e){process.stderr.write(String(e&&e.stack||e)+'\n');process.exit(1)}}
module.exports={ACTION,SOURCE,DEST,WORKTREE,BRANCH,CANONICAL_MAIN,PLACE_ID,EVENT_IDS,FIXED,transformWeb,transformCli,transformSlider,prepareGitWorktree,buildGitCommit,deployFromWorktree,deleteRemoteBranch,apply};
`;}

function buildInstallPlan(current){
  for(const k of ['base','exec','policy','mcp'])if(typeof current?.[k]!=='string')fail('install_source_missing:'+k);
  const expected={base:BASE_SHA,exec:EXEC_SHA,policy:POLICY_SHA,mcp:MCP_SHA};
  for(const k of Object.keys(expected))if(sha(current[k])!==expected[k])fail('install_preimage_sha_mismatch:'+k+':'+sha(current[k]));
  const helper=buildHelperSource(),helperSha=sha(helper);
  const next={base:buildBaseCandidate(current.base),exec:buildExecCandidate(current.exec,helperSha),policy:buildPolicyCandidate(current.policy),mcp:buildMcpCandidate(current.mcp),helper};
  return {ok:true,action:ACTION,helper_sha256:helperSha,next,post_sha256:Object.fromEntries(Object.entries(next).map(([k,v])=>[k,sha(v)])),production_application_mutation:false,database_mutation:false};
}
function productionDeps(){
  const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
  const read=file=>fs.readFileSync(file,'utf8');
  const nodeCheck=(text,label)=>{const f='/tmp/prhm-park-v27-'+process.pid+'-'+label+'.js';try{fs.writeFileSync(f,text,{mode:0o600,flag:'wx'});const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check',f],{encoding:'utf8',timeout:10000});if(r.error||r.status!==0)fail('node_syntax_invalid:'+label)}finally{try{fs.unlinkSync(f)}catch{}}};
  const atomic=(file,text,mode)=>{const dir=path.dirname(file),tmp=file+'.park-v27-'+process.pid+'-'+Date.now()+'.tmp',prior=fs.existsSync(file)?fs.statSync(file):null;let fd;try{fd=fs.openSync(tmp,'wx',mode);fs.writeFileSync(fd,text);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.chmodSync(tmp,mode);if(prior)fs.chownSync(tmp,prior.uid,prior.gid);fs.renameSync(tmp,file)}catch(e){try{if(fd!==undefined)fs.closeSync(fd)}catch{}try{fs.unlinkSync(tmp)}catch{}throw e}};
  const restart=service=>{const r=cp.spawnSync('/usr/bin/systemctl',['restart',service],{encoding:'utf8',timeout:60000});if(r.error||r.status!==0)fail('service_restart_failed:'+service)};
  const active=service=>String(cp.spawnSync('/usr/bin/systemctl',['is-active',service],{encoding:'utf8',timeout:10000}).stdout||'').trim()==='active';
  return {fs,path,read,nodeCheck,atomic,restart,active};
}
function preflight(deps=productionDeps()){
  const current={base:deps.read(PATHS.base),exec:deps.read(PATHS.exec),policy:deps.read(PATHS.policy),mcp:deps.read(PATHS.mcp)};const plan=buildInstallPlan(current);
  deps.nodeCheck(plan.next.base,'base');deps.nodeCheck(plan.next.exec,'exec');deps.nodeCheck(plan.next.mcp,'mcp');deps.nodeCheck(plan.next.helper,'helper');JSON.parse(plan.next.policy);
  return {ok:true,schema_version:'prhm.park-bazar-delivery-installer-preflight.v1',action:ACTION,preflight_only:true,helper_sha256:plan.helper_sha256,post_sha256:plan.post_sha256,production_application_mutation:false,database_mutation:false,policy_mutation:true,control_plane_mutation:true};
}
function install(deps=productionDeps()){
  const pf=preflight(deps);const current={base:deps.read(PATHS.base),exec:deps.read(PATHS.exec),policy:deps.read(PATHS.policy),mcp:deps.read(PATHS.mcp)};const plan=buildInstallPlan(current);
  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+process.pid;const backup=deps.path.join(INSTALL_BACKUP_ROOT,stamp);deps.fs.mkdirSync(backup,{recursive:true,mode:0o700});
  const modes={};for(const k of ['base','exec','policy','mcp']){modes[k]=deps.fs.statSync(PATHS[k]).mode&0o777;deps.fs.writeFileSync(deps.path.join(backup,k+'.bak'),current[k],{mode:0o600,flag:'wx'})}
  const helperExisted=deps.fs.existsSync(PATHS.helper);const helperOld=helperExisted?deps.fs.readFileSync(PATHS.helper):null;if(helperExisted)deps.fs.writeFileSync(deps.path.join(backup,'helper.bak'),helperOld,{mode:0o600,flag:'wx'});
  let mutated=false;const services=['prhm-company-approval.service','prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service','prhm-agent-mcp.service'];
  try{
    deps.atomic(PATHS.helper,plan.next.helper,0o700);for(const k of ['base','exec','policy','mcp'])deps.atomic(PATHS[k],plan.next[k],modes[k]);mutated=true;
    for(const service of services)deps.restart(service);for(const service of services)if(!deps.active(service))fail('service_not_active:'+service);
    for(const k of ['base','exec','policy','mcp'])if(sha(deps.read(PATHS[k]))!==plan.post_sha256[k])fail('post_install_sha_mismatch:'+k);if(sha(deps.read(PATHS.helper))!==plan.helper_sha256)fail('post_install_sha_mismatch:helper');
    return {ok:true,schema_version:'prhm.park-bazar-delivery-installer-result.v1',action:ACTION,installed:true,backup_dir:backup,helper_sha256:plan.helper_sha256,post_sha256:plan.post_sha256,requires_mcp_rolling_refresh:true,production_application_mutation:false,database_mutation:false,rollback_performed:false,preflight:pf};
  }catch(error){
    let rollback=[];if(mutated){for(const k of ['base','exec','policy','mcp'])try{deps.atomic(PATHS[k],current[k],modes[k])}catch(e){rollback.push(k+':'+e.message)}try{if(helperExisted)deps.atomic(PATHS.helper,helperOld,0o700);else deps.fs.unlinkSync(PATHS.helper)}catch(e){rollback.push('helper:'+e.message)}for(const service of services)try{deps.restart(service)}catch(e){rollback.push('restart:'+service+':'+e.message)}}
    if(rollback.length)throw new Error('install_failed_rollback_failed:'+String(error.message||error)+':'+rollback.join('|'));throw new Error('install_failed_rolled_back:'+String(error.message||error));
  }
}
function writeInstallerResult(value){const fs=require('node:fs'),path=require('node:path');fs.mkdirSync(path.dirname(INSTALL_RESULT),{recursive:true,mode:0o700});const tmp=INSTALL_RESULT+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,INSTALL_RESULT)}
if(require.main===module){try{if(process.argv.length!==2)fail('unexpected_arguments');if(process.getuid&&process.getuid()!==0)fail('root_required');const r=install();writeInstallerResult(r);process.stdout.write(JSON.stringify(r)+'\n')}catch(e){process.stderr.write(String(e&&e.stack||e)+'\n');process.exit(1)}}
module.exports={ACTION,OPERATION,POLICY_VERSION,POLICY_SHA,EXEC_SHA,MCP_SHA,BASE_SHA,PATHS,INSTALL_RESULT,FIXED_FILES,buildPolicyCandidate,buildMcpCandidate,buildBaseCandidate,buildExecCandidate,buildHelperSource,buildInstallPlan,preflight,install,productionDeps,sha};
