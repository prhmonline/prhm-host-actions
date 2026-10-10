'use strict';
// Read-only, fixed-path preflight for migrating PRHM Google Drive backups
// from the retiring shared OAuth client. NEVER changes existing secrets/configs.
// Scope=drive is REQUIRED: drive.file is app-specific and would hide old bundles.
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
const ACTIVE='/etc/prhm-rclone/rclone.conf';
const CANDIDATE='/etc/prhm-rclone/rclone.oauth-candidate.conf';
const BINARY='/var/lib/prhm-central-gdrive-restic/rclone-1.75.0';
const STATE='/var/lib/prhm-central-gdrive-bundle/latest.json';
const SNAPSHOT='20261010T092103Z';
const BUNDLE=SNAPSHOT+'.restic-repo.tar';
const REMOTE='gdrive-backup:PRHM-Backups/bundles/central/'+BUNDLE;
const BYTE_SIZE=1328373760;
const BUNDLE_SHA='8977231a8447e2634720835d255a4ff1486b2f085ea32172ec8b54adf4a37f63';
const redactError=error=>String(error?.code||error?.name||'invalid').slice(0,45);
function parseSection(raw){
 const lines=String(raw).split(/\r?\n/),headers=[];
 const vals=Object.create(null);
 let inside=false;
 for(const line of lines){
  const header=line.match(/^\s*\[([^\]]+)\]\s*$/);
  if(header){headers.push(header[1]);inside=header[1]==='gdrive-backup';continue}
  if(!inside || /^\s*[#;]/.test(line) || !line.trim())continue;
  const m=line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if(!m)throw Error('INVALID_CONFIG_LINE');
  if(Object.prototype.hasOwnProperty.call(vals,m[1]))throw Error('DUPLICATE_CONFIG_KEY');
  vals[m[1]]=m[2];
 }
 if(headers.filter(s=>s==='gdrive-backup').length!==1 || headers.length!==1)throw Error('REMOTE_SECTION_NOT_EXACT');
 return vals;
}
function hasRefreshToken(str){
 try{
  const o=JSON.parse(str);
  return typeof o.refresh_token==='string'&&o.refresh_token.length>20;
 }catch{return false}
}
function validate(active,candidate){
 if(active.type!=='drive'||candidate.type!=='drive')throw Error('BACKEND_NOT_DRIVE');
 if(!active.token||!hasRefreshToken(active.token))throw Error('ACTIVE_TOKEN_INCOMPLETE');
 if(!candidate.client_id||!candidate.client_id.endsWith('.apps.googleusercontent.com')||
    !candidate.client_secret||candidate.client_secret.length<8)throw Error('CUSTOM_OAUTH_CREDENTIALS_MISSING');
 if(candidate.scope!=='drive')throw Error('CANDIDATE_SCOPE_MUST_BE_DRIVE');
 if(!hasRefreshToken(candidate.token))throw Error('CANDIDATE_REFRESH_TOKEN_MISSING');
 if(candidate.token===active.token)throw Error('OAUTH_REAUTH_NOT_PROVEN');
 if((candidate.team_drive||'')!==(active.team_drive||''))throw Error('DRIVE_TARGET_CHANGED');
 if((candidate.root_folder_id||'')!==(active.root_folder_id||''))throw Error('DRIVE_ROOT_CHANGED');
 return Object.freeze({candidate_has_custom_client:true,candidate_full_drive_scope:true,reauthed_refresh_token:true,target_binding_unchanged:true});
}
function safeRead(f){
 const st=fs.lstatSync(f);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||(st.mode&0o777)!==0o600)throw Error('CONFIG_OWNER_OR_MODE_INVALID');
 if(st.size>20000||st.size<50)throw Error('CONFIG_SIZE_INVALID');
 return fs.readFileSync(f,'utf8');
}
function ensureSnapshot(){
 const s=JSON.parse(fs.readFileSync(STATE,'utf8'));
 if(s.snapshot!==SNAPSHOT||s.bundle_size!==BYTE_SIZE||s.bundle_sha256!==BUNDLE_SHA||
    s.remote!==REMOTE||s.status!=='pass')throw Error('BOUND_BACKUP_SNAPSHOT_DRIFT');
}
function classify(error,stderr){
 const msg=String(stderr||'').toLowerCase();
 if(/429|quota|rate.?limit|too many requests/.test(msg))return 'rate_limited';
 if(/403|401|invalid_grant|unauthorized/.test(msg))return 'auth_error';
 if(/timeout|timedout|deadline|connection|couldn't find root directory id/.test(msg)||error)return 'transport_error';
 return 'remote_error';
}
function prove(statFn){
 const observations=[];
 for(let i=0;i<2;i++){
  const r=statFn(i),one={attempt:i+1,result:'indeterminate'};
  if(r.error||r.exit_code!==0){
   one.result=classify(r.error,r.stderr);
   observations.push(one);
   return {status:'BLOCKED',verified:false,observations};
  }
  let v;
  try{v=JSON.parse(r.stdout||'null')}catch{one.result='invalid_json';observations.push(one);return {status:'BLOCKED',verified:false,observations}}
  if(!v||Array.isArray(v)||v.IsDir|| (v.Name!==BUNDLE&&v.Path!==BUNDLE) ||v.Size!==BYTE_SIZE){
   one.result='object_identity_or_size_mismatch';
   observations.push(one);
   return {status:'BLOCKED',verified:false,observations};
  }
  one.result='exact_byte_size';
  observations.push(one);
 }
 return {status:'CANDIDATE_PROVEN_READ_ONLY',verified:true,observations,byte_size:BYTE_SIZE};
}
function runStat(){
 const args=['lsjson',REMOTE,'--stat','--config',CANDIDATE,
  '--contimeout','8s','--timeout','15s','--retries','1','--low-level-retries','1',
  '--tpslimit','0.5','--tpslimit-burst','1'];
 const r=cp.spawnSync(BINARY,args,{encoding:'utf8',timeout:28000,maxBuffer:100000});
 return {error:r.error?.code||null,exit_code:r.status,stdout:String(r.stdout||'').slice(0,30000),stderr:String(r.stderr||'').slice(0,12000)};
}
function command(mode){
 ensureSnapshot();
 const old=parseSection(safeRead(ACTIVE));
 const baseline={legacy_uses_shared_oauth_client:!Boolean(old.client_id),legacy_scope:old.scope||null,legacy_token_present:hasRefreshToken(old.token||''),current_config_unchanged:true};
 if(!fs.existsSync(CANDIDATE))return {status:'BLOCKED_CANDIDATE_CONFIG_MISSING',...baseline,eligible_for_cutover:false,remote_mutation:false,production_config_mutation:false};
 const candidate=parseSection(safeRead(CANDIDATE));
 const validated=validate(old,candidate);
 if(mode==='--preflight')return {status:'CANDIDATE_CREDENTIALS_READY',...baseline,...validated,eligible_for_cutover:false,requires_remote_proof:true,remote_mutation:false,production_config_mutation:false};
 const probe=prove(()=>runStat());
 return {...baseline,...validated,...probe,eligible_for_cutover:false,requires_explicit_level4_cutover:true,remote_mutation:false,production_config_mutation:false};
}
if(require.main===module){
 try{
  if(process.argv.length!==3||!['--preflight','--verify-candidate'].includes(process.argv[2]))throw Error('READ_ONLY_MODES_ONLY');
  const result=command(process.argv[2]);
  console.log(JSON.stringify(result,null,2));
  if(result.status.startsWith('BLOCKED'))process.exitCode=3;
 }catch(e){
  console.log(JSON.stringify({status:'BLOCKED',category:redactError(e?.message||e),eligible_for_cutover:false,remote_mutation:false,production_config_mutation:false},null,2));
  process.exitCode=3;
 }
}
module.exports={ACTIVE,CANDIDATE,SNAPSHOT,REMOTE,BUNDLE,BYTE_SIZE,BUNDLE_SHA,parseSection,hasRefreshToken,validate,classify,prove,command};
