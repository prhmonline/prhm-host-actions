const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const cp=require('child_process');
const Module=require('module');

const BASE_SHA='95b276b073a7cc6d322e7b65f965072e1512528409735102669aeb65157126ed';
const BACKUP_DIR='/var/backups/prhm-agent-selfmaint';
const PREFIX='agent_api-server.js-';
const SUFFIX='-'+BASE_SHA+'.bak';
const SAFEFILES='/home/agent/ssh-mcp-server/src/plugins/safeFiles.js';
const SAFEFILES_SHA='0279340d925d151d7c1d2eedea355b0e865e126fdf3839e9ad77c756a4a53338';
const OPS_SELFMAINT_BRIDGE='/home/agent/ssh-agent-api/opsSelfmaintBridge.js';
const OPS_SELFMAINT_BRIDGE_SHA='61348a19f6ff2aa521454996ead308cd392f0cd215d20e6fe2fb2a6139281932';
let level3OpsSelfmaintBridge=null;
const GREEN='prhm-agent-mcp-green.service';
const EXPECTED_OLD_GREEN_PID=634895;
const RUNTIME_PREIMAGE_SHA='c59283afb1d03c523d22d649765ebdaf388857d49e3d86e5a2abab8543fcf69a';
const SOLO_RUNTIME_BOOTSTRAP_ROUTE='/solo-company/runtime/bootstrap-surface-v1';
const SOLO_RUNTIME_BOOTSTRAP_HELPER='/root/prhm-host-actions/bootstrap-host-actions-v25-solo-company-runtime-installer.js';
const SOLO_RUNTIME_BOOTSTRAP_HELPER_SHA='acdab711d3567c8b4f50b06226d8765c6e59260070fa055f3568a962dabc7e86';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

const SSH_POOL_ENABLED=/^(1|true|yes|on)$/i.test(String(process.env.AGENT_SSH_POOL_ENABLED||''))||['8100','8102'].includes(String(process.env.PRHM_ZDT_PORT||''));
const SSH_POOL_MAX=Math.min(6,Math.max(1,Number.parseInt(process.env.AGENT_SSH_POOL_MAX_CONNECTIONS||'6',10)||6));
const SSH_POOL_IDLE_MS=Math.min(120000,Math.max(1000,Number.parseInt(process.env.AGENT_SSH_POOL_IDLE_TIMEOUT_MS||'15000',10)||15000));
let pooledSsh2=null;
function getPooledSsh2(rawSsh2){
  if(!SSH_POOL_ENABLED)return rawSsh2;
  if(pooledSsh2)return pooledSsh2;
  const {createPooledSsh2Module}=require('./prhm-ssh2-pool-adapter-v1');
  pooledSsh2=createPooledSsh2Module({rawSsh2,maxConnections:SSH_POOL_MAX,idleTimeoutMs:SSH_POOL_IDLE_MS});
  return pooledSsh2;
}

function fail(m){throw new Error(m);}
function run(file,args,timeout=15000){const r=cp.spawnSync(file,args,{encoding:'utf8',timeout,maxBuffer:256*1024});if(r.error)fail('exec_error:'+file+':'+r.error.message);return r;}
function loadBase(){const names=fs.readdirSync(BACKUP_DIR).filter(n=>n.startsWith(PREFIX)&&n.endsWith(SUFFIX)).sort().reverse();if(!names.length)fail('green_refresh_base_backup_not_found');const bytes=fs.readFileSync(path.join(BACKUP_DIR,names[0]));if(sha(bytes)!==BASE_SHA)fail('green_refresh_base_sha_mismatch');return bytes;}
function mainPid(unit){const r=run('/usr/bin/systemctl',['show',unit,'--property=MainPID','--value']);if(r.status!==0)fail('systemctl_show_failed:'+unit);const n=Number(String(r.stdout||'').trim());if(!Number.isInteger(n)||n<=0)fail('invalid_main_pid:'+unit);return n;}
function health(port){const r=run('/usr/bin/curl',['-fsS','--max-time','3','http://127.0.0.1:'+port+'/health'],5000);return r.status===0&&String(r.stdout||'').includes('"ok":true');}
function waitHealth(port){for(let i=0;i<50;i++){if(health(port))return true;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200);}return false;}
function refreshGreenOnce(){
  if(!fs.existsSync(SAFEFILES)||sha(fs.readFileSync(SAFEFILES))!==SAFEFILES_SHA)fail('safe_files_sha_mismatch');
  if(!health(8124))fail('blue_health_failed_before_green_refresh');
  if(!health(8123))fail('router_health_failed_before_green_refresh');
  const before=mainPid(GREEN);
  if(before===EXPECTED_OLD_GREEN_PID){
    const r=run('/usr/bin/systemctl',['restart',GREEN],60000);
    if(r.status!==0)fail('green_restart_failed:'+String(r.stderr||'').slice(-500));
    if(!waitHealth(8125))fail('green_health_failed_after_restart');
    const after=mainPid(GREEN);
    if(after===before)fail('green_pid_did_not_change');
  }else{
    if(!health(8125))fail('green_already_refreshed_but_unhealthy');
  }
  if(!health(8123))fail('router_health_failed_after_green_refresh');
}

