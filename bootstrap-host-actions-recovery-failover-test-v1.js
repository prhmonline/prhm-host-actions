'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

const TARGET_ACTION = 'recovery_failover_test_v1';
const OPERATION = 'host_action.recovery_failover_test_v1';
const INSTALLER_ACTION = 'recovery_failover_test_v1_installer_v1';
const SOURCE_REPO = '/home/prhm/worktrees/prhm-host-actions';
const SOURCE_REMOTE = 'origin';
const SOURCE_BRANCH = 'feature/recovery-failover-test-v1';
const WORKTREE = '/home/prhm/worktrees/prhm-host-actions-recovery-failover-v1';
const CORE_FILE = 'recovery-failover-test-v1.js';
const TEST_FILE = 'test-recovery-failover-test-v1.js';
const SECOND_TEST_FILE = 'test-recovery-preflight-restart-v1.js';
const BOOTSTRAP_FILE = 'bootstrap-host-actions-recovery-failover-test-v1.js';
const EXPECTED_SOURCE_BLOBS = Object.freeze({
  [CORE_FILE]: 'cf85b1c244da63d406f11b45276ab53e2ad0141a',
  [TEST_FILE]: '072b6d69fc3c0b4b534e1665db7dc640b7ddf3d3',
  [SECOND_TEST_FILE]: '4044ce71a1adb7f07a5bda74bc5e92536890391e',
});
const EXPECTED_SERVER_SHA = '5a8f3a391145452a9c70a7fbe227903e482829a409bc6c1a960bf4ce56d52472';
const PREIMAGE = Object.freeze({
  base: '981a430f5448a1b0dc3c25886756ecf7cd655352660bb49905ab2650a131d764',
  executor: '451c5a4762a4c7a04d64d526a79cf6e86b0cf7c978c559cf303d874e0f08fc48',
  policy: '494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70',
  mcp: '703a8f8ee0726fac47d008a69c759e3f52254c980cf551ea3f2660cc46321283',
});
const PATHS = Object.freeze({
  base: '/opt/prhm-agent-selfmaint/server.js',
  executor: '/opt/prhm-agent-selfmaint-exec/server.js',
  policy: '/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp: '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  helper: '/opt/prhm-agent-selfmaint-exec/actions/recovery-failover-test-v1.js',
  result: '/var/lib/prhm-agent-selfmaint-exec/recovery-failover-test-v1/latest.json',
  installResult: '/var/lib/prhm-agent-selfmaint-exec/recovery-failover-test-v1-installer-v1/latest.json',
  backupRoot: '/var/backups/prhm-recovery-failover-test-v1-installer',
});
const SERVICES = Object.freeze([
  'prhm-company-approval.service',
  'prhm-agent-selfmaint.service',
  'prhm-agent-selfmaint-exec.service',
  'prhm-agent-mcp.service',
]);

