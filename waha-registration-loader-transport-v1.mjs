import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { z } from 'file:///home/agent/ssh-mcp-server/node_modules/zod/index.js';

const BASE_SHA='fdcceca36c46c5b0f45d8c6376c74260d8ceb88a0b791f7b379189c9eeb9217a';
const LOADER_SHA='a08c2da3dd7effd5a75b5e75c484bc9148e7cae4c88449e9b67f4cac3d2ac1ec';
const LOADER_BYTES=17560;
const CHUNK_SIZES=Object.freeze([3000,3000,3000,3000,3000,2560]);
const STATUS='waha_registration_loader_transport_status_v1';
const CHUNK='waha_registration_loader_transport_chunk_v1';
const APPLY='waha_registration_loader_transport_apply_v1';
const CONFIRM='CONFIRM_LEVEL_4_CRITICAL';
const BACK='/var/backups/prhm-agent-selfmaint';
const PREFIX='agent_mcp-src_plugins_safeFiles.js-';
const SUFFIX='-'+BASE_SHA+'.bak';
const BASE_DIR='/tmp/prhm-waha-registration-loader-transport-base/src/plugins';
const BASE=path.join(BASE_DIR,'.safeFiles-waha-loader-transport-base-'+BASE_SHA+'.mjs');
const STATE='/var/lib/prhm-agent-selfmaint-exec/waha-registration-loader-transport-v1';
const PAYLOAD=path.join(STATE,'loader.mjs');
const META=path.join(STATE,'stage.json');
const LOCK=path.join(STATE,'.lock');
const TARGET='/home/agent/ssh-mcp-server/src/plugins/safeFiles.js';
const APPLY_BACK='/var/backups/prhm-waha-registration-loader-transport-v1';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=m=>{throw new Error(m)};
const textResult=v=>({content:[{type:'text',text:JSON.stringify(v)}]});

