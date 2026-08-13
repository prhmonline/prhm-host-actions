#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const cp=require('child_process');
const crypto=require('crypto');
const http=require('http');

const ROOT=__dirname;
const NODE='/usr/local/bin/prhm-node';
const HOST='185.191.76.138';
const PRIVATE_HOST='10.71.0.1';
const PORT=22;
const MARKER='/var/lib/prhm-agent-selfmaint-exec/host-actions-v2-ssl-bootstrap.json';
const LOCAL_DIR='/etc/prhm-host-actions';
const LOCAL_KEY=path.join(LOCAL_DIR,'node1_ssl_ed25519');
const LOCAL_KNOWN=path.join(LOCAL_DIR,'known_hosts');
const BACKUP_ROOT='/var/backups/prhm-host-actions-v2-ssl';
const EXPECTED_PAYLOAD='42ddf3e5e414089b3e5ebe73af94d2f89aee368bb794db9f471723cc78f0e97b';
const EXPECTED_HELPER='540d3e5c23983ed6ff3969e92fc00c9445d6ad0daef5534572eda152ad102583';
const ACTION='repair_node1_ssl_deploy_v1';
const OLD_ACTIONS=['agent_api_process_sandbox_v1','agent_api_filesystem_confinement_v1','agent_api_capability_minimize_v1'];

