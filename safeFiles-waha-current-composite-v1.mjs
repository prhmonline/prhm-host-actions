// Reviewed SHA-bound candidate for future approved deployment as src/plugins/safeFiles.js.
// Source only. This file DOES NOT deploy, update a server or start WAHA.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {registerOnlyWahaTools} from './waha-current-mcp-register-filter-v1.mjs';

const CURRENT_SAFE_FILES_SHA256='822e2188d1cb80578fb150eb0066c522c38696459d673ef863473cf584f1c05e';
const REVIEWED_WAHA_GIT_BLOB_SHA1='7b6e08d2ffb9faed164115be085491fce7ce6261';
const BACKUP_ROOT='/var/backups/prhm-agent-selfmaint';
const CACHE_ROOT='/var/lib/prhm-agent-selfmaint-exec';
const CACHE_FILE=path.join(CACHE_ROOT,'.safeFiles-waha-current-base-'+CURRENT_SAFE_FILES_SHA256+'.mjs');
const BACKUP_PREFIX='agent_mcp-src_plugins_safeFiles.js-';
const BACKUP_SUFFIX='-'+CURRENT_SAFE_FILES_SHA256+'.bak';
const WAHA_SOURCE='/home/agent/ssh-mcp-server/src/plugins/waha-student-bridge-registration-surface-v37.mjs';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitBlobSha1=bytes=>createHash('sha1')
  .update(Buffer.concat([Buffer.from('blob '+bytes.length),Buffer.from([0]),bytes])).digest('hex');
const fail=code=>{throw new Error(code);};
function regularFile(file,label){
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(file)!==file)fail(label+'_invalid');
  return stat;
}
function reviewedWAHASource(){
  regularFile(WAHA_SOURCE,'waha_reviewed_source');
  const bytes=fs.readFileSync(WAHA_SOURCE);
  if(gitBlobSha1(bytes)!==REVIEWED_WAHA_GIT_BLOB_SHA1)fail('waha_reviewed_source_blob_mismatch');
}
function loadCurrentBase(){
  const rootStat=fs.lstatSync(BACKUP_ROOT);
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||fs.realpathSync(BACKUP_ROOT)!==BACKUP_ROOT){
    fail('safeFiles_backup_dir_invalid');
  }
  const matches=fs.readdirSync(BACKUP_ROOT)
    .filter(name=>name.startsWith(BACKUP_PREFIX)&&name.endsWith(BACKUP_SUFFIX)).sort().reverse();
  let verified=null;
  for(const name of matches){
    const candidate=path.join(BACKUP_ROOT,name);
    try{
      regularFile(candidate,'safeFiles_backup');
      const bytes=fs.readFileSync(candidate);
      if(sha256(bytes)===CURRENT_SAFE_FILES_SHA256){verified=bytes;break;}
    }catch{continue;}
  }
  if(!verified)fail('safeFiles_current_exact_backup_missing');
  const cacheStat=fs.lstatSync(CACHE_ROOT);
  if(!cacheStat.isDirectory()||cacheStat.isSymbolicLink()||fs.realpathSync(CACHE_ROOT)!==CACHE_ROOT){
    fail('safeFiles_cache_dir_invalid');
  }
  try{
    regularFile(CACHE_FILE,'safeFiles_cache');
    if(sha256(fs.readFileSync(CACHE_FILE))===CURRENT_SAFE_FILES_SHA256)return;
    fail('safeFiles_cache_sha_mismatch');
  }catch(error){
    if(error?.code!=='ENOENT')throw error;
  }
  const tmp=CACHE_FILE+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,verified,{mode:0o600,flag:'wx'});
  if(sha256(fs.readFileSync(tmp))!==CURRENT_SAFE_FILES_SHA256)fail('safeFiles_cache_tmp_sha_mismatch');
  fs.renameSync(tmp,CACHE_FILE);
  fs.chmodSync(CACHE_FILE,0o600);
  if(sha256(fs.readFileSync(CACHE_FILE))!==CURRENT_SAFE_FILES_SHA256)fail('safeFiles_cache_postwrite_sha_mismatch');
}

reviewedWAHASource();
loadCurrentBase();
const currentBase=await import(pathToFileURL(CACHE_FILE).href+'?verified='+CURRENT_SAFE_FILES_SHA256);
const reviewedWaha=await import(pathToFileURL(WAHA_SOURCE).href+'?reviewed='+REVIEWED_WAHA_GIT_BLOB_SHA1);
if(typeof currentBase.registerSafeFilesPlugin!=='function'||
   typeof reviewedWaha.registerSafeFilesPlugin!=='function'){
  fail('waha_composite_registration_export_missing');
}

export function registerSafeFilesPlugin(mcp,context){
  // Preserve all registered current SafeFiles/LeadOps capabilities unchanged.
  const result=currentBase.registerSafeFilesPlugin(mcp,context);
  // Only WAHA's two registration actions are admitted from the reviewed legacy surface.
  registerOnlyWahaTools(mcp,context,reviewedWaha.registerSafeFilesPlugin);
  return result;
}
// WAHA_CURRENT_SAFEFILES_SHA_BOUND_COMPOSITE_V1