function materializedBase(){
  const name=fs.readdirSync(BACK).filter(n=>n.startsWith(PREFIX)&&n.endsWith(SUFFIX)).sort().reverse()[0];
  if(!name)fail('waha_loader_transport_base_backup_missing');
  const bytes=fs.readFileSync(path.join(BACK,name));
  if(sha(bytes)!==BASE_SHA)fail('waha_loader_transport_base_sha_mismatch');
  return bytes;
}
function ensureBase(){
  fs.mkdirSync(BASE_DIR,{recursive:true,mode:0o700});
  const bytes=materializedBase();
  try{if(sha(fs.readFileSync(BASE))===BASE_SHA)return;}catch{}
  const tmp=BASE+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,BASE);
  fs.chmodSync(BASE,0o600);
}
function ensureState(){fs.mkdirSync(STATE,{recursive:true,mode:0o700});fs.chmodSync(STATE,0o700)}
function withLock(fn){
  ensureState();
  let fd;
  try{fd=fs.openSync(LOCK,'wx',0o600);return fn();}
  finally{try{if(fd!==undefined)fs.closeSync(fd)}catch{};try{if(fd!==undefined)fs.unlinkSync(LOCK)}catch{}}
}
function writeMeta(value){
  const tmp=META+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,META);fs.chmodSync(META,0o600);
}
function readMeta(){try{return JSON.parse(fs.readFileSync(META,'utf8'))}catch{return null}}
function status(){
  const meta=readMeta();
  let received=0,actual=null;
  try{const b=fs.readFileSync(PAYLOAD);received=b.length;actual=sha(b)}catch{}
  return {ok:true,type:'waha-registration-loader-transport-status-v1',read_only:true,received_bytes:received,next_sequence:meta?.next_sequence??0,complete:received===LOADER_BYTES&&actual===LOADER_SHA,sha256:actual,expected_sha256:LOADER_SHA,expected_bytes:LOADER_BYTES,production_mutation:false};
}
function stageChunk(args){
  return withLock(()=>{
    const sequence=Number(args.sequence);const b64=String(args.chunk_base64||'');
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)||b64.length%4!==0)fail('waha_loader_transport_base64_invalid');
    const buf=Buffer.from(b64,'base64');
    if(buf.toString('base64')!==b64)fail('waha_loader_transport_base64_noncanonical');
    if(buf.length!==CHUNK_SIZES[sequence])fail('waha_loader_transport_chunk_size_mismatch');
    if(sequence===0){try{fs.unlinkSync(PAYLOAD)}catch{};try{fs.unlinkSync(META)}catch{};fs.writeFileSync(PAYLOAD,Buffer.alloc(0),{mode:0o600,flag:'wx'});writeMeta({next_sequence:0,received_bytes:0});}
    const meta=readMeta();
    if(!meta||meta.next_sequence!==sequence)fail('waha_loader_transport_sequence_mismatch');
    fs.appendFileSync(PAYLOAD,buf);fs.chmodSync(PAYLOAD,0o600);
    const received=fs.statSync(PAYLOAD).size;
    if(received>LOADER_BYTES)fail('waha_loader_transport_oversize');
    const next=sequence+1;
    writeMeta({next_sequence:next,received_bytes:received});
    let complete=false,actual=null;
    if(next===CHUNK_SIZES.length){
      if(received!==LOADER_BYTES)fail('waha_loader_transport_final_size_mismatch');
      actual=sha(fs.readFileSync(PAYLOAD));
      if(actual!==LOADER_SHA)fail('waha_loader_transport_final_sha_mismatch');
      complete=true;
    }
    return {ok:true,type:'waha-registration-loader-transport-chunk-v1',sequence,received_bytes:received,next_sequence:next,complete,sha256:actual,production_mutation:false};
  });
}
function preflightSyntax(){
  const r=spawnSync('/usr/local/bin/prhm-node',['--check',PAYLOAD],{encoding:'utf8',timeout:30000,maxBuffer:300000,env:{PATH:'/usr/local/bin:/usr/bin:/bin',LC_ALL:'C',HOME:'/nonexistent'}});
  if(r.error||r.status!==0)fail('waha_loader_transport_syntax_invalid:'+String(r.stderr||r.stdout||r.error||'').slice(-1000));
}
function parseLastJson(stdout){for(const line of String(stdout||'').trim().split(/\n+/).reverse()){try{const o=JSON.parse(line);if(o&&o.ok===true)return o}catch{}}fail('waha_loader_transport_result_missing')}
function helperSource(activeSha){
  return `'use strict';\nconst fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');\nconst TARGET=${JSON.stringify(TARGET)},PAYLOAD=${JSON.stringify(PAYLOAD)},BACK=${JSON.stringify(APPLY_BACK)},EXPECTED=${JSON.stringify(activeSha)},NEXT=${JSON.stringify(LOADER_SHA)};\nconst sha=b=>crypto.createHash('sha256').update(b).digest('hex');\nconst fail=m=>{throw new Error(m)};\nlet mutated=false,backup=null,old=null,st=null;\ntry{const lst=fs.lstatSync(TARGET);if(lst.isSymbolicLink()||!lst.isFile()||fs.realpathSync(TARGET)!==TARGET)fail('target_invalid');old=fs.readFileSync(TARGET);if(sha(old)!==EXPECTED)fail('target_sha_mismatch');const pl=fs.lstatSync(PAYLOAD);if(pl.isSymbolicLink()||!pl.isFile()||fs.realpathSync(PAYLOAD)!==PAYLOAD)fail('payload_invalid');const next=fs.readFileSync(PAYLOAD);if(next.length!==${LOADER_BYTES}||sha(next)!==NEXT)fail('payload_sha_mismatch');fs.mkdirSync(BACK,{recursive:true,mode:0o700});fs.chmodSync(BACK,0o700);st=fs.statSync(TARGET);backup=path.join(BACK,Date.now()+'-'+EXPECTED+'.bak');fs.writeFileSync(backup,old,{mode:0o600,flag:'wx'});const tmp=TARGET+'.waha-loader-'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,next,{mode:st.mode&0o777,flag:'wx'});fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,TARGET);mutated=true;if(sha(fs.readFileSync(TARGET))!==NEXT)fail('post_sha_mismatch');console.log(JSON.stringify({ok:true,installed:true,old_sha256:EXPECTED,new_sha256:NEXT,backup_path:backup,rollback_performed:false}));}catch(e){let rollback=false;if(mutated&&old&&st){try{const rb=TARGET+'.waha-loader-rb-'+crypto.randomUUID()+'.tmp';fs.writeFileSync(rb,old,{mode:st.mode&0o777,flag:'wx'});fs.chownSync(rb,st.uid,st.gid);fs.renameSync(rb,TARGET);rollback=true}catch{}}console.error(String(e&&e.message||e));console.log(JSON.stringify({ok:false,rollback_performed:rollback,error:String(e&&e.message||e).slice(0,500)}));process.exitCode=1;}\n`;
}
function applyTransport(args){
  if(!args||String(args.second_confirmation||'')!==CONFIRM)fail('critical_second_confirmation_required');
  const s=status();
  if(!s.complete||s.received_bytes!==LOADER_BYTES||sha(fs.readFileSync(PAYLOAD))!==LOADER_SHA)fail('waha_loader_transport_payload_not_ready');
  preflightSyntax();
  const activePath=fileURLToPath(import.meta.url);const activeSha=sha(fs.readFileSync(activePath));
  if(path.resolve(activePath)!==path.resolve(TARGET))fail('waha_loader_transport_active_path_mismatch');
  ensureState();fs.mkdirSync(APPLY_BACK,{recursive:true,mode:0o700});fs.chmodSync(APPLY_BACK,0o700);
  const helper=path.join(STATE,'.apply-'+process.pid+'-'+Date.now()+'.js');
  fs.writeFileSync(helper,helperSource(activeSha),{mode:0o700,flag:'wx'});
  try{
    const check=spawnSync('/usr/local/bin/prhm-node',['--check',helper],{encoding:'utf8',timeout:30000,maxBuffer:300000});
    if(check.error||check.status!==0)fail('waha_loader_transport_helper_syntax_invalid');
    const unit='prhm-waha-loader-transport-'+Date.now();
    const run=spawnSync('/usr/bin/systemd-run',[
      '--wait','--collect','--pipe','--quiet','--unit='+unit,
      '--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=PrivateDevices=true',
      '--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true','--property=ProtectControlGroups=true',
      '--property=RestrictAddressFamilies=AF_UNIX','--property=CapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_FOWNER','--property=AmbientCapabilities=','--property=RestrictNamespaces=true',
      '--property=ReadWritePaths=/home/agent/ssh-mcp-server/src/plugins','--property=ReadWritePaths=/var/backups/prhm-waha-registration-loader-transport-v1',
      '--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',helper
    ],{encoding:'utf8',timeout:120000,maxBuffer:500000});
    if(run.error||run.status!==0)fail('waha_loader_transport_sandbox_failed:'+String(run.stderr||run.stdout||run.error||'').slice(-1500));
    const out=parseLastJson(run.stdout);
    if(out.installed!==true||out.new_sha256!==LOADER_SHA||out.rollback_performed!==false)fail('waha_loader_transport_apply_result_invalid');
    return {ok:true,type:'waha-registration-loader-transport-apply-v1',installed:true,new_sha256:LOADER_SHA,backup_path:out.backup_path,rollback_performed:false,reload_required:'agent_zdt_existing_topology_rolling_refresh_v1',database_mutation:false,external_network:false};
  }finally{try{if(fs.existsSync(helper))fs.unlinkSync(helper)}catch{}}
}

