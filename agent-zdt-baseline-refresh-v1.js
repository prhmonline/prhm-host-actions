#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');

const ACTION='agent_zdt_baseline_refresh_v1';
const TARGET='/opt/prhm-agent-selfmaint-exec/actions/agent-zero-downtime-bootstrap-v1.js';
const TARGET_BEFORE='a54e2890eb455c078a4e09e92e007d71545f834dfec7d8d62bb232e1c91406b4';
const RESULT='/var/lib/prhm-agent-selfmaint-exec/agent-zdt-baseline-refresh-v1/latest.json';
const BACKUP_ROOT='/var/backups/prhm-agent-zdt-baseline-refresh-v1';
const NODE='/usr/local/bin/prhm-node';
const REPLACEMENTS=Object.freeze([
  ['ebe988fb99794ed3e09b2cefa7496c2d47c967a850b900a117b6b762b388cc34','7362fcf00bff04e46287df574f875110603d8c7da8b1bb207e9e609dc86c5b85'],
  ['fcf4420ab9b9c0b540f0e88f923065e16a331580cd238a097b9b1c53db34b2d0','b1f618ea5efeaa82b0d63bdf044ba82f8cea43f2ed5569b1a7bf706529717a80'],
  ['5c6ffbd60a5347ad2f21352de856bde2033b7ad5b3599301afd3139be8791102','70368fdc8be24646b10d414f6159502c2f3d338ed1132451d5b5740d1270999c'],
  ['b084b501b2ea572b39336e45673b4d987a6f7cdb10c769a4db3191ce86ca2877','b0ada3809307005d7715a1c7c970687b65ace82e765c8dfaeb5408061477b4ae'],
  ['5346b24f88c19121898288bd197a8dbe2a18a8c587402cfcd5a27afcfeadacad','6b945fcb3afe8ef3e074b07745912c5183f28826728bf4d14ed93c1161c961ba']
]);
const SOURCES=Object.freeze({
  '/home/agent/ssh-mcp-server/server.js':'558ff55244f43ac60178a6fec0eddd4068223318b25308d42cdf79d92203098f',
  '/home/agent/ssh-mcp-server/src/core/registry.js':'cf3681ca4d4632156df2f77886afe59c07da9a86dbcb68f4217577f811b22231',
  '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js':'7362fcf00bff04e46287df574f875110603d8c7da8b1bb207e9e609dc86c5b85',
  '/home/agent/ssh-mcp-server/src/plugins/selfmaint.js':'b1f618ea5efeaa82b0d63bdf044ba82f8cea43f2ed5569b1a7bf706529717a80',
  '/home/agent/ssh-agent-api/server.js':'70368fdc8be24646b10d414f6159502c2f3d338ed1132451d5b5740d1270999c',
  '/opt/prhm-agent-selfmaint/server.js':'b0ada3809307005d7715a1c7c970687b65ace82e765c8dfaeb5408061477b4ae',
  '/opt/prhm-agent-selfmaint-exec/server.js':'6b945fcb3afe8ef3e074b07745912c5183f28826728bf4d14ed93c1161c961ba',
  '/opt/prhm-agent-zdt/router.mjs':'53b904296da0e9d1490bfc7e3ef0b9c1fbad602a1e693141108f016764ebbe78',
  '/opt/prhm-agent-zdt/api-slot-launcher.cjs':'d20793dc79ee6d0ffa2ee4bb3b4d5dc1c66750ba0e04f821acb3a45421dcb5ea'
});
function shaBuf(b){return crypto.createHash('sha256').update(b).digest('hex');}
function shaFile(f){return shaBuf(fs.readFileSync(f));}
function safeRegular(f){const s=fs.lstatSync(f);return s.isFile()&&!s.isSymbolicLink();}
function count(s,n){return s.split(n).length-1;}
function fail(m){throw new Error(m);}
function verifySources(){let n=0;for(const [f,e] of Object.entries(SOURCES)){if(!fs.existsSync(f)||!safeRegular(f))fail('source_unsafe:'+f);const a=shaFile(f);if(a!==e)fail('source_sha_mismatch:'+f+':'+a);n++;}return n;}
function deriveCandidate(original){const text=original.toString('utf8');if(!Buffer.from(text,'utf8').equals(original))fail('target_not_utf8');let out=text;for(const [oldSha,newSha] of REPLACEMENTS){if(count(out,oldSha)!==1)fail('old_literal_count_invalid:'+oldSha);if(count(out,newSha)!==0)fail('new_literal_already_present:'+newSha);out=out.replace(oldSha,newSha);}for(const [oldSha,newSha] of REPLACEMENTS){if(count(out,oldSha)!==0||count(out,newSha)!==1)fail('replacement_verification_failed');}return Buffer.from(out,'utf8');}
function syntaxCheck(bytes){const f='/tmp/agent-zdt-baseline-refresh-'+process.pid+'-'+Date.now()+'.js';try{fs.writeFileSync(f,bytes,{flag:'wx',mode:0o600});const r=cp.spawnSync(NODE,['--check',f],{encoding:'utf8',timeout:30000,env:{PATH:'/usr/local/bin:/usr/bin:/bin',LC_ALL:'C'}});if(r.status!==0)fail('candidate_syntax_failed:'+String(r.stderr||r.stdout||'').slice(-800));}finally{try{fs.unlinkSync(f)}catch{}}}
function atomicWrite(file,bytes,meta,label){const tmp=file+'.'+label+'-'+process.pid+'-'+Date.now()+'.tmp';let fd;try{fd=fs.openSync(tmp,'wx',meta.mode);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.fchmodSync(fd,meta.mode);fs.fchownSync(fd,meta.uid,meta.gid);fs.closeSync(fd);fd=null;fs.renameSync(tmp,file);}finally{if(fd!==undefined&&fd!==null)try{fs.closeSync(fd)}catch{};try{fs.unlinkSync(tmp)}catch{}}}
function persist(v){fs.mkdirSync(path.dirname(RESULT),{recursive:true,mode:0o700});const t=RESULT+'.'+process.pid+'.tmp';fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(t,RESULT);}
function preflight(){if(process.argv.length!==2)fail('unexpected_arguments');if(process.getuid&&process.getuid()!==0)fail('root_required');if(!fs.existsSync(TARGET)||!safeRegular(TARGET))fail('target_unsafe');const actual=shaFile(TARGET);if(actual!==TARGET_BEFORE)fail('target_sha_mismatch:'+actual);const sourceCount=verifySources();const original=fs.readFileSync(TARGET);const candidate=deriveCandidate(original);syntaxCheck(candidate);return{original,candidate,candidate_sha256:shaBuf(candidate),source_hashes_verified:sourceCount,meta:{mode:fs.statSync(TARGET).mode&0o777,uid:fs.statSync(TARGET).uid,gid:fs.statSync(TARGET).gid}};}
function apply(){const started_at=new Date().toISOString();let backup=null;let mutated=false;let state;try{state=preflight();const stamp=new Date().toISOString().replace(/[:.]/g,'-');const dir=path.join(BACKUP_ROOT,stamp);fs.mkdirSync(dir,{recursive:true,mode:0o700});backup=path.join(dir,'agent-zero-downtime-bootstrap-v1.js.bak');fs.writeFileSync(backup,state.original,{mode:0o600,flag:'wx'});atomicWrite(TARGET,state.candidate,state.meta,'apply');mutated=true;const after=shaFile(TARGET);if(after!==state.candidate_sha256)fail('post_write_sha_mismatch:'+after);syntaxCheck(fs.readFileSync(TARGET));verifySources();const text=fs.readFileSync(TARGET,'utf8');for(const [oldSha,newSha] of REPLACEMENTS){if(count(text,oldSha)!==0||count(text,newSha)!==1)fail('post_write_replacement_mismatch');}const r={ok:true,action:ACTION,schema_version:'prhm.host-action-result.v1',target_file_match:true,source_hashes_verified:9,replacements_applied:5,unexpected_changes:0,candidate_sha256:state.candidate_sha256,rollback_performed:false,backup_path:backup,started_at,finished_at:new Date().toISOString()};persist(r);return r;}catch(error){let rollback_performed=false;let rollback_ok=false;if(mutated&&backup){rollback_performed=true;try{const bytes=fs.readFileSync(backup);const st=fs.statSync(TARGET);atomicWrite(TARGET,bytes,{mode:st.mode&0o777,uid:st.uid,gid:st.gid},'rollback');rollback_ok=shaFile(TARGET)===TARGET_BEFORE;}catch{rollback_ok=false;}}const r={ok:false,action:ACTION,schema_version:'prhm.host-action-result.v1',error:String(error?.message||error).slice(0,1000),rollback_performed,rollback_ok,started_at,finished_at:new Date().toISOString()};try{persist(r)}catch{};throw error;}}
module.exports={ACTION,TARGET,TARGET_BEFORE,REPLACEMENTS,SOURCES,deriveCandidate,verifySources,preflight,apply};
if(require.main===module){try{console.log(JSON.stringify(apply()));}catch(e){console.error(String(e?.stack||e));process.exit(1);}}
