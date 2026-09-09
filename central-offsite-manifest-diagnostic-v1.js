#!/usr/local/bin/prhm-node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process'),Module=require('module');
const BASE_SHA='f767b783f90af1d860a81439cdbcb48534d943fcfa1b13c87c93520a34f5eedd';
const SNAP_ROOT='/var/backups/prhm-central';
const SNAP_RE=/^20[0-9]{6}T[0-9]{6}Z$/;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(m){throw new Error(m)}
function loadBase(){
  const names=fs.readdirSync(__dirname).filter(n=>n.startsWith('opsSelfmaintBridge.js.agent-backup.')).sort().reverse();
  for(const name of names){const p=path.join(__dirname,name);let st;try{st=fs.lstatSync(p)}catch{continue}if(!st.isFile()||st.isSymbolicLink())continue;const b=fs.readFileSync(p);if(sha(b)===BASE_SHA)return b}
  fail('central_offsite_manifest_diag_base_backup_missing');
}
let bm=null;
function loadBaseModule(){if(bm)return bm;const bytes=loadBase();const m=new Module(__filename,module);m.filename=__filename;m.paths=module.paths;m._compile(bytes.toString('utf8'),__filename);if(!m.exports||typeof m.exports.createOpsSelfmaintBridge!=='function')fail('central_offsite_manifest_diag_base_contract_invalid');bm=m;return bm}
function classifyManifestText(text){
  const lines=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,512);
  let formatted_line_count=0,key_value_line_count=0;const keys=[];
  for(const line of lines){
    if(/^[a-f0-9]{64}\s+\*?.+$/i.test(line))formatted_line_count++;
    const m=line.match(/^([A-Za-z][A-Za-z0-9_.-]{0,63})=(.*)$/);if(m){key_value_line_count++;keys.push(m[1]);}
  }
  let format='other';
  if(lines.length&&formatted_line_count===lines.length)format='sha256sum';
  else if(lines.length&&lines.every(x=>/^[a-f0-9]{64}$/i.test(x)))format='sha256_only';
  else if(lines.length&&(['{','['].includes(lines[0][0])))format='json';
  else if(lines.length&&key_value_line_count===lines.length)format='key_value';
  if(format==='key_value')return{line_count:lines.length,formatted_line_count,key_value_line_count,keys,format};
  return{line_count:lines.length,formatted_line_count,format};
}
function parseCheckLines(lines){
  const failures=[];let warning_count=0;
  for(const raw of lines.slice(0,256)){
    const line=String(raw||'').trim();if(!line)continue;
    if(/^sha256sum:\s+WARNING:/.test(line)){warning_count++;continue}
    let m=line.match(/^sha256sum:\s+(.*?):\s+No such file or directory$/);if(m){failures.push({entry:path.basename(m[1]).slice(0,180),reason:'missing'});continue}
    m=line.match(/^(.*?):\s*FAILED open or read$/);if(m){failures.push({entry:path.basename(m[1]).slice(0,180),reason:'unreadable'});continue}
    m=line.match(/^(.*?):\s*FAILED$/);if(m){failures.push({entry:path.basename(m[1]).slice(0,180),reason:'checksum'});continue}
  }
  return{failures:failures.slice(0,64),warning_count};
}
function run(){
  const snaps=fs.readdirSync(SNAP_ROOT,{withFileTypes:true}).filter(x=>x.isDirectory()&&SNAP_RE.test(x.name)).map(x=>x.name).sort();
  if(!snaps.length)fail('central_offsite_snapshot_missing');
  const snapshot=snaps.at(-1),root=path.join(SNAP_ROOT,snapshot),manifest=path.join(root,'MANIFEST');
  const st=fs.lstatSync(manifest);if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(manifest)!==manifest)fail('central_offsite_manifest_invalid');
  const manifestBytes=fs.readFileSync(manifest),manifest_sha256=sha(manifestBytes),manifest_format=classifyManifestText(manifestBytes.toString('utf8'));
  const r=cp.spawnSync('/usr/bin/sha256sum',['-c','MANIFEST'],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:400000});
  const lines=(String(r.stdout||'')+'\n'+String(r.stderr||'')).split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,256),parsed=parseCheckLines(lines);
  return{ok:true,action:'central_offsite_manifest_diagnostic_v1',read_only:true,snapshot,manifest_sha256,manifest_ok:r.status===0,exit_code:Number.isInteger(r.status)?r.status:null,signal:r.signal||null,spawn_error:r.error?String(r.error.message||r.error).slice(0,240):null,checked_line_count:lines.length,failures:parsed.failures,warning_count:parsed.warning_count,manifest_line_count:manifest_format.line_count,formatted_line_count:manifest_format.formatted_line_count,manifest_format:manifest_format.format,key_value_line_count:manifest_format.key_value_line_count||0,manifest_keys:manifest_format.keys||[]};
}
function createOpsSelfmaintBridge(){const base=loadBaseModule().exports.createOpsSelfmaintBridge();return{async execute(command,ctx={}){let s=null;try{s=JSON.parse(command)}catch{}if(s&&s.operation==='central_offsite_manifest_diagnostic'){if(Object.keys(s).length!==1)fail('unexpected control-plane field');return run()}return base.execute(command,ctx)}}}
module.exports={createOpsSelfmaintBridge,run,SNAP_ROOT,parseCheckLines,classifyManifestText};