ensureBase();
const base=await import(pathToFileURL(BASE).href+'?waha-loader-transport='+BASE_SHA);
if(typeof base.registerSafeFilesPlugin!=='function')fail('waha_loader_transport_base_export_missing');

export function registerSafeFilesPlugin(mcp,context){
  const result=base.registerSafeFilesPlugin(mcp,context);
  mcp.registerTool(STATUS,{title:'WAHA Loader Transport Status',description:'Read-only status of the fixed SHA-bound WAHA registration loader stage.',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async()=>textResult(status()));
  mcp.registerTool(CHUNK,{title:'Stage WAHA Loader Chunk',description:'Stage one of six fixed-size chunks for the single SHA-bound reviewed WAHA registration loader. No path, command, host, URL, mode, or target selection.',inputSchema:{sequence:z.number().int().min(0).max(5),chunk_base64:z.string().min(4).max(5000)},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}},async args=>textResult(stageChunk(args)));
  mcp.registerTool(APPLY,{title:'Apply WAHA Registration Loader',description:'After explicit Level-4 confirmation, atomically replace only the active SafeFiles overlay with the exact staged reviewed WAHA registration loader in a strict sandbox with rollback.',inputSchema:{second_confirmation:z.literal(CONFIRM)},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:false}},async args=>textResult(applyTransport(args)));
  return result;
}
// WAHA_REGISTRATION_LOADER_TRANSPORT_V1
