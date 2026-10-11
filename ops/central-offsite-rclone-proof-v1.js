'use strict';
// Central Google Drive object proof v1 — fixed read-only Rclone stat, fail-closed.
// Production plugin patching is PLAN-ONLY: no write, no restart, no upload/delete.
const fs=require('node:fs');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const TARGET='/home/agent/ssh-mcp-server/src/plugins/centralOffsite.js';
const PREIMAGE_SHA256='d884a8e36d8aa80625901aff5d8acaf640d778df553b571dadad1bd04b9aec50';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');

function stableRemoteProof(auditRun,binary,config,remote,name,size){
  const records=[];
  let consecutive=0,integrityMismatch=false,remoteCount=0,remoteSize=0;
  for(let i=0;i<4 && consecutive<2 && !integrityMismatch;i++){
    const output=auditRun(binary,['lsjson',remote,'--stat','--config',config,
      '--contimeout','4s','--timeout','8s','--retries','1','--low-level-retries','1',
      '--tpslimit','0.5','--tpslimit-burst','1'],13000);
    const observation={attempt:i+1,status:'indeterminate',exit_code:output.exit_code};
    if(output.error){
      observation.status=/timedout|timeout|etimedout/i.test(output.error)?'timeout':'transport_error';
    }else if(output.exit_code!==0){
      const msg=String(output.stderr||'').toLowerCase();
      observation.status=/429|rate limit|quota|too many requests/.test(msg)?'rate_limited':
        /401|403|unauthorized|invalid_grant/.test(msg)?'access_error':
        /timeout|deadline|connection|temporary|couldn't find root directory id/.test(msg)?'transport_error':'remote_stat_error';
    }else{
      let item;
      try{item=JSON.parse(output.stdout||'null')}catch{observation.status='invalid_json'}
      if(observation.status!=='invalid_json'){
        if(item && !Array.isArray(item) && item.IsDir!==true &&
          (item.Name===name||item.Path===name) && Number.isSafeInteger(item.Size) && item.Size>=0){
          observation.size=item.Size;
          remoteCount=1;
          remoteSize=item.Size;
          if(item.Size===size){observation.status='match';consecutive++;}
          else {observation.status='size_mismatch';integrityMismatch=true;}
        }else observation.status='inconclusive_stat';
      }
    }
    if(observation.status!=='match')consecutive=0;
    records.push(observation); // No raw stderr, URL, tokens, client IDs or config bytes
    // Authorization and provider quota failures are not fixed by immediate retries.
    if(['rate_limited','access_error','size_mismatch'].includes(observation.status))break;
  }
  const ok=consecutive>=2 && !integrityMismatch;
  return {ok,count:remoteCount,size:remoteSize,status:ok?'verified':integrityMismatch?'integrity_mismatch':'indeterminate',attempts:records};
}

const OLD_VERSION="const CENTRAL_OFFSITE_AUDIT_VERSION='v3-google-drive-persisted-evidence-72h';";
const NEW_VERSION="const CENTRAL_OFFSITE_AUDIT_VERSION='v4-gdrive-single-stat-two-confirmations';";
const OLD_PROBE=[
"    const remote=auditRun(CENTRAL_OFFSITE_RCLONE,['lsjson',CENTRAL_OFFSITE_REMOTE,'--config',CENTRAL_OFFSITE_RCLONE_CONFIG,'--files-only','--max-depth','1','--include',expectedName,'--tpslimit','0.5','--tpslimit-burst','1','--contimeout','5s','--timeout','15s','--retries','1','--low-level-retries','1'],25000);",
"    let remoteCount=0,remoteSize=0,remoteOk=false;",
"    if(remote.exit_code===0){const items=JSON.parse(remote.stdout||'[]'),matches=Array.isArray(items)?items.filter(x=>x&&(x.Path===expectedName||x.Name===expectedName)):[];remoteCount=matches.length;remoteSize=matches.length===1?Number(matches[0].Size||0):0;remoteOk=remoteCount===1&&remoteSize===state.bundle_size;}"
].join('\n');
const NEW_PROBE=[
"    const proof=(snapshotOk&&sizeOk&&shaOk)?stableRemoteProof(auditRun,CENTRAL_OFFSITE_RCLONE,CENTRAL_OFFSITE_RCLONE_CONFIG,expectedRemote,expectedName,state.bundle_size):{ok:false,count:0,size:0,status:'invalid_bound_metadata',attempts:[]};",
"    const remoteCount=proof.count,remoteSize=proof.size,remoteOk=proof.ok;"
].join('\n');
const OLD_REQUIRED="const requiredChecks=['persisted_state','fresh_within_72h','runner_sha_bound','service_last_result_success','timer_enabled_active']";
const NEW_REQUIRED="const requiredChecks=['persisted_state','fresh_within_72h','runner_sha_bound','service_last_result_success','timer_enabled_active','remote_object_exact_size_current']";
const OLD_EVIDENCE='remote_object_count:remoteCount,remote_object_size:remoteSize,retention_guard_pass:retentionOk';
const NEW_EVIDENCE='remote_object_count:remoteCount,remote_object_size:remoteSize,remote_verification_state:proof.status,remote_probe_attempts:proof.attempts,retention_guard_pass:retentionOk';
const OLD_ANCHOR='function centralOffsiteAuditEvidenceV2(){';
const NEW_ANCHOR=stableRemoteProof.toString()+'\n\n'+OLD_ANCHOR;
const patches=[
  [OLD_VERSION,NEW_VERSION],
  [OLD_PROBE,NEW_PROBE],
  [OLD_REQUIRED,NEW_REQUIRED],
  [OLD_EVIDENCE,NEW_EVIDENCE],
  [OLD_ANCHOR,NEW_ANCHOR]
];
function plan(before){
  if(typeof before!=='string'||hash(before)!==PREIMAGE_SHA256)throw Error('PREIMAGE_SHA256_MISMATCH');
  let after=before;
  for(const [oldText,newText] of patches){
    if(after.split(oldText).length!==2)throw Error('EXACT_PATCH_MATCH_REQUIRED');
    after=after.replace(oldText,newText);
  }
  const check=cp.spawnSync(process.execPath,['--check','--input-type=module'],{input:after,encoding:'utf8',timeout:6000,maxBuffer:120000});
  if(check.status!==0||check.error)throw Error('PATCHED_MODULE_SYNTAX_INVALID');
  return {target:TARGET,preimage_sha256:hash(before),postimage_sha256:hash(after),change_count:patches.length,postimage:after};
}
if(require.main===module){
  try{
    if(process.argv.length!==3||process.argv[2]!=='--preflight')throw Error('READ_ONLY_ONLY');
    const st=fs.lstatSync(TARGET);
    if(!st.isFile()||st.isSymbolicLink())throw Error('UNSAFE_PRODUCTION_SOURCE');
    const p=plan(fs.readFileSync(TARGET,'utf8'));
    console.log(JSON.stringify({status:'PREFLIGHT_PASS',target:p.target,preimage_sha256:p.preimage_sha256,postimage_sha256:p.postimage_sha256,change_count:p.change_count,production_mutation:false},null,2));
  }catch(e){console.error(String(e.message||e));process.exitCode=2}
}
module.exports={TARGET,PREIMAGE_SHA256,hash,plan,stableRemoteProof};
