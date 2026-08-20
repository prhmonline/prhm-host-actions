'use strict';
const crypto=require('node:crypto');

const EXPECTED_SOURCE_SHA='22dfb51356b3a89d0b6150b6e67e10ebc5464fb66cb67c9e2a75cb6d2e521481';
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
  const replacements={rawGitHelper:0,statusRawCall:0};
  let content=source;
  const fixedGit=`function fixedGit(target,args){
  const root=SOURCE_ROOTS[target];
  if(!root)throw new Error('source_mapping_target_invalid');
  const r=spawnSync('/usr/bin/git',['-c',\`safe.directory=\${root}\`,'-C',root,...args],{encoding:'utf8',timeout:8000,maxBuffer:131072,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_TERMINAL_PROMPT:'0'}});
  if(r.error)throw new Error('source_mapping_git_exec_failed');
  if(r.status!==0)throw new Error('source_mapping_git_failed');
  return String(r.stdout||'').trim();
}`;
  const rawGit=`function fixedGitRaw(target,args){
  const root=SOURCE_ROOTS[target];
  if(!root)throw new Error('source_mapping_target_invalid');
  const r=spawnSync('/usr/bin/git',['-c',\`safe.directory=\${root}\`,'-C',root,...args],{encoding:'utf8',timeout:8000,maxBuffer:131072,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_TERMINAL_PROMPT:'0'}});
  if(r.error)throw new Error('source_mapping_git_exec_failed');
  if(r.status!==0)throw new Error('source_mapping_git_failed');
  return String(r.stdout||'');
}`;
  content=replaceExactly(content,fixedGit,fixedGit+'\n\n'+rawGit,'raw_git_helper'); replacements.rawGitHelper++;
  content=replaceExactly(content,
    "const raw=fixedGit(target,['status','--porcelain=v1','-z','--untracked-files=all']);",
    "const raw=fixedGitRaw(target,['status','--porcelain=v1','-z','--untracked-files=all']);",
    'status_raw_call'); replacements.statusRawCall++;
  return {content,sourceSha256,sha256:sha256(content),bytes:Buffer.byteLength(content),replacements};
}
module.exports={EXPECTED_SOURCE_SHA,buildCandidate,sha256};
