#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');

const ACTION='control_plane_current_owner_bootstrap_repair_v1';
const OP='host_action.control_plane_current_owner_bootstrap_repair_v1';
const VERSION='control-plane-root-of-trust-current-owner-repair-v1';
const POLICY_VERSION='2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1';
const BACKUP_ROOT='/var/backups/prhm-root-of-trust-current-owner-repair-v1';
const HELPER_PATH='/opt/prhm-agent-selfmaint-exec/actions/control-plane-current-owner-bootstrap-repair-v1.js';
const INSTALLER_PATH='/opt/prhm-agent-selfmaint-exec/actions/host-action-v2-installer-v1.js';
const HELPER_BYTES=fs.readFileSync(path.join(__dirname,'control-plane-current-owner-bootstrap-repair-v1.js'));
const shaBytes=b=>crypto.createHash('sha256').update(b).digest('hex');
const HELPER_SHA=shaBytes(HELPER_BYTES);
const INSTALLER_POST_SHA='0f76d3ad65ba267c045dd545d249e0b2083f4aedf8983a109d3ee6446686fa1d';

const TARGETS=Object.freeze({
  base:Object.freeze({path:'/opt/prhm-agent-selfmaint/server.js',sha256:'de924f7319f3656d788ba5d3f89ef2910bf4b0e3f0b8b074e7cd3a534441d5ea',uid:0,gid:0,mode:0o644,service:'prhm-agent-selfmaint.service'}),
  exec:Object.freeze({path:'/opt/prhm-agent-selfmaint-exec/server.js',sha256:'6bba46890db31abc8eca7e7681753a4788c46170033a555a1106e05d0a7a66f9',uid:0,gid:0,mode:0o755,service:'prhm-agent-selfmaint-exec.service'}),
  policy:Object.freeze({path:'/opt/prhm-company-control-plane/config/approval-policy.json',sha256:'2fedd70a182aa351e269df95a1b9d829f5a0b18defe8871cb4045106948d711a',uid:0,gid:0,mode:0o644}),
  mcp_canonical:Object.freeze({path:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',sha256:'048e2db190c5548f47967447b3b564eefd0b7203cf6df84beb73c520d481633d',uid:0,gid:0,mode:0o600}),
  mcp_candidate:Object.freeze({path:'/home/agent/candidates/agent3-safe-delivery-profile-expansion/mcp/src/plugins/hostActionsV2.js',sha256:'b2f95b97dfa7e26ca717dfbec7871bf2f64286952548fb4d6d8e99908aeaacc0',uid:0,gid:0,mode:0o644,service:'prhm-agent-mcp-safe-delivery-candidate.service'}),
  helper:Object.freeze({path:HELPER_PATH,sha256:HELPER_SHA,uid:0,gid:0,mode:0o750,prestate:'absent'}),
  installer:Object.freeze({path:INSTALLER_PATH,sha256:'f8a7ae93395055dcdb13a84773716d860c7cbf99857a1c6409dcb113a90f5408',uid:0,gid:0,mode:0o750})
});
const REGISTRATION=Object.freeze({action:ACTION,operation:OP,level:4,risk:'critical',project:'control_plane',environment:'production',principal_id:'mohammad',role:'mcp-operator'});
const BASE_ANCHOR="  solo_company_selftest_v1: { operation: 'host_action.solo_company_selftest_v1', rollback: 'host-action-v2:solo-company-selftest-v1:synthetic-cleanup' },";
const BASE_ENTRY=`  ${ACTION}: { operation: '${OP}', rollback: 'host-action-v2:control-plane-current-owner-bootstrap-repair-v1:root-of-trust-restore' },`;
const EXEC_SPEC_ANCHOR="  solo_company_selftest_v1:{operation:'host_action.solo_company_selftest_v1',kind:'solo_company_selftest_v1'},";
const EXEC_SPEC_ENTRY=`  ${ACTION}:{operation:'${OP}',kind:'${ACTION}'},`;
const EXEC_INSERT_ANCHOR="const REAL_MARKET_SHADOW_UAT_HELPER=";
const EXEC_DISPATCH_ANCHOR="if(action==='solo_company_selftest_v1')return applySoloCompanySelftestV1();";
const EXEC_DISPATCH=`if(action==='${ACTION}')return applyControlPlaneCurrentOwnerBootstrapRepairV1();`;
const MCP_ANCHOR="'solo_company_selftest_v1',";
const MCP_ENTRY=`'solo_company_selftest_v1','${ACTION}',`;

function fail(code){throw new Error(code)}
function count(source,needle){return String(source).split(String(needle)).length-1}
function replaceOne(source,needle,replacement,label){const n=count(source,needle);if(n!==1)fail('anchor_mismatch:'+label+':'+n);return source.replace(needle,replacement)}
function manifest(){return {schema_version:'prhm.root-of-trust-current-owner-repair.manifest.v1',version:VERSION,action:ACTION,operation:OP,level:4,risk:'critical',zero_input:true,arbitrary_command:false,arbitrary_path:false,database_mutation:false,backup_root:BACKUP_ROOT,helper_sha256:HELPER_SHA,installer_post_sha256:INSTALLER_POST_SHA,registration:{...REGISTRATION},targets:Object.fromEntries(Object.entries(TARGETS).map(([k,v])=>[k,{...v}]))}}
function baseState(s){const exact=s.includes(BASE_ENTRY);const mentions=count(s,ACTION);if(exact&&mentions===2)return'exact';if(mentions!==0)fail('conflicting_registration:base');return'absent'}
function execState(s){const exact=s.includes(EXEC_SPEC_ENTRY)&&s.includes('function applyControlPlaneCurrentOwnerBootstrapRepairV1()')&&s.includes(EXEC_DISPATCH);const mentions=count(s,ACTION);if(exact&&mentions>=4)return'exact';if(mentions!==0)fail('conflicting_registration:exec');return'absent'}
function mcpState(s,label){const mentions=count(s,ACTION);if(mentions===1&&s.includes(`'${ACTION}'`))return'exact';if(mentions!==0)fail('conflicting_registration:'+label);return'absent'}
function desiredScope(x){return Boolean(x&&x.tool==='host_action_v2_apply'&&x.project==='control_plane'&&x.environment==='production'&&x.action===ACTION&&x.risk==='critical'&&x.operation===OP&&Array.isArray(x.principals)&&x.principals.length===1&&x.principals[0]?.principal_id==='mohammad'&&Array.isArray(x.principals[0]?.roles)&&x.principals[0].roles.length===1&&x.principals[0].roles[0]==='mcp-operator')}
function policyState(text){let p;try{p=JSON.parse(text)}catch{fail('policy_invalid_json')};if(!p.operations||typeof p.operations!=='object'||!Array.isArray(p.typed_scopes))fail('policy_shape_invalid');const op=p.operations[OP];const scopes=p.typed_scopes.filter(x=>x&&(x.action===ACTION||x.operation===OP));if(op===undefined&&scopes.length===0)return'absent';if(op&&op.level===4&&Object.keys(op).length===1&&scopes.length===1&&desiredScope(scopes[0]))return'exact';fail('conflicting_registration:policy')}
function buildExecApplyBlock(){return `\nconst CURRENT_OWNER_BOOTSTRAP_REPAIR_HELPER='${HELPER_PATH}';\nfunction applyControlPlaneCurrentOwnerBootstrapRepairV1(){\n  if(!fs.existsSync(CURRENT_OWNER_BOOTSTRAP_REPAIR_HELPER))throw new Error('current_owner_repair_helper_missing');\n  const unit='prhm-current-owner-bootstrap-repair-v1-'+Date.now();\n  const args=['--quiet','--wait','--pipe','--unit='+unit,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=ReadWritePaths=/opt/prhm-agent-selfmaint-exec/actions /var/backups/prhm-current-owner-bootstrap-repair-v1','--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',CURRENT_OWNER_BOOTSTRAP_REPAIR_HELPER,'apply'];\n  const raw=cp.execFileSync('/usr/bin/systemd-run',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:240000,maxBuffer:400000}).trim();\n  const line=raw.split(/\\r?\\n/).filter(Boolean).at(-1)||''; let r;try{r=JSON.parse(line)}catch{throw new Error('current_owner_repair_result_invalid_json')}\n  if(r.ok!==true||r.action!=='${ACTION}'||r.database_mutation!==false||r.arbitrary_command!==false||r.arbitrary_path!==false)throw new Error('current_owner_repair_result_invalid');\n  return {ok:true,schema_version:'prhm.host-action-result.v1',action:'${ACTION}',production_mutation:r.production_mutation===true,database_mutation:false,rollback_performed:r.rollback_performed===true,candidate_sha256:r.candidate_sha256||null,changed:r.changed===true};\n}\n`;}
function patchBase(s){return replaceOne(s,BASE_ANCHOR,BASE_ENTRY+'\n'+BASE_ANCHOR,'base')}
function patchExec(s){let out=replaceOne(s,EXEC_SPEC_ANCHOR,EXEC_SPEC_ENTRY+'\n'+EXEC_SPEC_ANCHOR,'exec_spec');const idx=out.indexOf(EXEC_INSERT_ANCHOR);if(idx<0)fail('anchor_mismatch:exec_apply:0');out=out.slice(0,idx)+buildExecApplyBlock()+out.slice(idx);return replaceOne(out,EXEC_DISPATCH_ANCHOR,EXEC_DISPATCH_ANCHOR+EXEC_DISPATCH,'exec_dispatch')}
function patchPolicy(text){const p=JSON.parse(text);p.operations[OP]={level:4};p.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:ACTION,risk:'critical',operation:OP,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});p.version=POLICY_VERSION;return JSON.stringify(p,null,2)+'\n'}
function patchMcp(s,label){if(!s.includes('const HostActionV2=z.enum(['))fail('mcp_enum_missing:'+label);return replaceOne(s,MCP_ANCHOR,MCP_ENTRY,label)}
function buildCandidates(snapshot){if(!snapshot||typeof snapshot!=='object')fail('snapshot_invalid');for(const k of ['base','exec','policy','mcp_canonical','mcp_candidate'])if(typeof snapshot[k]!=='string')fail('snapshot_missing:'+k);const states={base:baseState(snapshot.base),exec:execState(snapshot.exec),policy:policyState(snapshot.policy),mcp_canonical:mcpState(snapshot.mcp_canonical,'mcp_canonical'),mcp_candidate:mcpState(snapshot.mcp_candidate,'mcp_candidate')};const vals=Object.values(states);if(vals.every(x=>x==='exact'))return{state:'exact',...snapshot};if(vals.some(x=>x==='exact'))fail('conflicting_registration:partial');return{state:'absent',base:patchBase(snapshot.base),exec:patchExec(snapshot.exec),policy:patchPolicy(snapshot.policy),mcp_canonical:patchMcp(snapshot.mcp_canonical,'mcp_canonical'),mcp_candidate:patchMcp(snapshot.mcp_candidate,'mcp_candidate')};}
function modeOf(st){return Number(st.mode)&0o777}
function assertTarget(adapter,key,target,{allowAbsent=false}={}){if(!adapter.exists(target.path)){if(allowAbsent)return false;fail('target_missing:'+key)}const st=adapter.stat(target.path);if(!st||st.isFile!==true||st.isSymlink===true)fail('target_invalid:'+key);if(adapter.realpath(target.path)!==target.path)fail('target_realpath_mismatch:'+key);if(Number(st.uid)!==target.uid||Number(st.gid)!==target.gid||modeOf(st)!==target.mode)fail('target_owner_mode_mismatch:'+key);return true}
async function preflight(adapter){if(!adapter)adapter=defaultAdapter();for(const k of ['base','exec','policy','mcp_canonical','mcp_candidate','installer'])assertTarget(adapter,k,TARGETS[k]);const helperExists=assertTarget(adapter,'helper',TARGETS.helper,{allowAbsent:true});if(helperExists&&adapter.sha256(HELPER_PATH)!==HELPER_SHA)fail('helper_conflict');const snapshot={base:adapter.read(TARGETS.base.path).toString('utf8'),exec:adapter.read(TARGETS.exec.path).toString('utf8'),policy:adapter.read(TARGETS.policy.path).toString('utf8'),mcp_canonical:adapter.read(TARGETS.mcp_canonical.path).toString('utf8'),mcp_candidate:adapter.read(TARGETS.mcp_candidate.path).toString('utf8')};const candidates=buildCandidates(snapshot);const installerSha=adapter.sha256(INSTALLER_PATH);if(candidates.state==='exact'){if(!helperExists||adapter.sha256(HELPER_PATH)!==HELPER_SHA||installerSha!==INSTALLER_POST_SHA)fail('conflicting_registration:poststate');return{ok:true,state:'ALREADY_APPLIED',changed:false,production_mutation:false,database_mutation:false}}
  for(const k of ['base','exec','policy','mcp_canonical','mcp_candidate','installer'])if(adapter.sha256(TARGETS[k].path)!==TARGETS[k].sha256)fail('baseline_sha_mismatch:'+k);if(helperExists)fail('helper_conflict');for(const k of ['base','exec','mcp_candidate']){const s=TARGETS[k].service;if(s&&await adapter.serviceActive(s)!==true)fail('service_not_active:'+s)}return{ok:true,state:'READY',changed:false,production_mutation:false,database_mutation:false,candidate_sha256:{base:shaBytes(Buffer.from(candidates.base)),exec:shaBytes(Buffer.from(candidates.exec)),policy:shaBytes(Buffer.from(candidates.policy)),mcp_canonical:shaBytes(Buffer.from(candidates.mcp_canonical)),mcp_candidate:shaBytes(Buffer.from(candidates.mcp_candidate)),helper:HELPER_SHA,installer_post:INSTALLER_POST_SHA}};}
async function apply(){fail('apply_not_implemented')}
function defaultAdapter(){return{exists:p=>fs.existsSync(p),read:p=>fs.readFileSync(p),sha256:p=>shaBytes(fs.readFileSync(p)),stat:p=>{const s=fs.lstatSync(p);return{isFile:s.isFile(),isSymlink:s.isSymbolicLink(),uid:s.uid,gid:s.gid,mode:s.mode}},realpath:p=>fs.realpathSync(p),serviceActive:async s=>cp.spawnSync('/usr/bin/systemctl',['is-active','--quiet',s]).status===0}}
function main(argv=process.argv.slice(2)){if(!Array.isArray(argv)||argv.length!==0)fail('unexpected_cli_argument');return preflight(defaultAdapter())}
module.exports={manifest,buildCandidates,preflight,apply,main};
if(require.main===module)main([]).then(r=>process.stdout.write(JSON.stringify(r)+'\n')).catch(e=>{process.stderr.write(String(e&&e.message||e)+'\n');process.exitCode=1});