function fail(code) { throw new Error(code); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function shaFile(file) { return sha256(fs.readFileSync(file)); }
function count(haystack, needle) { return haystack.split(needle).length - 1; }
function replaceOnce(source, before, after, label) {
  const n = count(source, before);
  if (n !== 1) fail(`patch_anchor_mismatch:${label}:${n}`);
  return source.replace(before, after);
}
function exec(file, args, opts = {}) {
  return cp.execFileSync(file, args, {
    encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:opts.timeout || 120000,
    maxBuffer:1000000, ...(opts.cwd ? {cwd:opts.cwd} : {}),
  }).trim();
}
function atomicWrite(file, bytes, mode) {
  fs.mkdirSync(path.dirname(file), {recursive:true, mode:0o755});
  const tmp = `${file}.candidate-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, bytes, {flag:'wx', mode});
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

function patchBase(source) {
  const before = "  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' }\n});";
  const after = "  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' },\n  recovery_failover_test_v1: { operation: 'host_action.recovery_failover_test_v1', rollback: 'host-action-v2:recovery-failover-test-v1:router-restart' }\n});";
  return replaceOnce(source, before, after, 'base_registry');
}

function executorRunnerSource() {
  return `const RECOVERY_FAILOVER_TEST_V1_HELPER='${PATHS.helper}';\nconst RECOVERY_FAILOVER_TEST_V1_RESULT='${PATHS.result}';\nfunction applyRecoveryFailoverTestV1(){\n  if(!fs.existsSync(RECOVERY_FAILOVER_TEST_V1_HELPER))throw new Error('recovery_failover_helper_missing');\n  try{fs.unlinkSync(RECOVERY_FAILOVER_TEST_V1_RESULT)}catch(e){if(e.code!=='ENOENT')throw e}\n  const unit='prhm-recovery-failover-test-v1-'+Date.now();\n  const args=['--wait','--collect','--unit='+unit,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=PrivateDevices=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','--property=ReadWritePaths=/var/lib/prhm-agent-selfmaint-exec/recovery-failover-test-v1','--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',RECOVERY_FAILOVER_TEST_V1_HELPER];\n  cp.execFileSync('/usr/bin/systemd-run',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000});\n  const r=readJson(RECOVERY_FAILOVER_TEST_V1_RESULT);\n  if(r.ok!==true||r.action!=='recovery_failover_test_v1'||r.schema_version!=='prhm.host-action-result.v1'||r.router_restarted!==true||![8124,8125].includes(Number(r.active_lane))||r.live_sha!=='${EXPECTED_SERVER_SHA}'||r.rollback_performed!==false)throw new Error('recovery_failover_result_invalid');\n  return r;\n}\n`;
}

function patchExecutor(source) {
  let s = replaceOnce(
    source,
    "  imotion_credential_bind_v1:{operation:'host_action.imotion_credential_bind_v1',kind:'imotion_credential_bind_v1'}\n});",
    "  imotion_credential_bind_v1:{operation:'host_action.imotion_credential_bind_v1',kind:'imotion_credential_bind_v1'},\n  recovery_failover_test_v1:{operation:'host_action.recovery_failover_test_v1',kind:'recovery_failover_test_v1'}\n});",
    'executor_registry'
  );
  const helperAnchor = "const ROOT_SCRIPTS_FIXED_STAGE_HELPER='/opt/prhm-agent-selfmaint-exec/actions/root-scripts-fixed-stage-v1.js';";
  s = replaceOnce(s, helperAnchor, executorRunnerSource() + helperAnchor, 'executor_runner');
  const dispatch = "applyHostActionV2=async function(action){if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();";
  s = replaceOnce(s, dispatch, "applyHostActionV2=async function(action){if(action==='recovery_failover_test_v1')return applyRecoveryFailoverTestV1();if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();", 'executor_dispatch');
  return s;
}

function patchPolicy(source) {
  const p = JSON.parse(source);
  if (!p.operations || !Array.isArray(p.typed_scopes)) fail('policy_shape_invalid');
  if (p.operations[OPERATION] || p.typed_scopes.some(x => x && x.action === TARGET_ACTION)) fail('policy_target_already_exists');
  p.operations[OPERATION] = {level:4};
  p.typed_scopes.push({
    tool:'host_action_v2_apply', project:'control_plane', environment:'production',
    action:TARGET_ACTION, risk:'critical', operation:OPERATION,
    principals:[{principal_id:'mohammad', roles:['mcp-operator']}],
  });
  return JSON.stringify(p, null, 2) + '\n';
}

function patchMcp(source) {
  const before = "'imotion_credential_bind_v1','control_plane_root_scripts_stage_transport_v1']);";
  const after = "'imotion_credential_bind_v1','control_plane_root_scripts_stage_transport_v1','recovery_failover_test_v1']);";
  return replaceOnce(source, before, after, 'mcp_enum');
}

function runtimeSuffix() {
  return `\n\n/* fixed production adapter; generated by ${BOOTSTRAP_FILE} */\nif(require.main===module){\n  const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto'),path=require('node:path');\n  const STATE='/var/lib/prhm-agent-zdt/mcp-active';\n  const LIVE='/home/agent/ssh-mcp-server/server.js';\n  const BACKUP='/var/backups/prhm-agent-selfmaint/agent_mcp-server.js-20260914182918-${EXPECTED_SERVER_SHA}.bak';\n  const RECOVERY_HEALTH='http://10.71.0.118:8140/health';\n  const AGENT2_HEALTH='http://127.0.0.1:8100/health';\n  const RESULT='${PATHS.result}';\n  const digest=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');\n  const command=(bin,args,allow=false)=>{const r=cp.spawnSync(bin,args,{encoding:'utf8',timeout:10000,maxBuffer:100000});if(r.error||(!allow&&r.status!==0))throw new Error('fixed_command_failed:'+args[0]);return (r.stdout||'').trim()};\n  const curlJson=url=>{const raw=command('/usr/bin/curl',['-fsS','--max-time','3',url]);const j=JSON.parse(raw);if(!j||j.ok!==true)throw new Error('health_not_ok');return j};\n  const active=service=>command('/usr/bin/systemctl',['is-active',service],true)==='active';\n  const recoveryStatus=()=>{const h=curlJson(RECOVERY_HEALTH);if(h.service!=='prhm-recovery-agent')throw new Error('recovery_identity_mismatch');return {ok:true,active_lane:Number(fs.readFileSync(STATE,'utf8').trim()),services:{blue:{active:active(SERVICES.blue),service:SERVICES.blue,state:active(SERVICES.blue)?'active':'inactive'},green:{active:active(SERVICES.green),service:SERVICES.green,state:active(SERVICES.green)?'active':'inactive'},router:{active:active(SERVICES.router),service:SERVICES.router,state:active(SERVICES.router)?'active':'inactive'},watchdog:{active:active(SERVICES.watchdog),service:SERVICES.watchdog,state:active(SERVICES.watchdog)?'active':'inactive'}},live_sha256:digest(LIVE),approved_backup_sha256:digest(BACKUP)}};\n  const restartRouter=()=>{command('/usr/bin/systemctl',['restart',SERVICES.router]);};\n  const deps={recoveryStatus,stopRouter:()=>{command('/usr/bin/systemctl',['stop',SERVICES.router]);},restartRouter,routerActive:()=>active(SERVICES.router),agent2Health:()=>{const j=curlJson(AGENT2_HEALTH);if(j.service!=='ssh-agent-api')throw new Error('agent2_identity_mismatch');return j;}};\n  const persist=r=>{fs.mkdirSync(path.dirname(RESULT),{recursive:true,mode:0o700});const t=RESULT+'.tmp-'+process.pid;fs.writeFileSync(t,JSON.stringify(r,null,2)+'\\n',{mode:0o600,flag:'wx'});fs.renameSync(t,RESULT);};\n  try{if(process.argv.length!==2)throw new Error('unexpected_arguments');if(process.getuid&&process.getuid()!==0)throw new Error('root_required');const r=apply(deps);const out={...r,schema_version:'prhm.host-action-result.v1'};persist(out);process.stdout.write(JSON.stringify(out)+'\\n');}\n  catch(e){try{restartRouter()}catch(rb){e=new Error('rollback_restart_failed:'+String(rb.message||rb)+':original:'+String(e.message||e))}process.stderr.write(String(e.stack||e)+'\\n');process.exit(1);}\n}\n`;
}

function buildHelper(coreSource) {
  if (!coreSource.includes("const ACTION = 'recovery_failover_test_v1'")) fail('core_identity_mismatch');
  if (!coreSource.includes(EXPECTED_SERVER_SHA)) fail('core_sha_binding_missing');
  return coreSource + runtimeSuffix();
}

function buildCandidates(readFile = f => fs.readFileSync(f, 'utf8')) {
  for (const [k, expected] of Object.entries(PREIMAGE)) {
    if (!fs.existsSync(PATHS[k])) fail('baseline_missing:'+k);
    const actual = shaFile(PATHS[k]);
    if (actual !== expected) fail(`baseline_drift:${k}:${actual}`);
  }
  const corePath = path.join(WORKTREE, CORE_FILE);
  const core = readFile(corePath);
  return {
    base: Buffer.from(patchBase(readFile(PATHS.base))),
    executor: Buffer.from(patchExecutor(readFile(PATHS.executor))),
    policy: Buffer.from(patchPolicy(readFile(PATHS.policy))),
    mcp: Buffer.from(patchMcp(readFile(PATHS.mcp))),
    helper: Buffer.from(buildHelper(core)),
  };
}

function prepareWorktree() {
  if (!fs.existsSync(path.join(SOURCE_REPO, '.git'))) fail('source_repo_missing');
  exec('/usr/bin/git', ['-C', SOURCE_REPO, 'fetch', '--no-tags', SOURCE_REMOTE, SOURCE_BRANCH], {timeout:180000});
  const remoteRef = `${SOURCE_REMOTE}/${SOURCE_BRANCH}`;
  if (!fs.existsSync(WORKTREE)) {
    exec('/usr/bin/git', ['-C', SOURCE_REPO, 'worktree', 'add', '-B', SOURCE_BRANCH, WORKTREE, remoteRef], {timeout:120000});
  }
  const top = exec('/usr/bin/git', ['-C', WORKTREE, 'rev-parse', '--show-toplevel']);
  if (top !== WORKTREE) fail('worktree_identity_mismatch');
  const branch = exec('/usr/bin/git', ['-C', WORKTREE, 'branch', '--show-current']);
  if (branch !== SOURCE_BRANCH) fail('worktree_branch_mismatch');
  const dirty = exec('/usr/bin/git', ['-C', WORKTREE, 'status', '--porcelain']);
  if (dirty) fail('worktree_dirty');
  const localHead = exec('/usr/bin/git', ['-C', WORKTREE, 'rev-parse', 'HEAD']);
  const remoteHead = exec('/usr/bin/git', ['-C', WORKTREE, 'rev-parse', remoteRef]);
  if (localHead !== remoteHead) fail('worktree_head_mismatch');
  for (const f of [CORE_FILE, TEST_FILE, SECOND_TEST_FILE, BOOTSTRAP_FILE]) if (!fs.existsSync(path.join(WORKTREE, f))) fail('worktree_artifact_missing:'+f);
  for (const [file, expectedBlob] of Object.entries(EXPECTED_SOURCE_BLOBS)) {
    const actualBlob = exec('/usr/bin/git', ['-C', WORKTREE, 'hash-object', file]);
    if (actualBlob !== expectedBlob) fail(`source_blob_drift:${file}:${actualBlob}`);
  }
  return {repo:SOURCE_REPO, worktree:WORKTREE, branch:SOURCE_BRANCH, head:localHead, clean:true, source_blobs:EXPECTED_SOURCE_BLOBS};
}

function runContracts() {
  exec('/usr/local/bin/prhm-node', ['--test', TEST_FILE, SECOND_TEST_FILE], {timeout:120000, cwd:WORKTREE});
  exec('/usr/local/bin/prhm-node', [BOOTSTRAP_FILE, '--selftest-only'], {timeout:120000, cwd:WORKTREE});
  return true;
}

function verifySyntax(candidates) {
  const tmpDir = fs.mkdtempSync('/tmp/prhm-recovery-installer-');
  try {
    const files = {base:'base.cjs',executor:'executor.cjs',mcp:'mcp.mjs',helper:'helper.cjs'};
    for (const [k,n] of Object.entries(files)) {
      const p=path.join(tmpDir,n); fs.writeFileSync(p,candidates[k],{mode:0o600});
      exec('/usr/local/bin/prhm-node',['--check',p]);
    }
    JSON.parse(candidates.policy.toString('utf8'));
  } finally { fs.rmSync(tmpDir,{recursive:true,force:true}); }
}

function preflight() {
  const worktree = prepareWorktree();
  runContracts();
  const candidates = buildCandidates();
  verifySyntax(candidates);
  return {ok:true,action:INSTALLER_ACTION,target_action:TARGET_ACTION,preflight_only:true,production_mutation:false,worktree,preimage_sha256:PREIMAGE,candidate_sha256:Object.fromEntries(Object.entries(candidates).map(([k,v])=>[k,sha256(v)])),contract_green:true,level:4,risk:'critical'};
}

function backupOriginals() {
  const dir=path.join(PATHS.backupRoot,new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const states={};
  for(const k of ['base','executor','policy','mcp']){const st=fs.statSync(PATHS[k]);const b=fs.readFileSync(PATHS[k]);const dest=path.join(dir,k+'.bak');fs.writeFileSync(dest,b,{mode:0o600,flag:'wx'});states[k]={path:PATHS[k],backup:dest,mode:st.mode&0o777,sha256:sha256(b),existed:true};}
  const helperExists=fs.existsSync(PATHS.helper); states.helper={path:PATHS.helper,existed:helperExists};
  if(helperExists){const st=fs.statSync(PATHS.helper),b=fs.readFileSync(PATHS.helper),dest=path.join(dir,'helper.bak');fs.writeFileSync(dest,b,{mode:0o600,flag:'wx'});states.helper={...states.helper,backup:dest,mode:st.mode&0o777,sha256:sha256(b)}}
  return {dir,states};
}

function restartServices() {
  for(const service of SERVICES){exec('/usr/bin/systemctl',['restart',service],{timeout:90000});const state=exec('/usr/bin/systemctl',['is-active',service]);if(state!=='active')fail('service_not_active:'+service);}
}
function rollback(backup, mutated) {
  const errors=[];
  for(const k of [...mutated].reverse()) try {
    const st=backup.states[k];
    if(k==='helper'&&!st.existed){try{fs.unlinkSync(PATHS.helper)}catch(e){if(e.code!=='ENOENT')throw e};continue;}
    const b=fs.readFileSync(st.backup); if(sha256(b)!==st.sha256)fail('backup_sha_mismatch:'+k); atomicWrite(st.path,b,st.mode);
  } catch(e){errors.push(k+':'+String(e.message||e));}
  try{restartServices()}catch(e){errors.push('restart:'+String(e.message||e));}
  if(errors.length) fail('rollback_failed:'+errors.join('|'));
  return true;
}

function applyInstaller() {
  const pf=preflight();
  const candidates=buildCandidates();
  const backup=backupOriginals();
  const mutated=[];
  try {
    const order=['helper','base','executor','policy','mcp'];
    for(const k of order){mutated.push(k);const mode=k==='helper'?0o750:fs.statSync(PATHS[k]).mode&0o777;atomicWrite(PATHS[k],candidates[k],mode);if(shaFile(PATHS[k])!==sha256(candidates[k]))fail('post_write_sha_mismatch:'+k);}
    restartServices();
    const out={ok:true,action:INSTALLER_ACTION,target_action:TARGET_ACTION,schema_version:'prhm.host-action-bootstrap-result.v1',installed:true,level:4,risk:'critical',worktree:pf.worktree,contract_green:true,production_application_mutation:false,database_mutation:false,router_test_executed:false,rollback_performed:false,backup_dir:backup.dir,post_install_sha256:Object.fromEntries(['helper','base','executor','policy','mcp'].map(k=>[k,shaFile(PATHS[k])]))};
    atomicWrite(PATHS.installResult,Buffer.from(JSON.stringify(out,null,2)+'\n'),0o600);return out;
  } catch(e) { rollback(backup,mutated); throw new Error('install_failed_rolled_back:'+String(e.message||e)); }
}

function selftest() {
  for(const h of Object.values(PREIMAGE)) if(!/^[a-f0-9]{64}$/.test(h)) fail('invalid_preimage_sha');
  for(const h of Object.values(EXPECTED_SOURCE_BLOBS)) if(!/^[a-f0-9]{40}$/.test(h)) fail('invalid_source_blob');
  if(TARGET_ACTION!=='recovery_failover_test_v1'||OPERATION!=='host_action.recovery_failover_test_v1') fail('identity_drift');
  if(WORKTREE!=='/home/prhm/worktrees/prhm-host-actions-recovery-failover-v1'||SOURCE_BRANCH!=='feature/recovery-failover-test-v1') fail('worktree_scope_drift');
  if(PATHS.helper!=='/opt/prhm-agent-selfmaint-exec/actions/recovery-failover-test-v1.js') fail('helper_path_drift');
  const baseFixture="  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' }\n});";
  if(count(patchBase(baseFixture),TARGET_ACTION)!==2) fail('base_patch_selftest_failed');
  const mcpFixture="const X=z.enum(['imotion_credential_bind_v1','control_plane_root_scripts_stage_transport_v1']);";
  if(count(patchMcp(mcpFixture),TARGET_ACTION)!==1) fail('mcp_patch_selftest_failed');
  const policy=patchPolicy(JSON.stringify({operations:{},typed_scopes:[]}));const parsed=JSON.parse(policy);if(parsed.operations[OPERATION].level!==4||parsed.typed_scopes[0].risk!=='critical')fail('policy_patch_selftest_failed');
  const suffix=runtimeSuffix();
  for(const fixed of ['http://10.71.0.118:8140/health','http://127.0.0.1:8100/health',EXPECTED_SERVER_SHA]) if(!suffix.includes(fixed)) fail('runtime_binding_missing');
  if(!suffix.includes('SERVICES.router')) fail('runtime_router_binding_missing');
  if(!suffix.includes("process.argv.length!==2")) fail('runtime_argument_guard_missing');
  if(!String(exec).includes('cwd:opts.cwd')) fail('contract_cwd_guard_missing');
  return {ok:true,action:INSTALLER_ACTION,target_action:TARGET_ACTION,selftest_only:true,level:4,risk:'critical',arbitrary_command:false,arbitrary_path:false,arbitrary_service:false};
}

function main(argv=process.argv.slice(2)) {
  if(argv.length!==1||!['--selftest-only','--preflight-only','--apply'].includes(argv[0])) fail('unexpected_arguments');
  const out=argv[0]==='--selftest-only'?selftest():argv[0]==='--preflight-only'?preflight():applyInstaller();
  process.stdout.write(JSON.stringify(out)+'\n'); return out;
}
if(require.main===module){try{main()}catch(e){process.stderr.write(String(e.stack||e)+'\n');process.exit(1)}}
module.exports={TARGET_ACTION,OPERATION,INSTALLER_ACTION,SOURCE_REPO,SOURCE_BRANCH,WORKTREE,EXPECTED_SOURCE_BLOBS,PREIMAGE,PATHS,patchBase,patchExecutor,patchPolicy,patchMcp,runtimeSuffix,buildHelper,prepareWorktree,preflight,applyInstaller,selftest};
