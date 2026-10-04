#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTIONS=Object.freeze({
  waha_student_bridge_preflight_v1:Object.freeze({level:3,risk:'high',modes:Object.freeze(['--preflight-only'])}),
  waha_student_bridge_install_v1:Object.freeze({level:4,risk:'critical',modes:Object.freeze(['--apply','--session-ensure','--qr'])}),
  waha_student_bridge_status_v1:Object.freeze({level:3,risk:'high',modes:Object.freeze(['--status'])}),
  waha_student_bridge_session_ensure_v1:Object.freeze({level:3,risk:'high',modes:Object.freeze(['--session-ensure'])}),
  waha_student_bridge_qr_v1:Object.freeze({level:3,risk:'high',modes:Object.freeze(['--qr'])}),
  waha_student_bridge_rollback_v1:Object.freeze({level:4,risk:'critical',modes:Object.freeze(['--rollback'])}),
});

const CONTRACT=Object.freeze({
  schema_version:'prhm.waha-student-bridge-registration.v1',
  source_commit:'483c1bf3ff23dea62c6512d6d374fb3dc0ec5676',
  helper_path:'waha-student-bridge-install-v1.js',
  helper_sha256:'9907f6df0a34151a6068c2c046b39b6943c6d816ff21520352e5a658c7523e96',
  helper_target:'/opt/prhm-agent-selfmaint-exec/actions/waha-student-bridge-install-v1.js',
  actions:ACTIONS,
  preimages:Object.freeze({
    base:'ad2f0fc6924238e7bb7bff6d69a517c366ce82fbafb116bb0a2d31d78c5ed32f',
    exec:'a988dfcd706d3a032bd4d0d60a85c78b7fd6cdbea4e81b5e6c21212a6cd754a4',
    policy:'aad8b3262a86c31f6d746f0bcfbd3eada6187c4e671b51ca79957b6ca6c3340c',
    mcp:'8f24b6ed70644c1eda7b255a47ccf0d4fabfe03ac7c73dd8799ff9aeb5294075',
  }),
  paths:Object.freeze({
    base:'/opt/prhm-agent-selfmaint/server.js',
    exec:'/opt/prhm-agent-selfmaint-exec/server.js',
    policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
    mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  }),
  policy_version:'2026-10-04.1-waha-student-bridge-registration-v1',
});

function fail(message){throw new Error(message)}
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex')}
function count(source,needle){return source.split(needle).length-1}
function assertOnce(source,needle,label){const n=count(source,needle);if(n!==1)fail(`${label}_anchor_${n}`)}
function modesForAction(action){const spec=ACTIONS[action];if(!spec)fail('unsupported_action');return [...spec.modes]}

function actionMapEntries(kind){
  return Object.keys(ACTIONS).map(action=>{
    const operation=`host_action.${action}`;
    return kind==='base'
      ? `${action}: { operation: '${operation}', rollback: 'host-action-v2:${action}:fixed-helper-rollback' },`
      : `${action}:{operation:'${operation}',kind:'${action}'},`;
  }).join('\n  ');
}

function patchBase(source){
  for(const action of Object.keys(ACTIONS)) if(source.includes(action)) fail('base_already_registered');
  const anchor=/host_action_v2_installer_v1\s*:\s*\{[^}]*operation\s*:\s*'host_action\.host_action_v2_installer_v1'[^}]*\}\s*,?/;
  const match=source.match(anchor);if(!match)fail('base_action_anchor_missing');
  let out=source.replace(match[0],match[0]+'\n  '+actionMapEntries('base'));
  const level3=['waha_student_bridge_preflight_v1','waha_student_bridge_status_v1','waha_student_bridge_session_ensure_v1','waha_student_bridge_qr_v1'];
  const set=/const HOST_ACTION_V2_LEVEL3 = new Set\(\[([\s\S]*?)\]\);/;
  const sm=out.match(set);if(!sm)fail('base_level3_anchor_missing');
  const extra=level3.map(x=>`\"${x}\"`).join(',');
  const body=sm[1].trim();
  out=out.replace(set,`const HOST_ACTION_V2_LEVEL3 = new Set([${body}${body?',':''}${extra}]);`);
  return out;
}

