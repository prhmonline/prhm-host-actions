#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const cp=require('node:child_process');

const ACTION='honartik_ticket_print_hotfix_v1';
const OPERATION='host_action.honartik_ticket_print_hotfix_v1';
const POLICY_VERSION='2026-10-04.1-honartik-ticket-print-hotfix-v1';
const ROLLBACK='host-action-v2:honartik-ticket-print-hotfix-v1:file-rollback';
const BASE_SHA='ad2f0fc6924238e7bb7bff6d69a517c366ce82fbafb116bb0a2d31d78c5ed32f';
const EXEC_SHA='a988dfcd706d3a032bd4d0d60a85c78b7fd6cdbea4e81b5e6c21212a6cd754a4';
const POLICY_SHA='aad8b3262a86c31f6d746f0bcfbd3eada6187c4e671b51ca79957b6ca6c3340c';
const MCP_SHA='8f24b6ed70644c1eda7b255a47ccf0d4fabfe03ac7c73dd8799ff9aeb5294075';
const HELPER_PATH='/opt/prhm-agent-selfmaint-exec/actions/honartik-ticket-print-hotfix-v1.js';
const HELPER_RESULT='/var/lib/prhm-agent-selfmaint-exec/honartik-ticket-print-hotfix-v1/latest.json';
const HELPER_SHA='3bc432437dded52093c8724825e4b207e99e1f354e4619457464740b8b86a669';
const HELPER_GZIP_B64='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';
const PATHS=Object.freeze({
  base:'/opt/prhm-agent-selfmaint/server.js',
  exec:'/opt/prhm-agent-selfmaint-exec/server.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  helper:HELPER_PATH,
});
const BACKUP_ROOT='/var/backups/prhm-honartik-ticket-print-hotfix-installer-v1';
const INSTALL_RESULT='/var/lib/prhm-agent-selfmaint-exec/honartik-ticket-print-hotfix-installer-v1/latest.json';

function fail(m){throw new Error(m)}
function sha256(v){return crypto.createHash('sha256').update(v).digest('hex')}
function count(s,n){return String(s).split(n).length-1}
function once(s,a,r,label){const n=count(s,a);if(n!==1)fail('anchor_count:'+label+':'+n);return s.replace(a,r)}
function helperSource(){const bytes=zlib.gunzipSync(Buffer.from(HELPER_GZIP_B64,'base64'));if(sha256(bytes)!==HELPER_SHA)fail('helper_embedded_sha_mismatch');return bytes.toString('utf8')}

function assertLiveBaseline(hashes){
  const expected={base:BASE_SHA,exec:EXEC_SHA,policy:POLICY_SHA,mcp:MCP_SHA};
  for(const [k,v] of Object.entries(expected))if(String(hashes&&hashes[k]||'')!==v)fail(k+'_sha_mismatch');
  return true;
}

function buildBaseCandidate(source){
  if(source.includes(ACTION))fail('already_present');
  const anchor="  agent_zdt_source_sha_refresh_publisher_v1: { operation: 'host_action.agent_zdt_source_sha_refresh_publisher_v1', rollback: 'host-action-v2:agent-zdt-source-sha-refresh-publisher-v1:action-backup-restore' }";
  let out=once(source,anchor,anchor+",\n  "+ACTION+": { operation: '"+OPERATION+"', rollback: '"+ROLLBACK+"' }",'base_spec');
  const m=/const HOST_ACTION_V2_LEVEL3 = new Set\((\[[^;]+\])\);/.exec(out);
  if(!m)fail('level3_set_missing');
  if(m[1].includes(ACTION))fail('action_must_not_be_level3');
  return out;
}

function buildPolicyCandidate(source){
  const p=JSON.parse(source);
  if(p.schema_version!=='prhm.approval-policy.v1')fail('policy_schema_mismatch');
  p.operations=p.operations||{};
  p.typed_scopes=Array.isArray(p.typed_scopes)?p.typed_scopes:[];
  if(p.operations[OPERATION]||p.typed_scopes.some(x=>x&&x.action===ACTION))fail('already_present');
  p.version=POLICY_VERSION;
  p.operations[OPERATION]={level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,requested_approver:'mohammad',expires_seconds:180,policy_version:POLICY_VERSION,rollback_reference:ROLLBACK};
  p.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:ACTION,risk:'critical',operation:OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
  return JSON.stringify(p,null,2)+'\n';
}

