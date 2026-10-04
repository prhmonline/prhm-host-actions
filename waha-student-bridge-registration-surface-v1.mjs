import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { z } from 'file:///home/agent/ssh-mcp-server/node_modules/zod/index.js';

const BASE_SHA='fdcceca36c46c5b0f45d8c6376c74260d8ceb88a0b791f7b379189c9eeb9217a';
const BACK='/var/backups/prhm-agent-selfmaint';
const PREFIX='agent_mcp-src_plugins_safeFiles.js-';
const SUFFIX='-'+BASE_SHA+'.bak';
const STATE='/var/lib/prhm-agent-selfmaint-exec/waha-student-bridge-registration-surface-v1';
const BASE=path.join(STATE,'.safeFiles-waha-registration-base-'+BASE_SHA+'.mjs');
const REG=path.join(STATE,'waha-student-bridge-registration-v1.js');
const WORKER=path.join(STATE,'waha-student-bridge-install-v1.js');
const CONFIRM='CONFIRM_LEVEL_4_CRITICAL';
const PREFLIGHT='waha_student_bridge_registration_preflight_v1';
const APPLY='waha_student_bridge_registration_apply_v1';
const REG_SHA='35041977d41d349c7fcaa10f9116d39d7c6f6fcbfe158838b49ab64be93e154d';
const WORKER_SHA='9907f6df0a34151a6068c2c046b39b6943c6d816ff21520352e5a658c7523e96';
const REG_GZ_B64='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';
const WORKER_GZ_B64='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';

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=m=>{throw new Error(m)};
const textResult=v=>({content:[{type:'text',text:JSON.stringify(v)}]});
function materializedBase(){
  const name=fs.readdirSync(BACK).filter(n=>n.startsWith(PREFIX)&&n.endsWith(SUFFIX)).sort().reverse()[0];
  if(!name)fail('waha_registration_surface_base_backup_missing');
  const bytes=fs.readFileSync(path.join(BACK,name));
  if(sha(bytes)!==BASE_SHA)fail('waha_registration_surface_base_sha_mismatch');
  return bytes;
}
function ensureBase(){
  fs.mkdirSync(STATE,{recursive:true,mode:0o700});
  const bytes=materializedBase();
  try{if(sha(fs.readFileSync(BASE))===BASE_SHA)return;}catch{}
  const tmp=BASE+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});fs.renameSync(tmp,BASE);fs.chmodSync(BASE,0o600);
}
function inflateExact(b64,expected,label){
  const bytes=zlib.gunzipSync(Buffer.from(b64,'base64'));
  const actual=sha(bytes);if(actual!==expected)fail(label+'_sha_mismatch:'+actual);return bytes;
}
function writeExact(file,bytes,mode){
  const tmp=file+'.'+process.pid+'.'+Date.now()+'.tmp';fs.writeFileSync(tmp,bytes,{mode,flag:'wx'});fs.renameSync(tmp,file);fs.chmodSync(file,mode);
}
function materializeArtifacts(){
  fs.mkdirSync(STATE,{recursive:true,mode:0o700});fs.chmodSync(STATE,0o700);
  const reg=inflateExact(REG_GZ_B64,REG_SHA,'registration_source');
  const worker=inflateExact(WORKER_GZ_B64,WORKER_SHA,'worker_source');
  if(!fs.existsSync(REG)||sha(fs.readFileSync(REG))!==REG_SHA)writeExact(REG,reg,0o700);
  if(!fs.existsSync(WORKER)||sha(fs.readFileSync(WORKER))!==WORKER_SHA)writeExact(WORKER,worker,0o700);
  return {registration_sha256:REG_SHA,worker_sha256:WORKER_SHA};
}
function parseLastJson(stdout){
  for(const line of String(stdout||'').trim().split(/\n+/).reverse()){try{const o=JSON.parse(line);if(o&&typeof o==='object')return o}catch{}}
  fail('waha_registration_result_missing');
}
function runRegistration(mode){
  const artifacts=materializeArtifacts();
  const apply=mode==='--apply';
  const unit='prhm-waha-registration-'+(apply?'apply':'preflight')+'-'+Date.now();
  const args=['--wait','--collect','--pipe','--quiet','--unit='+unit,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=PrivateDevices=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true','--property=ProtectControlGroups=true','--property=RestrictAddressFamilies=AF_UNIX','--property=CapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_FOWNER','--property=AmbientCapabilities='];
  if(apply){
    args.push('--property=ReadWritePaths=/opt/prhm-agent-selfmaint');
    args.push('--property=ReadWritePaths=/opt/prhm-agent-selfmaint-exec');
    args.push('--property=ReadWritePaths=/opt/prhm-company-control-plane/config');
    args.push('--property=ReadWritePaths=/home/agent/ssh-mcp-server/src/plugins');
    args.push('--property=ReadWritePaths=/var/backups');
  }
  args.push('--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',REG,mode);
  const run=spawnSync('/usr/bin/systemd-run',args,{encoding:'utf8',timeout:apply?240000:90000,maxBuffer:1500000});
  if(run.error||run.status!==0)fail('waha_registration_sandbox_failed:'+String(run.stderr||run.stdout||run.error||'').slice(-3000));
  const out=parseLastJson(run.stdout);
  if(out.ok!==true||out.schema_version!=='prhm.waha-student-bridge-registration.v1')fail('waha_registration_result_invalid');
  if(out.database_mutation!==false||out.service_control!==false||out.requires_zdt_refresh!==true)fail('waha_registration_invariant_failed');
  if(apply&&out.installed!==true)fail('waha_registration_install_missing');
  if(!apply&&out.preflight_only!==true)fail('waha_registration_preflight_missing');
  return {ok:true,type:apply?'waha-student-bridge-registration-apply-v1':'waha-student-bridge-registration-preflight-v1',read_only:!apply,registration_sha256:artifacts.registration_sha256,worker_sha256:artifacts.worker_sha256,requires_zdt_refresh:true,database_mutation:false,service_control:false,result:out};
}

ensureBase();
const base=await import(pathToFileURL(BASE).href+'?waha-registration='+BASE_SHA);
if(typeof base.registerSafeFilesPlugin!=='function')fail('waha_registration_surface_base_export_missing');
export function registerSafeFilesPlugin(mcp,context){
  const result=base.registerSafeFilesPlugin(mcp,context);
  mcp.registerTool(PREFLIGHT,{title:'Preflight WAHA Student Bridge Registration',description:'Fixed zero-input read-only preflight of the reviewed SHA-bound WAHA Student Bridge registration bundle against the current Agent 3 control-plane owners.',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async()=>textResult(runRegistration('--preflight-only')));
  mcp.registerTool(APPLY,{title:'Apply WAHA Student Bridge Registration',description:'After explicit Level-4 confirmation, atomically register only the reviewed fixed WAHA Student Bridge Host Actions against exact live preimages. No database mutation or service restart; a separate approved ZDT refresh is required.',inputSchema:{second_confirmation:z.literal(CONFIRM)},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}},async args=>{if(String(args?.second_confirmation||'')!==CONFIRM)fail('critical_second_confirmation_required');return textResult(runRegistration('--apply'))});
  return result;
}
// WAHA_STUDENT_BRIDGE_REGISTRATION_SURFACE_V1
