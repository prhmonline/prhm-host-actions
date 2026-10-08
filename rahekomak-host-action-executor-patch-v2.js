'use strict';

/**
 * Development-only source transform for the RahKomak Host Actions executor.
 * Does not read or write a production path; an independently approved,
 * SHA-bound installation transaction must apply any generated candidate.
 */
const OLD_HEAD = '77c0d0f38f2c64be02e46eeec6f6e19eedc1f1b5';
const OLD_HELPER_SHA = 'bba9636d705b41cf11086f1e962a8ac31b7a831bd3d1913e641633cfacd4dab4';
const RELEASE_HEAD = '7f2ea82b0865bb64c8adbc3192e8547fe4f43c25';
const HELPER_SHA = 'd61140507300b4e2fc6650f2fc5e4b769543d9937dd2ff58574827af9c40696f';
const WORKER_GIT_BLOB_SHA = '6b8df4e4d5e2d7c057251e58717c5b00d5307287';
const START = "const RAHEKOMAK_DEPLOY_ROOT='/home/prhm/projects/generated/rahekomak';";
const END = 'const applyHostActionV2Original=applyHostActionV2;';

function fail(msg) { throw new Error(msg); }
function occurrences(haystack, needle) { return haystack.split(needle).length - 1; }

/*
 * All reads of /home are delegated to an isolated systemd worker.
 * The resident service still has ProtectHome=yes and cannot access /home.
 */