function runnerSource(){
  const modeMap=Object.entries(ACTIONS).map(([action,spec])=>`  '${action}':${JSON.stringify(spec.modes)},`).join('\n');
  return `\nconst WAHA_STUDENT_BRIDGE_HELPER='${CONTRACT.helper_target}';\nconst WAHA_STUDENT_BRIDGE_HELPER_SHA='${CONTRACT.helper_sha256}';\nconst WAHA_STUDENT_BRIDGE_ACTION_MODES=Object.freeze({\n${modeMap}\n});\nfunction runWahaStudentBridgeAction(action){\n  const modes=WAHA_STUDENT_BRIDGE_ACTION_MODES[action];if(!modes)throw new Error('waha_student_bridge_action_not_allowed');\n  if(!fs.existsSync(WAHA_STUDENT_BRIDGE_HELPER))throw new Error('waha_student_bridge_helper_missing');\n  const helperBytes=fs.readFileSync(WAHA_STUDENT_BRIDGE_HELPER);\n  const helperSha=require('node:crypto').createHash('sha256').update(helperBytes).digest('hex');\n  if(helperSha!==WAHA_STUDENT_BRIDGE_HELPER_SHA)throw new Error('waha_student_bridge_helper_sha_mismatch:'+helperSha);\n  const outputs=[];\n  for(const mode of modes){\n    const unit='prhm-waha-student-bridge-'+mode.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')+'-'+Date.now();\n    const args=['--wait','--pipe','--unit='+unit,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=ProtectSystem=strict','--property=ProtectHome=true','--property=ReadWritePaths=-/opt/prhm-whatsapp-student-bridge /run','--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',WAHA_STUDENT_BRIDGE_HELPER,mode];\n    const raw=cp.execFileSync('/usr/bin/systemd-run',args,{encoding:'utf8',timeout:1200000,maxBuffer:600000});\n    const lines=String(raw||'').split(/\\n/).map(x=>x.trim()).filter(Boolean);\n    let parsed=null;for(let i=lines.length-1;i>=0;i--){if(lines[i].startsWith('{')){try{parsed=JSON.parse(lines[i]);break}catch{}}}\n    if(!parsed||parsed.ok!==true)throw new Error('waha_student_bridge_mode_result_invalid:'+mode);\n    outputs.push({mode,result:parsed});\n  }\n  return {ok:true,schema_version:'prhm.waha-student-bridge-execution.v1',action,modes:outputs,rollback_performed:false};\n}\n`;
}

function patchExec(source){
  for(const action of Object.keys(ACTIONS)) if(source.includes(action)) fail('exec_already_registered');
  const actionAnchor=/host_action_v2_installer_v1\s*:\s*\{[^}]*operation\s*:\s*'host_action\.host_action_v2_installer_v1'[^}]*\}\s*,?/;
  const am=source.match(actionAnchor);if(!am)fail('exec_action_anchor_missing');
  let out=source.replace(am[0],am[0]+'\n  '+actionMapEntries('exec'));
  const helperAnchor=/const HOST_ACTION_V2_INSTALLER_HELPER='[^']+';/;
  const hm=out.match(helperAnchor);if(!hm)fail('exec_helper_anchor_missing');
  out=out.replace(hm[0],hm[0]+runnerSource());
  const dispatch="if(action==='host_action_v2_installer_v1')return applyHostActionV2InstallerV1();";
  assertOnce(out,dispatch,'exec_dispatch');
  const cases=Object.keys(ACTIONS).map(action=>`if(action==='${action}')return runWahaStudentBridgeAction('${action}');`).join('');
  out=out.replace(dispatch,cases+dispatch);
  return out;
}

