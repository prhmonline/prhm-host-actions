'use strict';
/**
 * Emergency one-shot Solo Company Runtime installation from an already verified
 * immutable release, authorized by the infrastructure owner. NOT a Provider
 * Root-of-Trust signed action, nor a means to patch Host Actions V2 registries.
 *
 * Only fixed paths, source SHA and release SHA. No shell, arbitrary options,
 * remote source, user path, token argument, or private-key handling.
 *
 * The original runtime install core supplies phase-aware rollback and
 * release-integrity + MCP integration checks. This wrapper adds a durable
 * operator audit and verifies the installation outcome. Crash recovery still
 * requires a separate operator-controlled check; never claim otherwise.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const {pathToFileURL}=require('node:url');

const SOURCE='/var/tmp/solo-runtime-sshagent-review-20261103/mcp-server/src/plugins/soloCompanyRuntimeInstallCore.js';
const GIT_ROOT='/var/tmp/solo-runtime-sshagent-review-20261103';
const SOURCE_COMMIT='02966549a751c16b582ce17d15a1e2cf8a22f0fb';
const SOURCE_SHA256='a93abca70f158729e0e22d39717a6e10a4025b18c44bf60a774ce3bf63fa41dd';
const RELEASE_SHA='0eb43d72aab3f10db22172c8be4c0411cf22d074';
const JOURNAL_DIR='/var/lib/prhm-agent-selfmaint-exec/solo-emergency-operator-v1';
const APP='/opt/prhm-solo-company';
const UNIT='/etc/systemd/system/prhm-solo-company-runtime.service';
const CREDENTIAL='/etc/prhm-solo-company/agent2.bearer';
const STATE='/var/lib/prhm-solo-company';
const STATE_FILE=path.join(STATE,'state.json');
const fnHash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=c=>{throw Object.assign(new Error(c),{code:c})};
function exactFile(file){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(file)!==file||
    st.uid!==0||(st.mode&0o022)!==0)fail('untrusted_source_metadata');
  return fs.readFileSync(file);
}
function sourcePreflight(){
  const bytes=exactFile(SOURCE);
  if(fnHash(bytes)!==SOURCE_SHA256)fail('source_sha_mismatch');
  const r=cp.spawnSync('/usr/bin/git',['-C',GIT_ROOT,'rev-parse','HEAD'],{
    timeout:10000,encoding:'utf8',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
  if(r.error||r.status!==0||String(r.stdout).trim()!==SOURCE_COMMIT)fail('source_git_commit_mismatch');
  const files=[APP,UNIT,CREDENTIAL,STATE_FILE];
  if(files.some(f=>fs.existsSync(f)))fail('existing_install_conflict');
  const stage=path.dirname(CREDENTIAL);
  if(fs.existsSync(stage)){
    const stat=fs.lstatSync(stage);
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||
      (stat.mode&0o077)!==0||fs.readdirSync(stage).length>0)
      fail('config_directory_not_empty_or_unsafe');
  }
  return bytes;
}
function audit(record){
  fs.mkdirSync(JOURNAL_DIR,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(JOURNAL_DIR);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||
    (stat.mode&0o077)!==0)fail('audit_directory_unsafe');
  const name='operator-'+Date.now()+'-'+process.pid+'.json';
  const fd=fs.openSync(path.join(JOURNAL_DIR,name),'wx',0o600);
  try{fs.writeSync(fd,Buffer.from(JSON.stringify(record)+'\n'));fs.fsyncSync(fd)}
  finally{fs.closeSync(fd)}
  const dir=fs.openSync(JOURNAL_DIR,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
  try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}
}


function compatibilitySource(input){
  if(!Buffer.isBuffer(input))fail('compatibility_inputs_invalid');
  let s=input.toString('utf8');
  const once=(before,after,label)=>{
    if(s.split(before).length!==2)fail('compatibility_anchor_missing_'+label);
    s=s.replace(before,after);
  };
  once("LoadCredential=agent2_bearer:/etc/prhm-solo-company/agent2.bearer",[
    "RuntimeDirectory=prhm-solo-company",
    "RuntimeDirectoryMode=0700",
    "ExecStartPre=+/usr/bin/install -m 0400 /etc/prhm-solo-company/agent2.bearer /run/prhm-solo-company/agent2_bearer",
    "ExecStartPre=+/usr/bin/chown --reference=/run/prhm-solo-company /run/prhm-solo-company/agent2_bearer",
    "Environment=CREDENTIALS_DIRECTORY=/run/prhm-solo-company"
  ].join('\n'),'legacy_credentials');
  once("RestrictSUIDSGID=true\nLockPersonality=true",
    "LockPersonality=true",'unsupported_setting');
  once("phase='stage_promote';fs.renameSync(stage,APP_DIR);",
    "phase='stage_promote';secureStagePermissions(stage);fs.renameSync(stage,APP_DIR);",
    'readable_runtime_tree');
  return s;
}
function preflight(){
  if(process.getuid?.()!==0)fail('root_required');
  sourcePreflight();
  return Object.freeze({ok:true,mode:'operator_emergency_preflight',
    source_commit:SOURCE_COMMIT,source_sha256:SOURCE_SHA256,
    release_sha:RELEASE_SHA,production_mutation:false});
}
async function apply(){
  if(process.getuid?.()!==0||process.env.INVOCATION_ID===undefined)
    fail('transient_root_systemd_required');
  if(process.env.PORT!=='8123')fail('mcp_port_mismatch');
  const bearer=String(process.env.MCP_BEARER_TOKEN||process.env.ACTION_API_KEY||'').trim();
  if(bearer.length<8)fail('mcp_bearer_not_provisioned_in_systemd_unit');
  const bytes=sourcePreflight();
  const adapted=compatibilitySource(bytes);
  audit({schema:'prhm.solo.operator-emergency.v1',status:'STARTED',
    authorization:'explicit-owner-chat-2026-11-03',release_sha:RELEASE_SHA,
    source_commit:SOURCE_COMMIT,source_sha256:SOURCE_SHA256,
    started_at:new Date().toISOString(),provider_signed:false});
  let snapshot=null;
  try{
    snapshot=fs.mkdtempSync('/run/prhm-solo-emergency-core-');
    fs.chmodSync(snapshot,0o700);
    // The appended function is a narrow, explicitly operator-authorized
    // alternative to the separate signed-L4 Root Action entrypoint.
    const addition=[
      "",
      "function secureStagePermissions(stage){",
      " const root=path.resolve(stage);",
      " if(!root.startsWith('/var/lib/prhm-agent-selfmaint-exec/solo-company-runtime-install-v1/stage/')) throw new Error('unsafe_stage_root');",
      " function walk(p){",
      "  const st=fs.lstatSync(p);",
      "  if(st.isSymbolicLink()){const target=fs.realpathSync(p);if(!target.startsWith(root+'/'))throw new Error('stage_symlink_escape');return;}",
      "  if(st.isDirectory()){fs.chmodSync(p,0o755);for(const x of fs.readdirSync(p))walk(path.join(p,x));return;}",
      "  if(st.isFile()){fs.chmodSync(p,0o644);return;}",
      "  throw new Error('unexpected_stage_file_type');",
      " }",
      " walk(root);",
      "}",
      "",
      "export async function runOwnerAuthorizedEmergencyV1(){",
      " if(process.getuid?.()!==0||process.env.PORT!=='8123'||!process.env.INVOCATION_ID)",
      "  throw new Error('emergency_operator_context_invalid');",
      " return performInstall(crypto.randomUUID());",
      "}",
      ""
    ].join('\n');
    const core=path.join(snapshot,'solo-core.mjs');
    fs.writeFileSync(core,Buffer.concat([Buffer.from(adapted),Buffer.from(addition)]),{mode:0o600,flag:'wx'});
    const mod=await import(pathToFileURL(core).href);
    if(mod.RELEASE_SHA!==RELEASE_SHA||typeof mod.runOwnerAuthorizedEmergencyV1!=='function')
      fail('runtime_core_binding_invalid');
    const result=await mod.runOwnerAuthorizedEmergencyV1();
    if(result?.ok!==true||result.release_sha!==RELEASE_SHA||
      result.service_active!==true||result.service_enabled!==true||
      result.runtime?.queue_total!==0||result.dark_mode?.schedules!==0||
      result.dark_mode?.descriptors!==0||result.dark_mode?.mutation_allowlist!==0)
      fail('runtime_postinstall_evidence_invalid');
    if(fs.readFileSync(path.join(APP,'.release-sha'),'utf8').trim()!==RELEASE_SHA)
      fail('installed_release_sha_mismatch');
    audit({schema:'prhm.solo.operator-emergency.v1',status:'SUCCEEDED',
      authorization:'explicit-owner-chat-2026-11-03',release_sha:RELEASE_SHA,
      source_commit:SOURCE_COMMIT,finished_at:new Date().toISOString(),
      provider_signed:false,service_active:true,service_enabled:true,
      queues:0,schedules:0,descriptors:0,mutation_allowlist:0});
    return {ok:true,status:'SUCCEEDED',release_sha:RELEASE_SHA,
      service_active:true,service_enabled:true,dark_mode:true};
  }catch(e){
    const code=typeof e.code==='string' && /^[a-z0-9_]{1,100}$/.test(e.code)
      ?e.code:'emergency_install_failed';
    try{audit({schema:'prhm.solo.operator-emergency.v1',status:'FAILED',
      release_sha:RELEASE_SHA,finished_at:new Date().toISOString(),
      error_code:code,rollback_reported:e.rollback_performed===true,
      provider_signed:false})}catch(_){}
    throw Object.assign(new Error(code),{code});
  }finally{
    if(snapshot)fs.rmSync(snapshot,{recursive:true,force:true});
  }
}
if(require.main===module){
  (async()=>{
    if(process.argv.length===3&&process.argv[2]==='--preflight')return preflight();
    if(process.argv.length===3&&process.argv[2]==='--apply')return apply();
    fail('unsupported_fixed_mode');
  })().then(x=>console.log(JSON.stringify(x))).catch(e=>{
    console.error('SOLO_EMERGENCY_RESULT='+String(e.code||'failed'));
    process.exitCode=21;
  });
}
module.exports={SOURCE,SOURCE_SHA256,SOURCE_COMMIT,RELEASE_SHA,JOURNAL_DIR,fnHash,
  preflight,sourcePreflight,compatibilitySource,apply};