function replacement() {
  return [
    "const RAHEKOMAK_DEPLOY_ROOT='/home/prhm/projects/generated/rahekomak';",
    "const RAHEKOMAK_DEPLOY_HELPER='/home/prhm/projects/generated/rahekomak/infra/docker/production-deploy-v1.cjs';",
    "const RAHEKOMAK_DEPLOY_HEAD='" + RELEASE_HEAD + "';",
    "const RAHEKOMAK_DEPLOY_HELPER_SHA='" + HELPER_SHA + "';",
    "const RAHEKOMAK_DEPLOY_WORKER='/opt/prhm-agent-selfmaint-exec/actions/rahekomak-production-deploy-worker-v2.js';",
    "const RAHEKOMAK_DEPLOY_WORKER_GIT_BLOB='" + WORKER_GIT_BLOB_SHA + "';",
    "function applyRahKomakProductionDeployV1(){",
    "  const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');",
    "  const st=fs.lstatSync(RAHEKOMAK_DEPLOY_WORKER);",
    "  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(RAHEKOMAK_DEPLOY_WORKER)!==RAHEKOMAK_DEPLOY_WORKER)throw new Error('rahekomak_worker_invalid');",
    "  const bytes=fs.readFileSync(RAHEKOMAK_DEPLOY_WORKER);",
    "  const digest=crypto.createHash('sha1').update('blob '+bytes.length+'\\\\0').update(bytes).digest('hex');",
    "  if(digest!==RAHEKOMAK_DEPLOY_WORKER_GIT_BLOB)throw new Error('rahekomak_worker_git_blob_mismatch');",
    "  const nonce=crypto.randomBytes(16).toString('hex');",
    "  const preflight=runRahKomakBoundWorker('--preflight',nonce,cp,fs);",
    "  if(preflight.ok!==true||preflight.deploy?.expected_head!==RAHEKOMAK_DEPLOY_HEAD)throw new Error('rahekomak_preflight_failed');",
    "  const applied=runRahKomakBoundWorker('--apply',nonce,cp,fs);",
    "  if(applied.ok!==true||applied.deploy?.deployed_head!==RAHEKOMAK_DEPLOY_HEAD)throw new Error('rahekomak_apply_failed');",
    "  return {...applied.deploy,deploy_record:{repository:'rahekomak',branch:'main',commit_sha:RAHEKOMAK_DEPLOY_HEAD,target:'rahekomak.ir',time:applied.timestamp,result:'succeeded',rollback_performed:false},preflight_ok:true};",
    "}",
    "function runRahKomakBoundWorker(mode,nonce,cp,fs){",
    "  const phase=mode==='--apply'?'apply':'preflight';",
    "  const report='/var/lib/prhm-agent-selfmaint-exec/rahekomak-v2-'+nonce+'-'+phase+'.json';",
    "  const unit='prhm-rahekomak-v2-'+phase+'-'+nonce;",
    "  const args=[",
    "    '--quiet','--wait','--collect','--unit='+unit,",
    "    '--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true',",
    "    '--property=PrivateTmp=true','--property=PrivateDevices=true',",
    "    '--property=ProtectSystem=strict','--property=ProtectHome=read-only',",
    "    '--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true','--property=ProtectControlGroups=true',",
    "    '--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',",
    "    '--property=ReadWritePaths=/home/prhm/projects/generated/rahekomak',",
    "    '--property=ReadWritePaths=/var/lib/prhm-agent-selfmaint-exec',",
    "    '--property=ReadWritePaths=/etc/httpd/conf.d',",
    "    '--property=ReadWritePaths=/etc/selinux',",
    "    '--property=ReadWritePaths=/var/lib/selinux',",
    "    '--property=ReadWritePaths=/run',",
    "    '--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',",
    "    '/usr/local/bin/prhm-node',RAHEKOMAK_DEPLOY_WORKER,mode,nonce",
    "  ];",
    "  const out=cp.spawnSync('/usr/bin/systemd-run',args,{encoding:'utf8',timeout:mode==='--apply'?1800000:120000,maxBuffer:2097152,stdio:['ignore','pipe','pipe']});",
    "  if(!fs.existsSync(report))throw new Error('rahekomak_worker_report_missing:'+phase);",
    "  let data;try{data=JSON.parse(fs.readFileSync(report,'utf8'))}catch{throw new Error('rahekomak_worker_report_corrupt:'+phase)}",
    "  if(out.error||out.status!==0||data.ok!==true)throw new Error('rahekomak_worker_failed:'+phase+':'+String(data.error||out.status).slice(0,240));",
    "  if(data.action!=='rahekomak_production_deploy_v1'||data.release_sha!==RAHEKOMAK_DEPLOY_HEAD||data.target!=='rahekomak.ir')throw new Error('rahekomak_worker_contract_invalid');",
    "  return data;",
    "}",
    ""
  ].join('\n');
}
function patchExecutor(source) {
  if (typeof source !== 'string') fail('source_not_text');
  if (occurrences(source, START) !== 1 || occurrences(source, END) !== 1) fail('structural_anchor_mismatch');
  if (source.includes("RAHEKOMAK_DEPLOY_WORKER_GIT_BLOB")) fail('already_patched');
  const start = source.indexOf(START), end = source.indexOf(END);
  if (end <= start) fail('anchors_reordered');
  const old = source.slice(start, end);
  if (occurrences(old, OLD_HEAD) !== 1 || occurrences(old, OLD_HELPER_SHA) !== 1
      || occurrences(old, 'function applyRahKomakProductionDeployV1(){') !== 1
      || !old.includes('fs.lstatSync(RAHEKOMAK_DEPLOY_HELPER)')
      || !old.includes('systemd-run')) fail('unreviewed_executor_preimage');
  return source.slice(0, start) + replacement() + source.slice(end);
}
function manifest() {
  return Object.freeze({
    action: 'rahekomak_production_deploy_v1',
    source_mutation: 'executor_patch_candidate_only',
    production_mutation: false, executor_protect_home: 'yes_preserved',
    release_head: RELEASE_HEAD, helper_sha256: HELPER_SHA,
    worker_git_blob: WORKER_GIT_BLOB_SHA,
    approval: 'fresh_level_4_required_for_cutover',
    installer_status: 'not_installed'
  });
}
module.exports = { OLD_HEAD, OLD_HELPER_SHA, RELEASE_HEAD, HELPER_SHA,
  WORKER_GIT_BLOB_SHA, START, END, replacement, patchExecutor, manifest };
if (require.main === module) process.stdout.write(JSON.stringify(manifest())+'\n');
