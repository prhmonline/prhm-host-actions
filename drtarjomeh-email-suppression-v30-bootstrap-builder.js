'use strict';

const crypto=require('node:crypto');

const TOOLS=Object.freeze([
  'drtarjomeh_email_suppression_bootstrap_request_v2',
  'drtarjomeh_email_suppression_bootstrap_status_v2',
  'drtarjomeh_email_suppression_bootstrap_apply_v2'
]);
const CONFIRM='CONFIRM_LEVEL_4_CRITICAL';
const REQUIRED_ARTIFACTS=Object.freeze([
  'bootstrap-host-actions-v30-drtarjomeh-email-suppression-release.js',
  'install-host-actions-v30-drtarjomeh-email-suppression-release.js',
  'SOURCE_COMMIT',
  'SHA256SUMS'
]);
const SHA=/^[a-f0-9]{64}$/;
const COMMIT=/^[a-f0-9]{40}$/;

function fail(code){throw new Error(code)}
function buildBridgeSource(binding){
  const baseSha=String(binding?.baseSha||'');
  const sourceCommit=String(binding?.sourceCommit||'');
  const artifacts=binding?.artifacts||{};
  if(!SHA.test(baseSha))fail('base_sha_invalid');
  if(!COMMIT.test(sourceCommit))fail('source_commit_invalid');
  for(const name of REQUIRED_ARTIFACTS)if(!SHA.test(String(artifacts[name]||'')))fail('artifact_binding_invalid:'+name);
  const expected=JSON.stringify(Object.fromEntries(REQUIRED_ARTIFACTS.map(n=>[n,artifacts[n]])),null,2);
  return `import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {textResult} from '../core/result.js';

const BASE_SHA='${baseSha}';
const SOURCE_COMMIT='${sourceCommit}';
const CONFIRM='CONFIRM_LEVEL_4_CRITICAL';
const REQUEST_TOOL='drtarjomeh_email_suppression_bootstrap_request_v2';
const STATUS_TOOL='drtarjomeh_email_suppression_bootstrap_status_v2';
const APPLY_TOOL='drtarjomeh_email_suppression_bootstrap_apply_v2';
const ARTIFACT_ROOT='/home/agent/ssh-mcp-server/.drtarjomeh-email-suppression-v30-root-of-trust';
const STATE_ROOT='/var/lib/prhm-agent-mcp-bootstrap/drtarjomeh-email-suppression-v30';
const RESULT_PATH='/var/lib/prhm-agent-selfmaint-exec/drtarjomeh-email-suppression-installer-v1/latest.json';
const INSTALLER=path.join(ARTIFACT_ROOT,'install-host-actions-v30-drtarjomeh-email-suppression-release.js');
const BASE_FILE=path.join(path.dirname(new URL(import.meta.url).pathname),'.safeFiles-drt-email-suppression-v30-base-'+BASE_SHA+'.mjs');
const TTL_MS=180000;
const EXPECTED=Object.freeze(${expected});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=code=>{throw new Error(code)};

function stateFile(id){if(!/^[0-9a-f-]{36}$/i.test(String(id||'')))fail('request_id_invalid');return path.join(STATE_ROOT,String(id)+'.json')}
function atomicJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+process.pid+'.'+Date.now()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value)+'\\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,file)}
function readState(id){const file=stateFile(id);const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(file)!==file)fail('request_state_invalid');const state=JSON.parse(fs.readFileSync(file,'utf8'));if(state.request_id!==id)fail('request_state_mismatch');return{file,state}}
function fixedRegular(file,expectedSha){const root=fs.realpathSync(ARTIFACT_ROOT);const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile())fail('artifact_not_regular');const real=fs.realpathSync(file);if(!real.startsWith(root+path.sep))fail('artifact_escape');const bytes=fs.readFileSync(real);if(sha(bytes)!==expectedSha)fail('artifact_sha_mismatch');return bytes}
function verifyArtifact(){for(const [name,digest] of Object.entries(EXPECTED))fixedRegular(path.join(ARTIFACT_ROOT,name),digest);if(fs.readFileSync(path.join(ARTIFACT_ROOT,'SOURCE_COMMIT'),'utf8')!==SOURCE_COMMIT+'\\n')fail('source_commit_mismatch');return true}
function parseLastJson(text){for(const line of String(text||'').trim().split(/\\n+/).reverse()){try{return JSON.parse(line)}catch{}}fail('preflight_result_missing')}
function runPreflight(){const r=spawnSync('/usr/local/bin/prhm-node',[INSTALLER,'--preflight-only'],{cwd:ARTIFACT_ROOT,encoding:'utf8',timeout:180000,maxBuffer:1024*1024,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/nonexistent'}});if(r.error||r.status!==0)fail('installer_preflight_failed');const out=parseLastJson(r.stdout);if(out?.ok!==true||out?.preflight!==true||out?.external_send_allowed!==false||out?.database_mutation!==false)fail('installer_preflight_contract_invalid');return out}
function scheduleInstall(){const unit='prhm-drt-email-suppression-v30-bootstrap-'+Date.now();const args=['--collect','--unit='+unit,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=PrivateDevices=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true','--property=ProtectControlGroups=true','--property=RestrictNamespaces=true','--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','--property=ReadWritePaths=/opt/prhm-agent-selfmaint /opt/prhm-agent-selfmaint-exec /opt/prhm-company-control-plane /home/agent/ssh-mcp-server/src/plugins /var/lib/prhm-agent-selfmaint-exec /var/backups/prhm-drtarjomeh-email-suppression-installer-v1 /run','--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',INSTALLER];const r=spawnSync('/usr/bin/systemd-run',args,{encoding:'utf8',timeout:30000,maxBuffer:200000});if(r.error||r.status!==0)fail('installer_schedule_failed');return unit}
function request(){const id=crypto.randomUUID(),now=Date.now();const state={ok:true,request_id:id,status:'pending',action:'drtarjomeh_email_suppression_bootstrap_v2',level:4,risk:'critical',one_time_use:true,second_confirmation_required:true,created_at:new Date(now).toISOString(),expires_at:new Date(now+TTL_MS).toISOString(),production_application_mutation:false,database_mutation:false,external_send_allowed:false};atomicJson(stateFile(id),state);return state}
function status(id){const{state}=readState(id);return{...state,expired:Date.now()>Date.parse(state.expires_at),external_send_allowed:false}}
function apply(id,confirmation){if(confirmation!==CONFIRM)fail('critical_second_confirmation_required');const{file,state}=readState(id);if(state.status!=='pending')fail('request_not_pending');if(Date.now()>Date.parse(state.expires_at)){state.status='expired';atomicJson(file,state);fail('request_expired')}state.status='applying';state.consumed_at=new Date().toISOString();atomicJson(file,state);try{verifyArtifact();runPreflight();try{fs.unlinkSync(RESULT_PATH)}catch(e){if(e.code!=='ENOENT')throw e}const unit=scheduleInstall();state.status='scheduled';state.unit=unit;state.scheduled_at=new Date().toISOString();atomicJson(file,state);return state}catch(error){state.status='failed';state.error=String(error?.message||error).slice(0,160);atomicJson(file,state);throw error}}

const baseBytes=fs.readFileSync(BASE_FILE);if(sha(baseBytes)!==BASE_SHA)throw new Error('safeFiles_base_sha_mismatch');
const base=await import(pathToFileURL(BASE_FILE).href+'?drt-email-suppression-v30='+BASE_SHA);
if(typeof base.registerSafeFilesPlugin!=='function')throw new Error('safeFiles_base_export_missing');

export function registerSafeFilesPlugin(mcp,context){
  base.registerSafeFilesPlugin(mcp,context);
  mcp.registerTool(REQUEST_TOOL,{title:'Request DrTarjomeh Email Suppression Bootstrap v2',description:'Create one fixed Level-4 one-time bootstrap request.',inputSchema:{},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}},async()=>textResult(request()));
  mcp.registerTool(STATUS_TOOL,{title:'DrTarjomeh Email Suppression Bootstrap v2 Status',description:'Read bounded state for one fixed bootstrap request.',inputSchema:{request_id:z.string().uuid()},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async a=>textResult(status(a.request_id)));
  mcp.registerTool(APPLY_TOOL,{title:'Apply DrTarjomeh Email Suppression Bootstrap v2',description:'Consume one fixed request after explicit Level-4 confirmation and schedule only the SHA-bound installer.',inputSchema:{request_id:z.string().uuid(),second_confirmation:z.literal(CONFIRM)},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}},async a=>textResult(apply(a.request_id,a.second_confirmation)));
}
`;
}

module.exports={TOOLS,CONFIRM,REQUIRED_ARTIFACTS,buildBridgeSource};