const TARGETS={
  policy:{path:'/opt/prhm-company-control-plane/config/approval-policy.json',sha:'eb8a97a8e0388dadf00fd2595173b53fbb6b7150036c89306d4f368be18480e9',patch:'lib/patch-policy-v2-ssl.js',kind:'json'},
  base:{path:'/opt/prhm-agent-selfmaint/server.js',sha:'b143300d039fe7e152cb4e1d6d94c65f04f2a25d0e996185b810e6d8fb51e8c7',patch:'lib/patch-base-v2-ssl.js',kind:'js'},
  exec:{path:'/opt/prhm-agent-selfmaint-exec/server.js',sha:'d324f798d8b36259f00978a8b48ae1e4b1f399ca5782030e544ad7ff1aacaea0',patch:'lib/patch-exec-v2-ssl.js',kind:'js'},
  mcp:{path:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',sha:'a1b7711fd0f981c3149c8417d60209b2913e06071617cfa93ee5d5db01e8f735',patch:'lib/patch-mcp-v2-ssl.js',kind:'js'}
};
const ARTIFACTS={
  'lib/patch-policy-v2-ssl.js':'c15524a4992eb8284e464574f7eb44b06bcb46f0c2599fb3821c1b7b949d19f3',
  'lib/patch-base-v2-ssl.js':'2c50b7af11b5a72013c709e8258b62cb9e4abd13a8f71a642bbb6473ed98ca61',
  'lib/patch-exec-v2-ssl.js':'a1f5b13eef66e5c65d4afbba598f4cf1ba52cc1a38411b7fc28586d6f9b3561d',
  'lib/patch-mcp-v2-ssl.js':'dfd7bce1d67181c01ac2c7cce1ac2354cc4257161411d1325fc14791d285ad7e',
  'payloads/prhm-node1-ssl-helper-v1.sh':EXPECTED_HELPER,
  'payloads/prhm-edge-cert-deploy-v2.sh':EXPECTED_PAYLOAD,
  'payloads/node1-bootstrap-preflight-v1.sh':'b5b2fcdf1aae4c68049d84e59ceb3f1fcba8114fccc42b3aed3f120895d4986e',
  'payloads/node1-bootstrap-provision-v1.sh':'70865d6bf00110f6376456d243bcbe85da13e31562ed8dd278e8d377b7619ab4',
  'payloads/node1-bootstrap-deprovision-v1.sh':'c2f2da56b122ff4a1f55ea12a99498d7e0a10a4b010692e63495675754fb53b1'
};
const SERVICES=['prhm-company-approval.service','prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service','prhm-agent-mcp.service'];

function die(m){throw new Error(m);}
function shaBuf(b){return crypto.createHash('sha256').update(b).digest('hex');}
function shaFile(f){return shaBuf(fs.readFileSync(f));}
function execFile(bin,args,opt={}){const r=cp.spawnSync(bin,args,{encoding:'utf8',timeout:opt.timeout||30000,maxBuffer:opt.maxBuffer||800000,input:opt.input,stdio:opt.stdio});if(r.error)die('exec_error:'+path.basename(bin)+':'+r.error.message);if(r.status!==0)die('exec_failed:'+path.basename(bin)+':'+r.status+':'+String(r.stderr||r.stdout||'').slice(0,3000));return String(r.stdout||'');}
function systemctl(...args){return execFile('/usr/bin/systemctl',args,{timeout:30000}).trim();}
function assertRegular(f){const st=fs.lstatSync(f);if(!st.isFile()||st.isSymbolicLink())die('not_regular_file:'+f);return st;}
function atomicWrite(target,buf,st){const tmp=target+'.v2ssl-'+process.pid+'-'+crypto.randomUUID()+'.tmp';const fd=fs.openSync(tmp,'wx',st.mode&0o777);try{fs.writeFileSync(fd,buf);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,target);}
function ensureActive(service){if(systemctl('is-active',service)!=='active')die('service_not_active:'+service);}
function sleep(ms){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);}
function waitActive(service){for(let i=0;i<40;i++){try{if(systemctl('is-active',service)==='active')return;}catch{}sleep(250);}die('service_health_timeout:'+service);}
function assertExecutorNetworkAllowed(){let raw='';try{raw=execFile('/usr/bin/systemctl',['show','prhm-agent-selfmaint-exec.service','-p','RestrictAddressFamilies','--value'],{timeout:10000,maxBuffer:100000}).trim();}catch(e){die('executor_address_family_query_failed:'+e.message);}if(raw&&raw!=='[unprintable]'){const toks=raw.split(/\s+/);if(!toks.includes('AF_INET'))die('executor_af_inet_blocked:'+raw);return;}let cat='';try{cat=execFile('/usr/bin/systemctl',['cat','prhm-agent-selfmaint-exec.service'],{timeout:10000,maxBuffer:200000});}catch(e){die('executor_unit_read_failed:'+e.message);}const vals=cat.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.startsWith('RestrictAddressFamilies=')).map(x=>x.slice('RestrictAddressFamilies='.length).trim());if(!vals.length)return;let effective='';for(const v of vals){if(v==='')effective='';else effective=v;}if(effective&&!effective.split(/\s+/).includes('AF_INET'))die('executor_af_inet_blocked_from_unit:'+effective);}
function unixJson(socketPath,pathname='/health'){return new Promise((resolve,reject)=>{const q=http.request({socketPath,path:pathname,method:'GET'},r=>{let n=0,ch=[];r.on('data',c=>{n+=c.length;if(n<300000)ch.push(c)});r.on('end',()=>{if(n>=300000)return reject(new Error('unix_health_too_large'));let o={};try{o=JSON.parse(Buffer.concat(ch).toString('utf8')||'{}')}catch{return reject(new Error('unix_health_invalid_json'))}if(r.statusCode!==200||o.ok!==true)return reject(new Error('unix_health_failed:'+r.statusCode));resolve(o)});});q.setTimeout(5000,()=>q.destroy(new Error('unix_health_timeout')));q.on('error',reject);q.end();});}
function httpJson(port,pathname='/health'){return new Promise((resolve,reject)=>{const q=http.get({hostname:'127.0.0.1',port,path:pathname,timeout:5000},r=>{let n=0,ch=[];r.on('data',c=>{n+=c.length;if(n<300000)ch.push(c)});r.on('end',()=>{let o={};try{o=JSON.parse(Buffer.concat(ch).toString('utf8')||'{}')}catch{return reject(new Error('http_health_invalid_json'))}if(r.statusCode!==200||o.ok!==true)return reject(new Error('http_health_failed:'+port+':'+r.statusCode));resolve(o)});});q.on('error',reject);q.on('timeout',()=>q.destroy(new Error('http_health_timeout:'+port)));});}
function parseKeyscan(text,expectedHost){const lines=String(text).split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'));if(lines.length!==1)die('keyscan_cardinality:'+expectedHost+':'+lines.length);const f=lines[0].split(/\s+/);if(f.length<3||f[1]!=='ecdsa-sha2-nistp256')die('keyscan_invalid:'+expectedHost);const accepted=[expectedHost,'['+expectedHost+']:'+PORT];if(!accepted.includes(f[0]))die('keyscan_host_mismatch:'+f[0]);let blob;try{blob=Buffer.from(f[2],'base64');}catch{die('keyscan_base64_invalid');}if(!blob.length)die('keyscan_blob_empty');return {line:lines[0],type:f[1],blob:f[2],sha:shaBuf(blob)};}
function keyscan(host){const r=cp.spawnSync('/usr/bin/ssh-keyscan',['-T','5','-p',String(PORT),'-t','ecdsa',host],{encoding:'utf8',timeout:10000,maxBuffer:100000});if(r.error||r.status!==0)die('ssh_keyscan_failed:'+host+':'+String(r.stderr||''));return parseKeyscan(r.stdout,host);}
function rootSsh(knownHosts,script,args=[],timeout=60000){const a=['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+knownHosts,'-o','ConnectTimeout=8','-p',String(PORT),'root@'+HOST,'bash','-s','--',...args];return execFile('/usr/bin/ssh',a,{input:script,timeout,maxBuffer:500000});}
function scpToNode1(knownHosts,src,dst){const a=['-q','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+knownHosts,'-P',String(PORT),src,'root@'+HOST+':'+dst];execFile('/usr/bin/scp',a,{timeout:60000,maxBuffer:100000});}
function dedicatedSsh(key,knownHosts,command,timeout=120000){if(typeof command!=='string'||/[\r\n\0]/.test(command)||command.length>300)die('dedicated_command_invalid');const a=['-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+knownHosts,'-o','ConnectTimeout=8','-i',key,'-p',String(PORT),'root@'+HOST,command];return execFile('/usr/bin/ssh',a,{timeout,maxBuffer:300000});}
function kv(text){const o={};for(const raw of String(text).split(/\r?\n/)){const line=raw.trim();if(!line)continue;const i=line.indexOf('=');if(i>0)o[line.slice(0,i)]=line.slice(i+1);}return o;}
function runPatch(moduleFile,target,outFile){const out=execFile(NODE,[moduleFile,target],{timeout:20000,maxBuffer:500000});fs.writeFileSync(outFile,out,{mode:0o600});}

async function preflight(){
  if(process.getuid&&process.getuid()!==0)die('root_required');
  if(fs.existsSync(MARKER))die('ssl_extension_marker_exists');
  for(const [rel,expected] of Object.entries(ARTIFACTS)){const f=path.join(ROOT,rel);assertRegular(f);const a=shaFile(f);if(a!==expected)die('artifact_sha_mismatch:'+rel+':'+a);}
  for(const [name,t] of Object.entries(TARGETS)){assertRegular(t.path);const a=shaFile(t.path);if(a!==t.sha)die('target_sha_mismatch:'+name+':'+a);}
  if(fs.existsSync(LOCAL_KEY)||fs.existsSync(LOCAL_KNOWN))die('dedicated_credential_path_already_exists');
  for(const s of SERVICES)ensureActive(s);
  assertExecutorNetworkAllowed();
  const baseHealth=await unixJson('/run/prhm-agent-selfmaint/selfmaint.sock');
  const execHealth=await unixJson('/run/prhm-agent-selfmaint-exec/exec.sock');
  const before=Array.isArray(execHealth.host_actions_v2)?execHealth.host_actions_v2:[];
  for(const a of OLD_ACTIONS)if(!before.includes(a))die('existing_v2_action_missing:'+a);
  if(before.includes(ACTION))die('ssl_action_already_advertised');
  await httpJson(8123);

  const tmp=fs.mkdtempSync('/tmp/prhm-host-actions-v2-ssl-preflight-');fs.chmodSync(tmp,0o700);
  const transformed={};
  for(const [name,t] of Object.entries(TARGETS)){const out=path.join(tmp,name+(t.kind==='json'?'.json':'.js'));runPatch(path.join(ROOT,t.patch),t.path,out);transformed[name]=out;if(t.kind==='json')JSON.parse(fs.readFileSync(out,'utf8'));else execFile(NODE,['--check',out],{timeout:10000,maxBuffer:100000});}
  const policy=JSON.parse(fs.readFileSync(transformed.policy,'utf8'));
  if(policy.operations?.['host_action.repair_node1_ssl_deploy_v1']?.level!==4)die('transformed_policy_operation_missing');
  const scopes=(policy.typed_scopes||[]).filter(x=>x?.action===ACTION&&x?.operation==='host_action.repair_node1_ssl_deploy_v1'&&x?.tool==='host_action_v2_apply');if(scopes.length!==1)die('transformed_policy_scope_cardinality:'+scopes.length);
  if(!fs.readFileSync(transformed.base,'utf8').includes('hostActionV2ApprovalArgs'))die('transformed_base_ssl_helper_missing');
  if(!fs.readFileSync(transformed.exec,'utf8').includes('preflightApprovedNode1Ssl'))die('transformed_exec_ssl_helper_missing');
  if(!fs.readFileSync(transformed.mcp,'utf8').includes("'repair_node1_ssl_deploy_v1'"))die('transformed_mcp_action_missing');
  execFile('/usr/bin/bash',['-n',path.join(ROOT,'payloads/prhm-node1-ssl-helper-v1.sh')]);
  execFile('/usr/bin/bash',['-n',path.join(ROOT,'payloads/prhm-edge-cert-deploy-v2.sh')]);

  const pub=keyscan(HOST),priv=keyscan(PRIVATE_HOST);
  if(pub.type!==priv.type||pub.blob!==priv.blob||pub.sha!==priv.sha)die('node1_public_private_host_key_mismatch');
  const known=path.join(tmp,'known_hosts');fs.writeFileSync(known,pub.line+'\n',{mode:0o600});
  const remoteOut=rootSsh(known,fs.readFileSync(path.join(ROOT,'payloads/node1-bootstrap-preflight-v1.sh'),'utf8'));
  const remote=kv(remoteOut);
  if(remote.NODE1_BOOTSTRAP_PREFLIGHT!=='OK')die('node1_preflight_marker_missing');
  if(!/^[a-f0-9]{64}$/.test(remote.ACTIVE_SHA256||''))die('node1_active_sha_invalid');
  if(remote.HOST_KEY_SHA256!==pub.sha)die('node1_authenticated_host_key_mismatch:'+String(remote.HOST_KEY_SHA256||''));
  return {tmp,transformed,knownHosts:known,hostKeySha:pub.sha,activeSha:remote.ACTIVE_SHA256,baseHealth,execHealth};
}

function makeBackup(ctx){const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+process.pid;const dir=path.join(BACKUP_ROOT,stamp);fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.chmodSync(dir,0o700);const originals={};for(const [name,t] of Object.entries(TARGETS)){const st=assertRegular(t.path),buf=fs.readFileSync(t.path),backup=path.join(dir,name+(t.kind==='json'?'.json':'.js'));fs.writeFileSync(backup,buf,{flag:'wx',mode:0o600});originals[name]={st,buf,backup};}ctx.backupDir=dir;ctx.originals=originals;return dir;}
function installTransformed(ctx){ctx.localFilesMutated=true;for(const [name,t] of Object.entries(TARGETS)){const buf=fs.readFileSync(ctx.transformed[name]);atomicWrite(t.path,buf,ctx.originals[name].st);}}
function restoreOriginals(ctx){if(!ctx.originals)return;for(const [name,t] of Object.entries(TARGETS)){const o=ctx.originals[name];atomicWrite(t.path,o.buf,o.st);}}
async function restartAndVerify(expectSsl){for(const s of SERVICES)systemctl('restart',s);for(const s of SERVICES)waitActive(s);const base=await unixJson('/run/prhm-agent-selfmaint/selfmaint.sock');const ex=await unixJson('/run/prhm-agent-selfmaint-exec/exec.sock');await httpJson(8123);const acts=Array.isArray(ex.host_actions_v2)?ex.host_actions_v2:[];for(const a of OLD_ACTIONS)if(!acts.includes(a))die('post_restart_old_action_missing:'+a);if(expectSsl&&!acts.includes(ACTION))die('post_restart_ssl_action_missing');if(!expectSsl&&acts.includes(ACTION))die('rollback_ssl_action_still_present');return {base,exec:ex};}
function installLocalCredential(ctx,tempKey){const existed=fs.existsSync(LOCAL_DIR);if(!existed){fs.mkdirSync(LOCAL_DIR,{recursive:true,mode:0o700});ctx.localDirCreated=true;}fs.chmodSync(LOCAL_DIR,0o700);if(fs.existsSync(LOCAL_KEY)||fs.existsSync(LOCAL_KNOWN))die('dedicated_credential_collision');const keyBuf=fs.readFileSync(tempKey),knownBuf=fs.readFileSync(ctx.knownHosts);fs.writeFileSync(LOCAL_KEY,keyBuf,{flag:'wx',mode:0o600});fs.chmodSync(LOCAL_KEY,0o600);ctx.localKeyCreated=true;fs.writeFileSync(LOCAL_KNOWN,knownBuf,{flag:'wx',mode:0o600});fs.chmodSync(LOCAL_KNOWN,0o600);ctx.localKnownCreated=true;}
function removeLocalCredential(ctx){if(ctx.localKeyCreated)try{fs.unlinkSync(LOCAL_KEY)}catch{};if(ctx.localKnownCreated)try{fs.unlinkSync(LOCAL_KNOWN)}catch{};if(ctx.localDirCreated)try{fs.rmdirSync(LOCAL_DIR)}catch{};}
function remoteCleanup(ctx){if(!ctx.remoteTemps?.length)return;const script='set -Eeuo pipefail\nrm -f -- "$@"\n';try{rootSsh(ctx.knownHosts,script,ctx.remoteTemps,30000);}catch{}}
function remoteDeprovision(ctx){if(!ctx.remoteProvisioned)return;rootSsh(ctx.knownHosts,fs.readFileSync(path.join(ROOT,'payloads/node1-bootstrap-deprovision-v1.sh'),'utf8'),[],60000);ctx.remoteProvisioned=false;}
function parseObserve(text){const o=kv(text);if(o.HELPER_VERSION!=='prhm.node1.ssl-helper.v1')die('dedicated_helper_version_mismatch');if(o.PAYLOAD_SHA256!==EXPECTED_PAYLOAD)die('dedicated_payload_sha_mismatch');if(!/^[a-f0-9]{64}$/.test(o.ACTIVE_SHA256||''))die('dedicated_active_sha_invalid');return o;}
function writeMarker(ctx,health,observe){const data={schema_version:'prhm.host-actions-v2-ssl-bootstrap.v1',installed_at:new Date().toISOString(),action:ACTION,backup_dir:ctx.backupDir,node1:{host:HOST,port:PORT,host_key_sha256:ctx.hostKeySha,active_sha256:observe.ACTIVE_SHA256,payload_sha256:observe.PAYLOAD_SHA256,helper_version:observe.HELPER_VERSION},targets:Object.fromEntries(Object.entries(TARGETS).map(([n,t])=>[n,{old_sha256:t.sha,new_sha256:shaFile(t.path)}])),executor_actions_v2:health.exec.host_actions_v2};const tmp=MARKER+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,MARKER);ctx.markerCreated=true;}

async function apply(){
  const ctx=await preflight();let rollbackErrors=[];
  try{
    const tempKey=path.join(ctx.tmp,'node1_ssl_ed25519');execFile('/usr/bin/ssh-keygen',['-q','-t','ed25519','-N','','-C','prhm-host-actions-v2-node1-ssl','-f',tempKey],{timeout:15000,maxBuffer:100000});
    const pubFile=tempKey+'.pub';assertRegular(pubFile);
    const tag=process.pid+'-'+crypto.randomUUID().slice(0,8);const rh='/tmp/prhm-host-actions-v2-ssl-'+tag+'.helper',rp='/tmp/prhm-host-actions-v2-ssl-'+tag+'.payload',rk='/tmp/prhm-host-actions-v2-ssl-'+tag+'.pub';ctx.remoteTemps=[rh,rp,rk];
    scpToNode1(ctx.knownHosts,path.join(ROOT,'payloads/prhm-node1-ssl-helper-v1.sh'),rh);scpToNode1(ctx.knownHosts,path.join(ROOT,'payloads/prhm-edge-cert-deploy-v2.sh'),rp);scpToNode1(ctx.knownHosts,pubFile,rk);
    const prov=rootSsh(ctx.knownHosts,fs.readFileSync(path.join(ROOT,'payloads/node1-bootstrap-provision-v1.sh'),'utf8'),[rh,rp,rk],90000);if(kv(prov).NODE1_PROVISION!=='OK')die('node1_provision_marker_missing');ctx.remoteProvisioned=true;remoteCleanup(ctx);
    installLocalCredential(ctx,tempKey);
    const observed=parseObserve(dedicatedSsh(LOCAL_KEY,LOCAL_KNOWN,'ssl-observe',30000));if(observed.ACTIVE_SHA256!==ctx.activeSha)die('active_sha_changed_during_bootstrap:'+observed.ACTIVE_SHA256);
    const pre=dedicatedSsh(LOCAL_KEY,LOCAL_KNOWN,'ssl-preflight '+ctx.activeSha+' '+EXPECTED_PAYLOAD,120000);if(!/ACTION_PREFLIGHT=OK(?:\r?\n|$)/.test(pre))die('dedicated_preflight_marker_missing');
    makeBackup(ctx);installTransformed(ctx);const health=await restartAndVerify(true);
    const finalObserve=parseObserve(dedicatedSsh(LOCAL_KEY,LOCAL_KNOWN,'ssl-observe',30000));if(finalObserve.ACTIVE_SHA256!==ctx.activeSha)die('bootstrap_changed_active_deploy_unexpectedly');
    writeMarker(ctx,health,finalObserve);
    fs.rmSync(ctx.tmp,{recursive:true,force:true});
    console.log('HOST_ACTIONS_V2_SSL_BOOTSTRAP=SUCCESS');console.log('ACTION='+ACTION);console.log('NODE1_ACTIVE_SHA256='+ctx.activeSha);console.log('PAYLOAD_SHA256='+EXPECTED_PAYLOAD);console.log('HOST_KEY_SHA256='+ctx.hostKeySha);console.log('BACKUP_DIR='+ctx.backupDir);console.log('PRODUCTION_SSL_DEPLOY_SCRIPT_MUTATION=NO');
  }catch(error){
    try{if(ctx.markerCreated&&fs.existsSync(MARKER))fs.unlinkSync(MARKER);}catch(e){rollbackErrors.push('marker:'+e.message);}
    if(ctx.localFilesMutated){try{restoreOriginals(ctx);await restartAndVerify(false);}catch(e){rollbackErrors.push('local_control_plane:'+e.message);}}
    try{removeLocalCredential(ctx);}catch(e){rollbackErrors.push('local_credential:'+e.message);}
    try{remoteDeprovision(ctx);}catch(e){rollbackErrors.push('node1_deprovision:'+e.message);}
    try{remoteCleanup(ctx);}catch{}
    try{fs.rmSync(ctx.tmp,{recursive:true,force:true});}catch{}
    if(rollbackErrors.length)throw new Error('bootstrap_failed_and_rollback_failed:'+error.message+':'+rollbackErrors.join('|'));
    throw new Error('bootstrap_failed_rolled_back:'+error.message);
  }
}

(async()=>{try{const preflightOnly=process.argv.includes('--preflight-only');if(process.argv.length>3||(process.argv.length===3&&!preflightOnly))die('usage: bootstrap-host-actions-v2-ssl.js [--preflight-only]');if(preflightOnly){const c=await preflight();console.log('HOST_ACTIONS_V2_SSL_PREFLIGHT=OK');console.log('NODE1_ACTIVE_SHA256='+c.activeSha);console.log('PAYLOAD_SHA256='+EXPECTED_PAYLOAD);console.log('HOST_KEY_SHA256='+c.hostKeySha);console.log('MUTATION=NO');fs.rmSync(c.tmp,{recursive:true,force:true});return;}await apply();}catch(e){console.error('ERROR='+String(e.message||e));process.exit(1);}})();
