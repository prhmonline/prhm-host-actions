#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const ACTION='company_os_dashboard_credentials_reset_v1';
const AUTH='/etc/prhm-company-os-dashboard/auth.json';
const OLD_CREDENTIALS='/var/lib/prhm-agent-selfmaint-exec/company-os-dashboard-v1/credentials.txt';
const RESULT_DIR='/var/lib/prhm-agent-selfmaint-exec/company-os-dashboard-credentials-reset-v1';
const RESULT=RESULT_DIR+'/latest.json';
const EXPECTED_AUTH_SHA='22a1af33eacab4dc898de9c871ecae9b80d29a418108c5c501336d6116a8adf3';
const EXPECTED_CREDENTIALS_SHA='17ab12cafb08d85d176117482a70da60ba4425ff4eccebda3b82325eec68e4f8';
const NEW_PASSWORD_SHA256='18d82cd3f88b48f1a0235386c266bc5be120d178192892059252152682b3fe3e';
const EXPECTED_NEW_AUTH_SHA='25a5bc0070a9497d8c500a0ab7f4e1666b8e6cd564a7653607cb3d8df780fc15';
const NODE='/usr/local/bin/prhm-node';
function fail(m){throw new Error(m)}
function shaBuf(b){return crypto.createHash('sha256').update(b).digest('hex')}
function shaFile(f){return shaBuf(fs.readFileSync(f))}
function atomic(file,data,mode,uid=0,gid=48){const tmp=file+'.tmp-'+process.pid+'-'+Date.now();fs.writeFileSync(tmp,data,{mode});fs.chownSync(tmp,uid,gid);fs.chmodSync(tmp,mode);fs.renameSync(tmp,file)}
function baseline(){
 if(!fs.existsSync(AUTH))fail('auth_missing'); if(!fs.existsSync(OLD_CREDENTIALS))fail('old_credentials_missing');
 if(shaFile(AUTH)!==EXPECTED_AUTH_SHA)fail('auth_sha_mismatch'); if(shaFile(OLD_CREDENTIALS)!==EXPECTED_CREDENTIALS_SHA)fail('old_credentials_sha_mismatch');
 const a=fs.statSync(AUTH),c=fs.statSync(OLD_CREDENTIALS); if((a.mode&0o777)!==0o640||a.uid!==0||a.gid!==48)fail('auth_metadata_mismatch'); if((c.mode&0o777)!==0o600||c.uid!==0||c.gid!==0)fail('credentials_metadata_mismatch');
 const j=JSON.parse(fs.readFileSync(AUTH,'utf8')); if(j.username!=='mohammad'||typeof j.password_sha256!=='string'||!/^[a-f0-9]{64}$/.test(j.password_sha256))fail('auth_schema_invalid');
 const x=cp.spawnSync('/usr/bin/systemctl',['is-active','prhm-company-os-dashboard.service'],{encoding:'utf8'}); if(x.status!==0)fail('dashboard_service_not_active');
 return true;
}
function candidate(){const s=JSON.stringify({username:'mohammad',password_sha256:NEW_PASSWORD_SHA256},null,2)+'\n'; if(shaBuf(Buffer.from(s))!==EXPECTED_NEW_AUTH_SHA)fail('candidate_auth_sha_internal_mismatch'); return s}
function persist(x){fs.mkdirSync(RESULT_DIR,{recursive:true,mode:0o700});fs.chmodSync(RESULT_DIR,0o700);atomic(RESULT,JSON.stringify(x,null,2)+'\n',0o600,0,0)}
function resultBase(){return {schema_version:'prhm.host-action-result.v1',action:ACTION,username:'mohammad',password_sha256:NEW_PASSWORD_SHA256,old_auth_sha:EXPECTED_AUTH_SHA,new_auth_sha:EXPECTED_NEW_AUTH_SHA,old_plaintext_credentials_sha:EXPECTED_CREDENTIALS_SHA,database_mutation:false,business_mutation:false,p0_live:false,p0_decision:false,proposal_send:false,bid_send:false,auto_send:false}}
function preflight(){baseline();candidate();return {...resultBase(),ok:true,preflight_only:true,auth_mutation:false,plaintext_secret_embedded:false,old_plaintext_credentials_present:true}}
function main(){
 const args=process.argv.slice(2);if(args.length>1||(args.length===1&&args[0]!=='--preflight-only'))fail('unexpected_arguments');if(process.getuid&&process.getuid()!==0)fail('must_run_as_root');
 if(args[0]==='--preflight-only'){process.stdout.write(JSON.stringify(preflight())+'\n');return}
 baseline();const next=candidate();const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14),backup='/var/backups/prhm-company-os-dashboard-credentials-reset-'+stamp;fs.mkdirSync(backup,{recursive:true,mode:0o700});fs.copyFileSync(AUTH,path.join(backup,'auth.json'));fs.copyFileSync(OLD_CREDENTIALS,path.join(backup,'credentials.txt'));fs.chmodSync(path.join(backup,'auth.json'),0o600);fs.chmodSync(path.join(backup,'credentials.txt'),0o600);
 let ok=false;try{
   atomic(AUTH,next,0o640,0,48);if(shaFile(AUTH)!==EXPECTED_NEW_AUTH_SHA)fail('new_auth_sha_mismatch');
   fs.unlinkSync(OLD_CREDENTIALS);if(fs.existsSync(OLD_CREDENTIALS))fail('old_plaintext_credentials_cleanup_failed');
   fs.unlinkSync(path.join(backup,'credentials.txt'));if(fs.existsSync(path.join(backup,'credentials.txt')))fail('backup_plaintext_credentials_cleanup_failed');
   const out={...resultBase(),ok:true,installed:true,credentials_rotated:true,old_plaintext_credentials_removed:true,backup_plaintext_credentials_removed:true,backup_dir:backup};persist(out);ok=true;process.stdout.write(JSON.stringify(out)+'\n');
 }finally{if(!ok){try{atomic(AUTH,fs.readFileSync(path.join(backup,'auth.json')),0o640,0,48);if(!fs.existsSync(OLD_CREDENTIALS))atomic(OLD_CREDENTIALS,fs.readFileSync(path.join(backup,'credentials.txt')),0o600,0,0)}catch(rb){process.stderr.write('rollback_failed:'+String(rb&&rb.stack||rb)+'\n')}}}
}
main();
