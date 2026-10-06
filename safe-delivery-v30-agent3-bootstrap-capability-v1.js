'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='safe_delivery_v30_agent3_bootstrap_v1';
const BRIDGE_COMMIT='750ebbe8fdd27dc63968519f56d2819076a2f4c4';
const BRIDGE_SHA256='fbb5b5930235414b03b1260edb96868ceea735462e000d7562a8ce458f97f617';
const BRIDGE_URL='https://raw.githubusercontent.com/prhmonline/prhm-host-actions/'+BRIDGE_COMMIT+'/bootstrap-host-actions-v30-safe-delivery-candidate-install-bridge.js';
const MODES=Object.freeze(['--preflight-only','--apply']);
const WORK_ROOT='/var/lib/prhm-agent-selfmaint-exec/safe-delivery-v30-agent3-bootstrap-v1';

const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
function SOURCE_SHA256(bytes){return sha256(bytes)}
function fail(code){throw new Error(code)}

function parseMode(args){
  if(!Array.isArray(args)||args.length!==1||!MODES.includes(args[0]))fail('unexpected_arguments');
  return args[0];
}

function fetchBridge(){
  const r=cp.spawnSync('/usr/bin/curl',[
    '--fail','--silent','--show-error','--location',
    '--max-time','30',
    BRIDGE_URL
  ],{
    encoding:null,
    timeout:40000,
    maxBuffer:2*1024*1024,
    env:{PATH:'/usr/bin:/bin',LC_ALL:'C',HOME:'/nonexistent'}
  });
  if(r.error||r.status!==0)fail('bridge_fetch_failed');
  const bytes=Buffer.from(r.stdout||Buffer.alloc(0));
  if(sha256(bytes)!==BRIDGE_SHA256)fail('bridge_sha_mismatch');
  return bytes;
}

function syntaxCheck(bytes){
  const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{
    input:bytes,
    encoding:null,
    timeout:30000,
    maxBuffer:1024*1024,
    env:{PATH:'/usr/local/bin:/usr/bin:/bin',LC_ALL:'C',HOME:'/nonexistent'}
  });
  if(r.error||r.status!==0)fail('bridge_syntax_invalid');
}

function parseLastJson(stdout){
  const lines=String(stdout||'').trim().split(/\r?\n+/).reverse();
  for(const line of lines){
    try{const o=JSON.parse(line);if(o&&typeof o==='object')return o}catch{}
  }
  fail('bridge_result_missing');
}

function withBridge(bytes,mode){
  fs.mkdirSync(WORK_ROOT,{recursive:true,mode:0o700});
  fs.chmodSync(WORK_ROOT,0o700);
  const file=path.join(WORK_ROOT,'.bridge-'+process.pid+'-'+Date.now()+'.js');
  fs.writeFileSync(file,bytes,{mode:0o700,flag:'wx'});
  try{
    if(sha256(fs.readFileSync(file))!==BRIDGE_SHA256)fail('bridge_stage_sha_mismatch');
    const r=cp.spawnSync('/usr/local/bin/prhm-node',[file,mode],{
      encoding:'utf8',
      timeout:mode==='--apply'?240000:60000,
      maxBuffer:2*1024*1024,
      env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/nonexistent'}
    });
    const out=parseLastJson(String(r.stdout||r.stderr||''));
    if(r.error||r.status!==0||out?.ok!==true)fail('bridge_execution_failed:'+String(out?.error||r.error?.message||'unknown'));
    return out;
  }finally{
    try{if(fs.existsSync(file))fs.unlinkSync(file)}catch{}
  }
}

function preflight(){
  const bytes=fetchBridge();
  syntaxCheck(bytes);
  const bridge=withBridge(bytes,'--preflight-only');
  if(bridge.action!=='safe_delivery_v30_candidate_install_bridge_v1'||bridge.preflight_only!==true)fail('bridge_preflight_contract_invalid');
  return {
    ok:true,
    schema_version:'prhm.safe-delivery-v30-agent3-bootstrap-preflight.v1',
    action:ACTION,
    preflight_only:true,
    bridge_commit:BRIDGE_COMMIT,
    bridge_sha256:BRIDGE_SHA256,
    production_mutation:false,
    database_mutation:false,
    profile_state_mutation:false,
    cfpark_activation:false,
    bridge
  };
}

function apply(){
  if(process.getuid&&process.getuid()!==0)fail('root_required');
  const bytes=fetchBridge();
  syntaxCheck(bytes);
  const result=withBridge(bytes,'--apply');
  if(result.action!=='safe_delivery_v30_candidate_install_bridge_v1'||result.installed!==true||result.rollback_performed!==false)fail('bridge_apply_contract_invalid');
  return {
    ok:true,
    schema_version:'prhm.safe-delivery-v30-agent3-bootstrap-result.v1',
    action:ACTION,
    bridge_commit:BRIDGE_COMMIT,
    bridge_sha256:BRIDGE_SHA256,
    installed:true,
    production_mutation:true,
    database_mutation:false,
    profile_state_mutation:false,
    cfpark_activation:false,
    rollback_performed:false,
    bridge_result:result
  };
}

function main(){
  const mode=parseMode(process.argv.slice(2));
  const out=mode==='--preflight-only'?preflight():apply();
  process.stdout.write(JSON.stringify(out)+'\n');
}

module.exports={
  ACTION,BRIDGE_COMMIT,BRIDGE_SHA256,BRIDGE_URL,MODES,WORK_ROOT,
  SOURCE_SHA256,parseMode,fetchBridge,preflight,apply
};

if(require.main===module){
  try{main()}catch(error){
    process.stderr.write(JSON.stringify({ok:false,action:ACTION,error:String(error&&error.message||error)})+'\n');
    process.exit(1);
  }
}