function buildMcpCandidate(source){
  if(source.includes(ACTION))fail('already_present');
  const re=/const\s+HostActionV2\s*=\s*z\.enum\(\[([\s\S]*?)\]\);/;
  const m=source.match(re);if(!m)fail('mcp_enum_anchor_missing');
  const body=m[1].trimEnd();
  const comma=body.trim().endsWith(',')?'':',';
  return source.replace(re,'const HostActionV2 = z.enum(['+body+comma+"'"+ACTION+"'"+']);');
}

function executorBlock(){return `
const HONARTIK_TICKET_PRINT_HOTFIX_HELPER='${HELPER_PATH}';
const HONARTIK_TICKET_PRINT_HOTFIX_RESULT='${HELPER_RESULT}';
const HONARTIK_TICKET_PRINT_HOTFIX_HELPER_SHA='${HELPER_SHA}';
function applyHonartikTicketPrintHotfixV1(){
  if(!fs.existsSync(HONARTIK_TICKET_PRINT_HOTFIX_HELPER))throw new Error('honartik_ticket_print_hotfix_helper_missing');
  const helperSha=require('node:crypto').createHash('sha256').update(fs.readFileSync(HONARTIK_TICKET_PRINT_HOTFIX_HELPER)).digest('hex');
  if(helperSha!==HONARTIK_TICKET_PRINT_HOTFIX_HELPER_SHA)throw new Error('honartik_ticket_print_hotfix_helper_sha_mismatch');
  try{if(fs.existsSync(HONARTIK_TICKET_PRINT_HOTFIX_RESULT))fs.unlinkSync(HONARTIK_TICKET_PRINT_HOTFIX_RESULT)}catch{}
  const unit='prhm-honartik-ticket-print-hotfix-v1-'+Date.now();
  const args=['--wait','--collect','--unit='+unit,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=PrivateDevices=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true','--property=ProtectControlGroups=true','--property=RestrictAddressFamilies=AF_UNIX','--property=CapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_FOWNER','--property=AmbientCapabilities=','--property=RestrictNamespaces=true','--property=ReadWritePaths=/home/honartik/domains/dashboard.honartik.ir/public_html/app/modules/api/views/public /var/backups/prhm-honartik-ticket-print-hotfix-v1 /var/lib/prhm-agent-selfmaint-exec/honartik-ticket-print-hotfix-v1','--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',HONARTIK_TICKET_PRINT_HOTFIX_HELPER];
  cp.execFileSync('/usr/bin/systemd-run',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000,maxBuffer:1024*1024});
  if(!fs.existsSync(HONARTIK_TICKET_PRINT_HOTFIX_RESULT))throw new Error('honartik_ticket_print_hotfix_result_missing');
  const result=readJson(HONARTIK_TICKET_PRINT_HOTFIX_RESULT);
  if(result.ok!==true||result.schema_version!=='prhm.host-action-result.v1'||result.action!=='${ACTION}'||result.live_sha256!=='6b76f2c1ff9c48e0e9ff29cefbb77ab1664338c10a1d862ae0f7fa7176308377'||result.unrelated_dirty_state_preserved!==true||result.database_mutation!==false||result.git_ref_mutation!==false||result.rollback_performed!==false)throw new Error('honartik_ticket_print_hotfix_result_invalid');
  return result;
}
`}

function buildExecCandidate(source){
  if(source.includes(ACTION))fail('already_present');
  const spec="  agent_zdt_source_sha_refresh_publisher_v1:{operation:'host_action.agent_zdt_source_sha_refresh_publisher_v1',kind:'agent_zdt_source_sha_refresh_publisher_v1'}";
  let out=once(source,spec,spec+",\n  "+ACTION+":{operation:'"+OPERATION+"',kind:'"+ACTION+"'}",'exec_spec');
  const helperAnchor='const applyHostActionV2Original=applyHostActionV2;';
  out=once(out,helperAnchor,executorBlock()+'\n'+helperAnchor,'exec_helper');
  const dispatch='applyHostActionV2=async function(action){';
  out=once(out,dispatch,dispatch+"if(action==='"+ACTION+"')return applyHonartikTicketPrintHotfixV1();",'exec_dispatch');
  return out;
}

function buildInstallPlan(source){
  const helper=helperSource();
  const files={base:buildBaseCandidate(source.base),exec:buildExecCandidate(source.exec),policy:buildPolicyCandidate(source.policy),mcp:buildMcpCandidate(source.mcp),helper};
  const hashes={};for(const [k,v] of Object.entries(files))hashes[k]=sha256(Buffer.from(v));
  return Object.freeze({paths:PATHS,files:Object.freeze(files),sha256:Object.freeze(hashes),production_application_mutation:false,database_mutation:false,application_tree_write:false});
}