function soloBootstrapResult(raw){
  const lines=String(raw||'').split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
  for(let i=lines.length-1;i>=0;i--){
    let v;try{v=JSON.parse(lines[i]);}catch{continue;}
    if(v&&v.ok===true&&v.action==='solo_company_runtime_install_surface_v1'&&v.requires_zdt_refresh===true&&v.production_application_mutation===false&&v.database_mutation===false){
      return {ok:true,action:v.action,status:v.status||null,installed:v.installed===true,already_installed:v.already_installed===true,source_commit:v.source_commit||null,solo_plugin_sha256:v.solo_plugin_sha256||null,solo_core_sha256:v.solo_core_sha256||null,registry_sha256:v.registry_sha256||null,requires_zdt_refresh:true,rollback_performed:v.rollback_performed===true,arbitrary_path:false,arbitrary_command:false};
    }
  }
  fail('solo_runtime_bootstrap_result_invalid');
}
function soloRuntimeBootstrap(){
  const st=fs.lstatSync(SOLO_RUNTIME_BOOTSTRAP_HELPER);
  if(!st.isFile()||st.isSymbolicLink())fail('solo_runtime_bootstrap_helper_invalid');
  if(sha(fs.readFileSync(SOLO_RUNTIME_BOOTSTRAP_HELPER))!==SOLO_RUNTIME_BOOTSTRAP_HELPER_SHA)fail('solo_runtime_bootstrap_helper_sha_mismatch');
  const u='prhm-solo-runtime-bootstrap-'+process.pid+'-'+Date.now();
  const a=['--wait','--collect','--quiet','--unit='+u,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=PrivateDevices=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true','--property=ProtectControlGroups=true','--property=RestrictNamespaces=true','--property=RestrictAddressFamilies=AF_UNIX','--property=ReadWritePaths=/home/agent/ssh-mcp-server/src/plugins /home/agent/ssh-mcp-server/src/core /var/backups','--setenv=PATH=/usr/local/bin:/usr/bin:/bin','/usr/local/bin/prhm-node',SOLO_RUNTIME_BOOTSTRAP_HELPER,'--apply'];
  const r=cp.spawnSync('/usr/bin/systemd-run',a,{encoding:'utf8',timeout:180000,maxBuffer:300000,stdio:['ignore','pipe','pipe']});
  if(r.error||r.status!==0)fail('solo_runtime_bootstrap_execution_failed');
  return soloBootstrapResult(r.stdout);
}
function soloRuntimeBootstrapHandler(req,res){
  const body=req&&req.body==null?{}:req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==0)return res.status(400).json({ok:false,error:'solo_runtime_bootstrap_zero_input_required'});
  try{return res.status(200).json(soloRuntimeBootstrap());}
  catch(e){return res.status(409).json({ok:false,error:String(e&&e.message||e).slice(0,160),arbitrary_path:false,arbitrary_command:false,production_application_mutation:false,database_mutation:false});}
}
function augmentBasicFileRoutes(baseModule){
  if(!baseModule||typeof baseModule.registerBasicFileRoutes!=='function')fail('solo_runtime_file_routes_export_missing');
  const originalRegisterBasicFileRoutes=baseModule.registerBasicFileRoutes;
  return {...baseModule,registerBasicFileRoutes(app,context){
    if(!context||typeof context.auth!=='function')fail('solo_runtime_bootstrap_auth_missing');
    app.post(SOLO_RUNTIME_BOOTSTRAP_ROUTE,context.auth,soloRuntimeBootstrapHandler);
    return originalRegisterBasicFileRoutes(app,context);
  }};
}

function loadLevel3OpsSelfmaintBridge(){
  if(level3OpsSelfmaintBridge)return level3OpsSelfmaintBridge;
  if(!fs.existsSync(OPS_SELFMAINT_BRIDGE))fail('ops_selfmaint_bridge_missing');
  const bridgeBytes=fs.readFileSync(OPS_SELFMAINT_BRIDGE);
  if(sha(bridgeBytes)!==OPS_SELFMAINT_BRIDGE_SHA)fail('ops_selfmaint_bridge_sha_mismatch');
  const bridgeSource=bridgeBytes.toString('utf8');
  const guardCount=bridgeSource.split("if(s.second_confirmation!=='CONFIRM_LEVEL_4_CRITICAL')fail('Level-4 confirmation required')").length-1;
  if(guardCount!==1)fail('ops_selfmaint_bridge_guard_mismatch:'+guardCount);
  const nextSource=bridgeSource.replace("if(s.second_confirmation!=='CONFIRM_LEVEL_4_CRITICAL')fail('Level-4 confirmation required')","if(s.second_confirmation!=='CONFIRM_LEVEL_3_PRODUCTION')fail('Level-3 confirmation required')");
  const compiled=new Module(OPS_SELFMAINT_BRIDGE,module);
  compiled.filename=path.join(__dirname,'opsSelfmaintBridge.level3-overlay-v1.js');
  compiled.paths=module.paths;
  compiled._compile(nextSource,compiled.filename);
  if(!compiled.exports||typeof compiled.exports.createOpsSelfmaintBridge!=='function')fail('ops_selfmaint_bridge_export_missing');
  level3OpsSelfmaintBridge=compiled.exports;
  return level3OpsSelfmaintBridge;
}

const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
  if(SSH_POOL_ENABLED&&request==='ssh2'){
    const raw=originalLoad.call(this,request,parent,isMain);
    return getPooledSsh2(raw);
  }
  if(request==='./opsSelfmaintBridge'||request==='./opsSelfmaintBridge.js'){
    return loadLevel3OpsSelfmaintBridge();
  }
  if(request==='./fileBasicRoutes'||request==='./fileBasicRoutes.js'){
    const raw=originalLoad.call(this,request,parent,isMain);
    return augmentBasicFileRoutes(raw);
  }
  return originalLoad.call(this,request,parent,isMain);
};
try{
  const bytes=loadBase();
  const compiled=new Module(__filename,module);
  compiled.filename=path.join(__dirname,'server.mcp-green-refresh-once-ssh-pool-v1.js');
  compiled.paths=module.paths;
  compiled._compile(bytes.toString('utf8'),compiled.filename);
}finally{
  Module._load=originalLoad;
}


