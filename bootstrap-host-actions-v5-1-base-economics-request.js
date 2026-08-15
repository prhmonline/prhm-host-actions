#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='leadops_economics_inputs_foundation_v1';
const NODE='/usr/local/bin/prhm-node';
const TARGET='/opt/prhm-agent-selfmaint/server.js';
const EXPECTED=Object.freeze({
  '/opt/prhm-agent-selfmaint/server.js':'fca5a7113e6a38a001f45ed1c44deaa667e6d8d94014dde9d3023a98706cdef8',
  '/opt/prhm-agent-selfmaint-exec/server.js':'06c8f5a65b49435d762c24acc540084e33009943c8ab9f43a1e074bd8328db75',
  '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js':'ce0d75041065ad11da33ee7365a0cc8eff0933cc4ae0b16d855299ed2da7eee8',
  '/opt/prhm-company-control-plane/config/approval-policy.json':'edebc62e98d3014d38586dd869c7a1eea4ca3d1f58445e6414429db73f765d99',
  '/opt/prhm-agent-selfmaint-exec/actions/mcp-candidate-schema-compare-v1.js':'a17c0219e497216bcbbc2ee6c3fbb8a2b7190f256f93744832698aecce3fd79e',
  '/opt/prhm-agent-selfmaint-exec/actions/leadops-economics-inputs-foundation-v1.js':'412901ae2e747c4d49ff5ea976f918d08784170945830502c34f599aa5e22152'
});

