'use strict';

const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');

const ACTION='control_plane_current_owner_binding_refresh_v1';
const PRIVATE_DIR='/opt/prhm-agent-selfmaint-exec/actions/current-owner-binding-v1';
const STATE_ROOT='/var/lib/prhm-agent-selfmaint-exec/current-owner-binding-v1';
const BACKUP_ROOT='/var/backups/prhm-current-owner-binding-refresh-v1';
const LOCK_PATH=STATE_ROOT+'/refresh.lock';
const V19_WORKTREE='/home/prhm/worktrees/prhm-host-actions-zdt-installer-v2';
const V19_TEST=V19_WORKTREE+'/test-v18-agent-zdt-current-baseline-refresh.js';
const V19_HELPER='/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-source-sha-refresh-v19.sh';
const SERVICES=Object.freeze({
  selfmaint:'prhm-agent-selfmaint.service',
  executor:'prhm-agent-selfmaint-exec.service'
});
const EXEC_SOCKET='/run/prhm-agent-selfmaint-exec/exec.sock';

function fail(code){throw new Error(code);}
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function run(bin,args,opts={}){
  const r=cp.spawnSync(bin,args,{
    encoding:'utf8',
    timeout:opts.timeout||120000,
    maxBuffer:opts.maxBuffer||1000000,
    cwd:opts.cwd,
    env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/nonexistent'}
  });
  if(r.error||r.status!==0)fail((opts.label||'command')+'_failed:'+String(r.stderr||r.stdout||r.error?.message||'').slice(-800));
  return String(r.stdout||'').trim();
}
function atomicWrite(file,bytes,{uid,gid,mode}={}){
  const dir=path.dirname(file);
  const tmp=path.join(dir,'.'+path.basename(file)+'.current-owner-'+process.pid+'-'+Date.now()+'.tmp');
  let fd;
  try{
    fd=fs.openSync(tmp,'wx',mode??0o600);
    fs.writeFileSync(fd,bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);fd=undefined;
    if(Number.isInteger(uid)&&Number.isInteger(gid))fs.chownSync(tmp,uid,gid);
    if(Number.isInteger(mode))fs.chmodSync(tmp,mode);
    fs.renameSync(tmp,file);
    const dfd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
    try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}
  }catch(error){
    try{if(fd!==undefined)fs.closeSync(fd);}catch{}
    try{fs.unlinkSync(tmp);}catch{}
    throw error;
  }
}
function writeJsonAtomic(file,obj,mode=0o600){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  atomicWrite(file,Buffer.from(JSON.stringify(obj,null,2)+'\n'),{uid:0,gid:0,mode});
}
function regularSnapshot(target){
  const st=fs.lstatSync(target);
  if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(target)!==target)fail('target_not_regular:'+target);
  const bytes=fs.readFileSync(target);
  return {target_path:target,bytes,sha256:sha256(bytes),uid:st.uid,gid:st.gid,mode:st.mode&0o7777,realpath:target,is_file:true,is_symlink:false};
}
function loadModules(baseDir=PRIVATE_DIR){
  return Object.freeze({
    manifest:require(path.join(baseDir,'current-owner-binding-manifest-v1.js')),
    core:require(path.join(baseDir,'current-owner-binding-refresh-v1.js')),
    systemd:require(path.join(baseDir,'current-owner-binding-systemd-v1.js'))
  });
}
function assertAllowedConsumerTarget(modules,target){
  const allowed=new Set(Object.values(modules.manifest.INITIAL_CONSUMER_PREIMAGES).map(x=>x.target_path));
  if(!allowed.has(target))fail('consumer_target_not_allowlisted');
}
function acquireLock(){
  fs.mkdirSync(STATE_ROOT,{recursive:true,mode:0o700});
  let fd;
  try{
    fd=fs.openSync(LOCK_PATH,'wx',0o600);
    fs.writeFileSync(fd,String(process.pid)+'\n');
    fs.fsyncSync(fd);
  }catch(error){
    try{if(fd!==undefined)fs.closeSync(fd);}catch{}
    if(error&&error.code==='EEXIST')fail('refresh_lock_held');
    throw error;
  }
  let released=false;
  return ()=>{
    if(released)return;
    released=true;
    try{fs.closeSync(fd);}catch{}
    try{fs.unlinkSync(LOCK_PATH);}catch(error){if(error.code!=='ENOENT')throw error;}
  };
}
function selfmaintHealth(){
  for(const service of [SERVICES.selfmaint,SERVICES.executor]){
    const state=run('/usr/bin/systemctl',['is-active',service],{timeout:20000,label:'service_health'});
    if(state!=='active')fail('service_not_active:'+service);
  }
  const st=fs.lstatSync(EXEC_SOCKET);
  if(!st.isSocket())fail('exec_socket_not_socket');
  return true;
}
function inventoryOwners(modules){
  return modules.manifest.OWNER_SPECS.map(spec=>modules.manifest.validateFileOwner(spec,fs));
}
function snapshotConsumer(modules,id,spec){
  if(!spec||modules.manifest.INITIAL_CONSUMER_PREIMAGES[id]!==spec)fail('consumer_spec_mismatch:'+id);
  const snap=regularSnapshot(spec.target_path);
  return {consumer_id:id,...snap};
}
function inspectDropin(modules){
  const file=modules.systemd.DROPIN;
  try{
    const st=fs.lstatSync(file);
    return {exists:true,is_file:st.isFile(),is_symlink:st.isSymbolicLink(),realpath:fs.realpathSync(file),content:fs.readFileSync(file,'utf8')};
  }catch(error){
    if(error.code==='ENOENT')return {exists:false};
    throw error;
  }
}
function probeWritable(dir){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const p=path.join(dir,'.probe-'+process.pid+'-'+Date.now());
  fs.writeFileSync(p,'probe\n',{flag:'wx',mode:0o600});
  fs.unlinkSync(p);
}
function syntaxCandidate(id,candidate){
  const ext=id==='v19_binding'?'.sh':'.js';
  const p=path.join(STATE_ROOT,'.syntax-'+id+'-'+process.pid+ext);
  fs.mkdirSync(STATE_ROOT,{recursive:true,mode:0o700});
  try{
    fs.writeFileSync(p,candidate.after_bytes,{flag:'wx',mode:0o600});
    if(id==='v19_binding')run('/usr/bin/bash',['-n',p],{timeout:30000,label:'candidate_syntax'});
    else run('/usr/local/bin/prhm-node',['--check',p],{timeout:30000,label:'candidate_syntax'});
  }finally{try{fs.unlinkSync(p);}catch{}}
}
function validateCandidate(modules,id,candidate){
  assertAllowedConsumerTarget(modules,candidate.target_path);
  if(!Buffer.isBuffer(candidate.after_bytes)||!/^[a-f0-9]{64}$/.test(candidate.after_sha256)||sha256(candidate.after_bytes)!==candidate.after_sha256)fail('candidate_digest_invalid:'+id);
  const text=candidate.after_bytes.toString('utf8');
  if(!text.includes('PRHM_CURRENT_OWNER_BINDING_V1'))fail('candidate_marker_missing:'+id);
  syntaxCandidate(id,candidate);
}
function persistCandidate(id,candidate,context){
  const dir=path.join(STATE_ROOT,'candidates',context.manifest.manifest_sha256);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  atomicWrite(path.join(dir,id+'.candidate'),candidate.after_bytes,{uid:0,gid:0,mode:0o600});
  writeJsonAtomic(path.join(dir,id+'.json'),{consumer_id:id,target_path:candidate.target_path,after_sha256:candidate.after_sha256,state:candidate.state});
}
function persistPreimage(id,preimage,context){
  const dir=path.join(BACKUP_ROOT,context.manifest.manifest_sha256);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const bytesPath=path.join(dir,id+'.preimage');
  const metaPath=path.join(dir,id+'.json');
  if(fs.existsSync(bytesPath)){
    if(sha256(fs.readFileSync(bytesPath))!==preimage.sha256)fail('persisted_preimage_sha_mismatch:'+id);
  }else{
    fs.writeFileSync(bytesPath,preimage.bytes,{flag:'wx',mode:0o600});
  }
  writeJsonAtomic(metaPath,{consumer_id:id,target_path:preimage.target_path,sha256:preimage.sha256,uid:preimage.uid,gid:preimage.gid,mode:preimage.mode});
}
function persistTransaction(tx,context){
  writeJsonAtomic(path.join(STATE_ROOT,'transactions',context.manifest.manifest_sha256+'.json'),tx);
}
function installDropin(modules,file,content){
  if(file!==modules.systemd.DROPIN||content!==modules.systemd.DROPIN_CONTENT)fail('dropin_contract_mismatch');
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o755});
  atomicWrite(file,Buffer.from(content),{uid:0,gid:0,mode:0o644});
}
function removeDropin(modules,file){
  if(file!==modules.systemd.DROPIN)fail('dropin_contract_mismatch');
  try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
}
function daemonReload(){run('/usr/bin/systemctl',['daemon-reload'],{timeout:60000,label:'daemon_reload'});}
function restartService(modules,service){
  if(service!==modules.systemd.SERVICE)fail('restart_service_not_allowlisted');
  run('/usr/bin/systemctl',['restart',service],{timeout:90000,label:'service_restart'});
  if(run('/usr/bin/systemctl',['is-active',service],{timeout:20000,label:'service_restart_health'})!=='active')fail('service_restart_inactive');
}
function show(service,prop){return run('/usr/bin/systemctl',['show',service,'-p',prop,'--value'],{timeout:20000,label:'systemd_show'});}
function effectiveState(modules){
  const service=modules.systemd.SERVICE;
  return {
    active_state:show(service,'ActiveState'),
    main_pid:Number(show(service,'MainPID')),
    read_write_paths:show(service,'ReadWritePaths'),
    protect_system:show(service,'ProtectSystem'),
    protect_home:show(service,'ProtectHome')
  };
}
function atomicReplace(modules,target,bytes,meta){
  assertAllowedConsumerTarget(modules,target);
  atomicWrite(target,bytes,meta);
}
function verifyFileSha(modules,target,expected){
  assertAllowedConsumerTarget(modules,target);
  const actual=sha256(fs.readFileSync(target));
  if(actual!==expected)fail('verify_file_sha_mismatch');
}
function verifyV19(){
  const out=run('/usr/local/bin/prhm-node',['--test',V19_TEST],{cwd:V19_WORKTREE,timeout:180000,label:'v19_contract',maxBuffer:2000000});
  if(!/# tests 17\b/.test(out)||!/# pass 17\b/.test(out)||!/# fail 0\b/.test(out))fail('v19_contract_not_17_green');
}
function verifyRegistry(modules,context){
  const spec=modules.manifest.INITIAL_CONSUMER_PREIMAGES.registry_bridge;
  const text=fs.readFileSync(spec.target_path,'utf8');
  if(!text.includes('PRHM_CURRENT_OWNER_BINDING_V1'))fail('registry_binding_marker_missing');
  const owner=context.manifest.owners.find(x=>x.id==='registry_base');
  if(!owner)fail('registry_base_owner_missing');
  const st=fs.lstatSync(owner.path);
  if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(owner.path)!==owner.path)fail('registry_base_not_regular');
  if(sha256(fs.readFileSync(owner.path))!==owner.sha256)fail('registry_base_owner_drift');
}
function verifyBaselineBackup(modules){
  modules.systemd.validateEffectiveState(effectiveState(modules));
  probeWritable(modules.systemd.BACKUP_ROOT);
}
function verifyRolling(){
  const raw=run('/usr/bin/bash',[V19_HELPER],{timeout:30000,label:'rolling_owner_validation'});
  let j;try{j=JSON.parse(raw);}catch{fail('rolling_owner_validation_json_invalid');}
  if(j.ok!==true||j.production_application_mutation!==false||j.database_mutation!==false)fail('rolling_owner_validation_invalid');
}
function verifyHook(modules,name,payload){
  if(name==='selfmaint_health')return selfmaintHealth();
  if(name==='v19_contract')return verifyV19();
  if(name==='registry_bootstrap_readiness')return verifyRegistry(modules,payload.context);
  if(name==='current_baseline_backup_readiness')return verifyBaselineBackup(modules);
  if(name==='rolling_refresh_owner_validation')return verifyRolling();
  fail('verification_hook_unknown:'+name);
}
function persistRollback(record){
  writeJsonAtomic(path.join(STATE_ROOT,'rollback-latest.json'),record);
}
function createDeps(modules){
  return Object.freeze({
    now:()=>new Date().toISOString(),
    acquireLock,
    selfmaintHealth,
    inventoryOwners:()=>inventoryOwners(modules),
    snapshotConsumer:(id,spec)=>snapshotConsumer(modules,id,spec),
    inspectDropin:()=>inspectDropin(modules),
    probeWritable,
    validateCandidate:(id,candidate)=>validateCandidate(modules,id,candidate),
    persistCandidate,
    persistPreimage,
    persistTransaction,
    installDropin:(file,content)=>installDropin(modules,file,content),
    removeDropin:file=>removeDropin(modules,file),
    daemonReload,
    restartService:service=>restartService(modules,service),
    effectiveState:()=>effectiveState(modules),
    atomicReplace:(target,bytes,meta,kind)=>atomicReplace(modules,target,bytes,meta,kind),
    verifyFileSha:(target,expected,kind)=>verifyFileSha(modules,target,expected,kind),
    verifyHook:(name,payload)=>verifyHook(modules,name,payload),
    persistRollback
  });
}
async function main(args=process.argv.slice(2)){
  const modules=loadModules();
  const out=await modules.core.runCli(args,createDeps(modules));
  process.stdout.write(JSON.stringify(out)+'\n');
  return out;
}
module.exports=Object.freeze({
  ACTION,PRIVATE_DIR,STATE_ROOT,BACKUP_ROOT,LOCK_PATH,V19_WORKTREE,V19_TEST,V19_HELPER,SERVICES,EXEC_SOCKET,
  sha256,loadModules,createDeps,regularSnapshot,acquireLock,selfmaintHealth,inventoryOwners,snapshotConsumer,
  inspectDropin,probeWritable,validateCandidate,persistCandidate,persistPreimage,persistTransaction,installDropin,
  removeDropin,daemonReload,restartService,effectiveState,atomicReplace,verifyFileSha,verifyHook,persistRollback,main
});
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({ok:false,action:ACTION,error:String(error&&error.message||error)}));process.exit(1);});