function createFixtureInstallerAdapter(state,options={}){
  const good={base:BASE_SHA,exec:EXEC_SHA,policy:POLICY_SHA,mcp:MCP_SHA};
  return {
    preflight:()=>({hashes:{...good},services:{api_blue:'active',api_green:'active',mcp_blue:'active',mcp_green:'active'}}),
    readSources:()=>({base:state.base,exec:state.exec,policy:state.policy,mcp:state.mcp}),
    backup:()=>JSON.parse(JSON.stringify(state)),
    atomic:(key,value)=>{state[key]=value},
    nodeCheck:()=>true,
    jsonCheck:value=>{JSON.parse(value);return true},
    reload:()=>true,
    verifyInstalledHashes:plan=>{if(options.failVerify)return false;return Object.entries(plan.sha256).every(([k,v])=>sha256(Buffer.from(state[k]??''))===v)},
    rollback:backup=>{for(const k of Object.keys(state))delete state[k];Object.assign(state,backup);return true},
    persistResult:()=>true,
  };
}

function assertInstallPreflight(state){
  assertLiveBaseline(state&&state.hashes||{});
  for(const s of ['api_blue','api_green','mcp_blue','mcp_green'])if(state?.services?.[s]!=='active')fail('control_plane_not_stable:'+s);
  return true;
}

function install(adapter){
  let backup=null,mutated=false;
  try{
    assertInstallPreflight(adapter.preflight());
    const source=adapter.readSources();
    const plan=buildInstallPlan(source);
    backup=adapter.backup();
    for(const key of ['helper','base','exec','policy','mcp']){adapter.atomic(key,plan.files[key]);mutated=true}
    adapter.nodeCheck(plan.files.base,'base');adapter.nodeCheck(plan.files.exec,'exec');adapter.nodeCheck(plan.files.mcp,'mcp');adapter.nodeCheck(plan.files.helper,'helper');adapter.jsonCheck(plan.files.policy);adapter.reload();
    if(adapter.verifyInstalledHashes(plan)!==true)fail('verify_installed_hashes_failed');
    const result={ok:true,schema_version:'prhm.host-action-result.v1',action:'honartik_ticket_print_hotfix_installer_v1',target_action:ACTION,installed:true,rollback_performed:false,production_application_mutation:false,database_mutation:false};
    adapter.persistResult(result);return result;
  }catch(error){
    let rollbackVerified=true;
    if(mutated&&backup){try{rollbackVerified=adapter.rollback(backup)!==false}catch{rollbackVerified=false}}
    const result={ok:false,schema_version:'prhm.host-action-result.v1',action:'honartik_ticket_print_hotfix_installer_v1',target_action:ACTION,installed:false,rollback_performed:mutated,rollback_verified:rollbackVerified,production_application_mutation:false,database_mutation:false,error:'install_failed'};
    try{adapter.persistResult(result)}catch{}return result;
  }
}

