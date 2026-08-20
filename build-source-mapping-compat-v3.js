'use strict';
const crypto=require('node:crypto');

const EXPECTED_SOURCE_SHA='87da44a939478786b9a48585c1cccacd862b683831dbba976d8b6a85869d2473';
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function replaceExactly(source,from,to,label){
  const count=source.split(from).length-1;
  if(count!==1)throw new Error(`${label}_anchor_count:${count}`);
  return source.replace(from,to);
}
function buildCandidate(source){
  if(typeof source!=='string')throw new Error('source_type_invalid');
  const sourceSha256=sha256(source);
  if(sourceSha256!==EXPECTED_SOURCE_SHA)throw new Error(`source_sha_mismatch:${sourceSha256}`);
  const replacements={gitSafeDirectory:0,dbCandidate:0,v3Sentinel:0,v3Function:0,v3Proxy:0};
  let content=source;
  content=replaceExactly(content,
    "const SOURCE_MAPPING_COMPAT_SENTINEL='__PRHM_SOURCE_MAPPING_COMPAT_V2__';",
    "const SOURCE_MAPPING_COMPAT_V2_SENTINEL='__PRHM_SOURCE_MAPPING_COMPAT_V2__';\nconst SOURCE_MAPPING_COMPAT_V3_SENTINEL='__PRHM_SOURCE_MAPPING_COMPAT_V3__';",
    'v3_sentinel'); replacements.v3Sentinel++;
  content=replaceExactly(content,
    "const r=spawnSync('/usr/bin/git',['-C',root,...args],{encoding:'utf8',timeout:8000,maxBuffer:131072,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_TERMINAL_PROMPT:'0'}});",
    "const r=spawnSync('/usr/bin/git',['-c',`safe.directory=${root}`,'-C',root,...args],{encoding:'utf8',timeout:8000,maxBuffer:131072,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_TERMINAL_PROMPT:'0'}});",
    'git_safe_directory'); replacements.gitSafeDirectory++;
  content=replaceExactly(content,
    "const candidates=['common/config/main-local.php','common/config/db.php','config/db.php','backend/config/main-local.php','common/config/main.php'];",
    "const candidates=['common/config/base_env.php','common/config/main-local.php','common/config/db.php','config/db.php','backend/config/main-local.php','common/config/main.php'];",
    'db_candidate'); replacements.dbCandidate++;
  content=replaceExactly(content,
    "\nfunction registerSourceMappingTools(mcp){",
    "\nfunction sourceMappingCompatV3(){\n  return {...sourceMappingCompatV2(),operation:'source_mapping_compat_v3'};\n}\n\nfunction registerSourceMappingTools(mcp){",
    'v3_function'); replacements.v3Function++;
  content=replaceExactly(content,
    "if(args?.target==='root_scripts'&&args?.path===SOURCE_MAPPING_COMPAT_SENTINEL)return textResult(sourceMappingCompatV2());",
    "if(args?.target==='root_scripts'&&args?.path===SOURCE_MAPPING_COMPAT_V3_SENTINEL)return textResult(sourceMappingCompatV3());\n          if(args?.target==='root_scripts'&&args?.path===SOURCE_MAPPING_COMPAT_V2_SENTINEL)return textResult(sourceMappingCompatV2());",
    'v3_proxy'); replacements.v3Proxy++;
  return {content,sourceSha256,sha256:sha256(content),bytes:Buffer.byteLength(content),replacements};
}
module.exports={EXPECTED_SOURCE_SHA,buildCandidate,sha256};