function shaBuffer(b){return crypto.createHash('sha256').update(b).digest('hex');}
function shaFile(f){return shaBuffer(fs.readFileSync(f));}
function fail(m){throw new Error(m);}
function replaceOnce(text,needle,replacement,label){
  const i=text.indexOf(needle);
  if(i<0)fail('anchor_missing:'+label);
  if(text.indexOf(needle,i+needle.length)>=0)fail('anchor_not_unique:'+label);
  return text.slice(0,i)+replacement+text.slice(i+needle.length);
}
function patchBase(src){
  return replaceOnce(
    src,
    "  mcp_candidate_schema_compare_v1: { operation: 'host_action.mcp_candidate_schema_compare_v1', rollback: 'host-action-v2:mcp-candidate-schema-compare-v1:auto-backup' }\n});",
    "  mcp_candidate_schema_compare_v1: { operation: 'host_action.mcp_candidate_schema_compare_v1', rollback: 'host-action-v2:mcp-candidate-schema-compare-v1:auto-backup' },\n  leadops_economics_inputs_foundation_v1: { operation: 'host_action.leadops_economics_inputs_foundation_v1', rollback: 'host-action-v2:leadops-economics-inputs-foundation-v1:auto-backup' }\n});",
    'base_host_action_v2_spec'
  );
}
function exec(file,args,{allowFailure=false,timeout=30000}={}){
  const r=cp.spawnSync(file,args,{encoding:'utf8',timeout,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
  if(r.error)fail('exec_error:'+path.basename(file)+':'+r.error.message);
  if(!allowFailure&&r.status!==0)fail('exec_failed:'+path.basename(file)+':'+r.status+':'+String(r.stderr||r.stdout||'').slice(0,2000));
  return r;
}
function systemctl(args){return exec('/usr/bin/systemctl',args,{timeout:45000});}
function waitActive(unit){
  for(let i=0;i<50;i++){
    const r=exec('/usr/bin/systemctl',['is-active',unit],{allowFailure:true,timeout:10000});
    if(String(r.stdout||'').trim()==='active')return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200);
  }
  return false;
}
function curlHealth(args,label){
  let lastError=null;
  for(let i=0;i<50;i++){
    try{
      const r=exec('/usr/bin/curl',args,{timeout:10000});
      return JSON.parse(String(r.stdout||'{}'));
    }catch(error){
      lastError=error;
      if(i<49)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200);
    }
  }
  fail(label+'_health_not_ready:'+String(lastError?.message||lastError||'unknown'));
}
function unixHealth(socket){return curlHealth(['-fsS','--unix-socket',socket,'http://localhost/health'],'unix');}
function syntaxCheck(name,text){
  const tmp='/tmp/prhm-v5-1-'+path.basename(name)+'-'+process.pid+'.js';
  fs.writeFileSync(tmp,text,{mode:0o600});
  try{exec(NODE,['--check',tmp],{timeout:15000});}
  finally{try{fs.unlinkSync(tmp)}catch{}}
}
function atomicReplace(file,text){
  const st=fs.statSync(file);
  const tmp=file+'.v5-1-'+process.pid+'-'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,text,{mode:st.mode&0o777});
  fs.chownSync(tmp,st.uid,st.gid);
  fs.renameSync(tmp,file);
}
function verifyExpected(){
  for(const [file,expected] of Object.entries(EXPECTED)){
    if(!fs.existsSync(file))fail('state_file_missing:'+file);
    const actual=shaFile(file);
    if(actual!==expected)fail('state_sha_mismatch:'+file+':'+actual+':'+expected);
  }
}
function main(){
  const args=process.argv.slice(2);
  if(args.length>1)fail('unexpected_arguments');
  if(args.length===1&&args[0]!=='--preflight-only')fail('unexpected_argument:'+args[0]);
  const preflightOnly=args[0]==='--preflight-only';
  if(process.getuid&&process.getuid()!==0)fail('must_run_as_root');
  verifyExpected();
  const before=fs.readFileSync(TARGET,'utf8');
  if(before.includes(ACTION))fail('base_action_already_present');
  const candidate=patchBase(before);
  syntaxCheck(TARGET,candidate);
  const candidateSha=shaBuffer(Buffer.from(candidate));
  const preflight={
    ok:true,
    schema_version:'prhm.host-action-bootstrap-preflight.v1',
    preflight_only:preflightOnly,
    remediation:'host-actions-v5.1-base-economics-request',
    action:ACTION,
    base_before_sha256:EXPECTED[TARGET],
    base_candidate_sha256:candidateSha,
    guarded_state_hashes:EXPECTED,
    database_mutation:false,
    business_mutation:false,
    p0_live:false,
    proposal_send:false,
    bid_send:false,
    production_mutation:false
  };
  if(preflightOnly){console.log(JSON.stringify(preflight));return;}

  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);
  const backupDir='/var/backups/prhm-host-actions-v5-1-base-economics-request-'+stamp;
  fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
  const backup=path.join(backupDir,'server.js.bak');
  fs.copyFileSync(TARGET,backup,fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backup,0o600);
  let changed=false;
  try{
    atomicReplace(TARGET,candidate);changed=true;
    if(shaFile(TARGET)!==candidateSha)fail('base_post_sha_mismatch');
    systemctl(['restart','prhm-agent-selfmaint.service']);
    if(!waitActive('prhm-agent-selfmaint.service'))fail('base_service_not_active');
    const health=unixHealth('/run/prhm-agent-selfmaint/selfmaint.sock');
    if(health.ok!==true||health.version!=='1.0.0-l4-fail-closed')fail('base_health_invalid:'+JSON.stringify(health));
    if(!fs.readFileSync(TARGET,'utf8').includes(ACTION))fail('base_action_postverify_missing');
    const result={
      ok:true,
      schema_version:'prhm.host-action-install-result.v1',
      installed:true,
      remediation:'host-actions-v5.1-base-economics-request',
      action:ACTION,
      base_before_sha256:EXPECTED[TARGET],
      base_after_sha256:shaFile(TARGET),
      backup_dir:backupDir,
      database_mutation:false,
      business_mutation:false,
      p0_live:false,
      proposal_send:false,
      bid_send:false
    };
    console.log(JSON.stringify(result));
  }catch(error){
    const rollbackErrors=[];
    if(changed){
      try{atomicReplace(TARGET,fs.readFileSync(backup,'utf8'))}catch(e){rollbackErrors.push('base:'+e.message)}
    }
    try{systemctl(['restart','prhm-agent-selfmaint.service'])}catch(e){rollbackErrors.push('restart:'+e.message)}
    try{
      if(!waitActive('prhm-agent-selfmaint.service'))rollbackErrors.push('base_not_active_after_rollback');
      else unixHealth('/run/prhm-agent-selfmaint/selfmaint.sock');
    }catch(e){rollbackErrors.push('health:'+e.message)}
    if(rollbackErrors.length)fail('v5_1_failed_and_rollback_incomplete:'+error.message+':'+rollbackErrors.join('|'));
    fail('v5_1_failed_rolled_back:'+error.message);
  }
}
main();