function productionDeps(){
  const services={api_blue:'prhm-agent-api-blue.service',api_green:'prhm-agent-api-green.service',mcp_blue:'prhm-agent-mcp-blue.service',mcp_green:'prhm-agent-mcp-green.service'};
  const restart=['prhm-company-approval.service','prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service','prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service','prhm-agent-mcp-instant-delivery-candidate.service'];
  const read=f=>fs.readFileSync(f,'utf8');
  const fileSha=f=>sha256(fs.readFileSync(f));
  const run=(bin,args,t=60000)=>cp.spawnSync(bin,args,{encoding:'utf8',timeout:t,maxBuffer:2*1024*1024,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C'}});
  const must=(r,label)=>{if(r.error||r.status!==0)fail(label+':'+String(r.stderr||r.stdout||r.error||'').slice(-1200));return r};
  const inspect=f=>{if(!fs.existsSync(f))return{exists:false};const st=fs.lstatSync(f);return{exists:true,isFile:st.isFile(),isSymlink:st.isSymbolicLink(),mode:st.mode&0o777,uid:st.uid,gid:st.gid}};
  return {
    preflight:()=>({hashes:{base:fileSha(PATHS.base),exec:fileSha(PATHS.exec),policy:fileSha(PATHS.policy),mcp:fileSha(PATHS.mcp)},services:Object.fromEntries(Object.entries(services).map(([k,s])=>[k,String(must(run('/usr/bin/systemctl',['is-active',s],10000),'service_check:'+s).stdout||'').trim()]))}),
    readSources:()=>({base:read(PATHS.base),exec:read(PATHS.exec),policy:read(PATHS.policy),mcp:read(PATHS.mcp)}),
    backup:()=>{const dir=path.join(BACKUP_ROOT,new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+process.pid);fs.mkdirSync(dir,{recursive:true,mode:0o700});const entries={};for(const [k,f] of Object.entries(PATHS)){const info=inspect(f);entries[k]={...info};if(info.exists){if(info.isSymlink||!info.isFile)fail('backup_target_invalid:'+k);const dst=path.join(dir,k+'.bak');fs.copyFileSync(f,dst,fs.constants.COPYFILE_EXCL);fs.chmodSync(dst,0o600);entries[k].backup=dst}}return{dir,entries}},
    atomic:(key,value)=>{const f=PATHS[key];const info=inspect(f);if(info.exists&&(info.isSymlink||!info.isFile))fail('atomic_target_invalid:'+key);fs.mkdirSync(path.dirname(f),{recursive:true});const mode=key==='helper'?0o700:(info.mode||0o644),uid=info.exists?info.uid:0,gid=info.exists?info.gid:0;const tmp=f+'.honartik-ticket-'+process.pid+'-'+Date.now()+'.tmp';let fd;try{fd=fs.openSync(tmp,'wx',mode);fs.writeFileSync(fd,value);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.chmodSync(tmp,mode);if(process.geteuid&&process.geteuid()===0)fs.chownSync(tmp,uid,gid);fs.renameSync(tmp,f)}catch(e){try{if(fd!==undefined)fs.closeSync(fd)}catch{}try{fs.unlinkSync(tmp)}catch{}throw e}},
    nodeCheck:(text,label)=>{const tmp='/tmp/prhm-honartik-ticket-'+process.pid+'-'+label+'.js';try{fs.writeFileSync(tmp,text,{mode:0o600,flag:'wx'});must(run('/usr/local/bin/prhm-node',['--check',tmp],10000),'node_syntax_invalid:'+label)}finally{try{fs.unlinkSync(tmp)}catch{}}},
    jsonCheck:value=>{JSON.parse(value);return true},
    reload:()=>{for(const s of restart)must(run('/usr/bin/systemctl',['restart',s],60000),'service_restart_failed:'+s);for(const s of restart){const r=must(run('/usr/bin/systemctl',['is-active',s],10000),'service_status_failed:'+s);if(String(r.stdout||'').trim()!=='active')fail('service_not_active:'+s)}return true},
    verifyInstalledHashes:plan=>Object.entries(plan.sha256).every(([k,v])=>fileSha(PATHS[k])===v),
    rollback:backup=>{let ok=true;for(const [k,f] of Object.entries(PATHS)){const e=backup.entries[k];try{if(e.exists){fs.copyFileSync(e.backup,f);fs.chmodSync(f,e.mode);if(process.geteuid&&process.geteuid()===0)fs.chownSync(f,e.uid,e.gid)}else if(fs.existsSync(f))fs.unlinkSync(f)}catch{ok=false}}try{for(const s of restart)must(run('/usr/bin/systemctl',['restart',s],60000),'rollback_restart_failed:'+s)}catch{ok=false}return ok},
    persistResult:r=>{fs.mkdirSync(path.dirname(INSTALL_RESULT),{recursive:true,mode:0o700});const tmp=INSTALL_RESULT+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(r,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,INSTALL_RESULT);return true},
  };
}

function selftest(){
  const h=helperSource();
  if(sha256(Buffer.from(h))!==HELPER_SHA)fail('selftest_helper_sha');
  return {ok:true,action:ACTION,helper_sha256:HELPER_SHA,production_application_mutation:false,database_mutation:false};
}

module.exports={ACTION,OPERATION,POLICY_VERSION,ROLLBACK,BASE_SHA,EXEC_SHA,POLICY_SHA,MCP_SHA,HELPER_PATH,HELPER_RESULT,HELPER_SHA,PATHS,sha256,helperSource,assertLiveBaseline,buildBaseCandidate,buildPolicyCandidate,buildMcpCandidate,buildExecCandidate,buildInstallPlan,createFixtureInstallerAdapter,assertInstallPreflight,install,productionDeps,selftest};

if(require.main===module){
  if(process.argv.length!==3||process.argv[2]!=='--install'){process.stderr.write('usage: --install\\n');process.exitCode=2}
  else{const r=install(productionDeps());process.stdout.write(JSON.stringify(r)+'\\n');if(r.ok!==true)process.exitCode=1}
}