function patchPolicy(source){
  let doc;try{doc=JSON.parse(source)}catch{fail('policy_json_invalid')}
  const operations=doc.operations||doc.action_levels;
  const scopes=doc.typed_scopes||doc.rules;
  if(!operations||typeof operations!=='object'||Array.isArray(operations))fail('policy_operations_missing');
  if(!Array.isArray(scopes))fail('policy_scopes_missing');
  for(const action of Object.keys(ACTIONS)){
    const operation=`host_action.${action}`;
    if(operations[operation]||scopes.some(x=>x&&x.action===action))fail('policy_already_registered');
  }
  for(const [action,spec] of Object.entries(ACTIONS)){
    const operation=`host_action.${action}`;
    operations[operation]=spec.risk==='high'?{level:spec.level,risk:'high'}:{level:spec.level};
    scopes.push({tool:'host_action_v2_apply',project:'control_plane',environment:'production',action,risk:spec.risk,operation,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
  }
  doc.version=CONTRACT.policy_version;
  return JSON.stringify(doc,null,2)+'\n';
}

function patchMcp(source){
  for(const action of Object.keys(ACTIONS)) if(source.includes(action)) fail('mcp_already_registered');
  const re=/const HostActionV2=z\.enum\(\[([\s\S]*?)\]\);/;
  const m=source.match(re);if(!m)fail('mcp_enum_anchor_missing');
  const extra=Object.keys(ACTIONS).map(x=>`'${x}'`).join(',');
  const body=m[1].trim();
  return source.replace(re,`const HostActionV2=z.enum([${body}${body?',':''}${extra}]);`);
}

function buildPlan(){
  return {schema_version:CONTRACT.schema_version,targets:[
    {key:'base',path:CONTRACT.paths.base,preimage_sha256:CONTRACT.preimages.base},
    {key:'exec',path:CONTRACT.paths.exec,preimage_sha256:CONTRACT.preimages.exec},
    {key:'policy',path:CONTRACT.paths.policy,preimage_sha256:CONTRACT.preimages.policy},
    {key:'mcp',path:CONTRACT.paths.mcp,preimage_sha256:CONTRACT.preimages.mcp},
    {key:'helper',path:CONTRACT.helper_target,source:path.join(__dirname,CONTRACT.helper_path),source_sha256:CONTRACT.helper_sha256},
  ],requires_zdt_refresh:true,service_control:false,database_mutation:false};
}

function regularBytes(file){
  const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(file)!==file)fail('target_not_regular:'+file);return fs.readFileSync(file);
}
function syntaxCheck(label,bytes){
  const ext=label==='policy'?'.json':'.js';const tmp=`/tmp/prhm-waha-reg-${label}-${process.pid}-${Date.now()}${ext}`;
  fs.writeFileSync(tmp,bytes,{flag:'wx',mode:0o600});
  try{
    if(label==='policy'){JSON.parse(bytes.toString('utf8'));return}
    const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check',tmp],{encoding:'utf8',timeout:20000,maxBuffer:120000});
    if(r.error||r.status!==0)fail('syntax_'+label+':'+String(r.stderr||r.stdout||r.error?.message||''));
  }finally{try{fs.unlinkSync(tmp)}catch{}}
}
function candidates(){
  const current={};for(const key of ['base','exec','policy','mcp']) current[key]=regularBytes(CONTRACT.paths[key]);
  for(const key of Object.keys(current)){const got=sha(current[key]);if(got!==CONTRACT.preimages[key])fail(`${key}_preimage_sha_mismatch:${got}`)}
  const helperSource=regularBytes(path.join(__dirname,CONTRACT.helper_path));
  const helperSha=sha(helperSource);if(helperSha!==CONTRACT.helper_sha256)fail('helper_source_sha_mismatch:'+helperSha);
  if(fs.existsSync(CONTRACT.helper_target))fail('helper_target_already_exists');
  const next={
    base:Buffer.from(patchBase(current.base.toString('utf8'))),
    exec:Buffer.from(patchExec(current.exec.toString('utf8'))),
    policy:Buffer.from(patchPolicy(current.policy.toString('utf8'))),
    mcp:Buffer.from(patchMcp(current.mcp.toString('utf8'))),
    helper:helperSource,
  };
  for(const key of ['base','exec','policy','mcp'])syntaxCheck(key,next[key]);
  syntaxCheck('helper',next.helper);
  return {current,next};
}
function preflight(){
  if(process.getuid&&process.getuid()!==0)fail('root_required');
  const c=candidates();return {ok:true,...buildPlan(),preflight_only:true,candidate_sha256:Object.fromEntries(Object.entries(c.next).map(([k,v])=>[k,sha(v)]))};
}
function atomicReplace(file,bytes,st){
  const tmp=file+'.waha-reg-'+process.pid+'-'+Date.now()+'.tmp';const fd=fs.openSync(tmp,'wx',st.mode&0o777);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.chownSync(tmp,st.uid,st.gid);fs.chmodSync(tmp,st.mode&0o777);fs.renameSync(tmp,file);
}
function atomicCreate(file,bytes,mode,uid,gid){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o755});const tmp=file+'.waha-reg-'+process.pid+'-'+Date.now()+'.tmp';const fd=fs.openSync(tmp,'wx',mode);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.chownSync(tmp,uid,gid);fs.chmodSync(tmp,mode);fs.renameSync(tmp,file);
}
function apply(){
  const c=candidates();const stats={};for(const key of ['base','exec','policy','mcp'])stats[key]=fs.statSync(CONTRACT.paths[key]);
  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);const backupDir='/var/backups/prhm-waha-student-bridge-registration-'+stamp;fs.mkdirSync(backupDir,{recursive:false,mode:0o700});
  for(const key of ['base','exec','policy','mcp'])fs.writeFileSync(path.join(backupDir,key+'.bak'),c.current[key],{flag:'wx',mode:0o600});
  const changed=[];let helperCreated=false;
  try{
    for(const key of ['base','exec','policy','mcp']){atomicReplace(CONTRACT.paths[key],c.next[key],stats[key]);changed.push(key)}
    const execStat=stats.exec;atomicCreate(CONTRACT.helper_target,c.next.helper,0o700,execStat.uid,execStat.gid);helperCreated=true;
    for(const key of ['base','exec','policy','mcp'])if(sha(fs.readFileSync(CONTRACT.paths[key]))!==sha(c.next[key]))fail('post_sha_mismatch:'+key);
    if(sha(fs.readFileSync(CONTRACT.helper_target))!==CONTRACT.helper_sha256)fail('post_sha_mismatch:helper');
    return {ok:true,...buildPlan(),installed:true,backup_dir:backupDir,rollback_performed:false,candidate_sha256:Object.fromEntries(Object.entries(c.next).map(([k,v])=>[k,sha(v)]))};
  }catch(error){
    const rb=[];
    if(helperCreated)try{fs.unlinkSync(CONTRACT.helper_target)}catch(e){rb.push('helper:'+e.message)}
    for(const key of [...changed].reverse())try{atomicReplace(CONTRACT.paths[key],c.current[key],stats[key])}catch(e){rb.push(key+':'+e.message)}
    if(rb.length)fail('registration_failed_rollback_failed:'+String(error.message||error)+':'+rb.join('|'));
    fail('registration_failed_rolled_back:'+String(error.message||error));
  }
}

function main(){
  const args=process.argv.slice(2);if(args.length!==1||!['--preflight-only','--apply'].includes(args[0]))fail('unexpected_arguments');
  process.stdout.write(JSON.stringify(args[0]==='--preflight-only'?preflight():apply())+'\n');
}

module.exports={CONTRACT,modesForAction,patchBase,patchExec,patchPolicy,patchMcp,buildPlan,preflight,apply};
if(require.main===module){try{main()}catch(error){process.stderr.write(JSON.stringify({ok:false,schema_version:CONTRACT.schema_version,error:String(error&&error.message||error)})+'\n');process.exit(1)}}
