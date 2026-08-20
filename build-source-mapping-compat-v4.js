'use strict';
const crypto=require('node:crypto');

const EXPECTED_SOURCE_SHA='92e6e279f10fe8561a9c986d9dc90d6bc0cd284009ed9984f51fefe202ac6252';
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
  const replacements={v4Sentinel:0,v4Bounds:0,v4Diagnostics:0,v4Function:0,v4Proxy:0};
  let content=source;
  content=replaceExactly(content,
    "const SOURCE_MAPPING_COMPAT_V3_SENTINEL='__PRHM_SOURCE_MAPPING_COMPAT_V3__';",
    "const SOURCE_MAPPING_COMPAT_V3_SENTINEL='__PRHM_SOURCE_MAPPING_COMPAT_V3__';\nconst SOURCE_MAPPING_COMPAT_V4_SENTINEL='__PRHM_SOURCE_MAPPING_COMPAT_V4__';",
    'v4_sentinel'); replacements.v4Sentinel++;
  content=replaceExactly(content,
    "const SOURCE_RO={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};",
    "const SOURCE_RO={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};\nconst MAX_CHANGED_PATHS=20;\nconst MAX_LOCAL_COMMITS=10;",
    'v4_bounds'); replacements.v4Bounds++;

  const diagnostics=String.raw`function safeRepoRelative(rel){
  if(typeof rel!=='string'||!rel||rel.startsWith('/')||/[\x00-\x1f\x7f]/.test(rel))throw new Error('source_mapping_path_invalid');
  const normalized=path.posix.normalize(rel.replaceAll('\\','/'));
  if(normalized==='.'||normalized.startsWith('../')||normalized.split('/').some(x=>x==='..'||x===''))throw new Error('source_mapping_path_invalid');
  return normalized;
}

function untrackedNumstat(target,rel){
  if(SENSITIVE.test(rel))return {additions:null,deletions:null,binary:null,diffstat_available:false};
  const root=SOURCE_ROOTS[target];
  const rootReal=fs.realpathSync(root);
  const abs=path.join(root,rel);
  const st=fs.lstatSync(abs);
  if(!st.isFile()||st.isSymbolicLink()||st.size>524288)return {additions:null,deletions:null,binary:null,diffstat_available:false};
  const real=fs.realpathSync(abs);
  if(!(real===rootReal||real.startsWith(rootReal+path.sep)))throw new Error('source_mapping_path_escape');
  const bytes=fs.readFileSync(real);
  if(bytes.includes(0))return {additions:null,deletions:null,binary:true,diffstat_available:true};
  let lines=0;
  if(bytes.length){for(const b of bytes)if(b===10)lines++;if(bytes.at(-1)!==10)lines++;}
  return {additions:lines,deletions:0,binary:false,diffstat_available:true};
}

function trackedNumstat(target,rel){
  const out=fixedGit(target,['diff','--numstat','HEAD','--',rel]);
  if(!out)return {additions:0,deletions:0,binary:false,diffstat_available:true};
  let additions=0,deletions=0,binary=false,seen=false;
  for(const line of out.split(/\r?\n/).filter(Boolean)){
    const m=line.match(/^(-|\d+)\t(-|\d+)\t/); if(!m)continue; seen=true;
    if(m[1]==='-'||m[2]==='-'){binary=true;continue;}
    additions+=Number(m[1]); deletions+=Number(m[2]);
  }
  if(!seen)return {additions:null,deletions:null,binary:null,diffstat_available:false};
  return {additions:binary?null:additions,deletions:binary?null:deletions,binary,diffstat_available:true};
}

function sanitizeCommitSubject(subject){
  const clean=String(subject||'').replace(/[\x00-\x1f\x7f]+/g,' ').trim().slice(0,120);
  if(/(?:bearer\s+[A-Za-z0-9._~-]{8,}|authorization|password|passwd|private[-_ ]?key|api[-_ ]?key|secret|token)\s*[:=]?/i.test(clean))return '[REDACTED]';
  return clean;
}

function localOnlyCommitsReadonly(target){
  try{fixedGit(target,['rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}']);}catch{return {local_only_commits:[],local_only_commits_truncated:false,upstream_available:false};}
  const raw=fixedGit(target,['log','--max-count='+String(MAX_LOCAL_COMMITS+1),'--format=%h%x09%s','@{upstream}..HEAD']);
  const rows=raw?raw.split(/\r?\n/).filter(Boolean):[];
  const commits=[];
  for(const row of rows.slice(0,MAX_LOCAL_COMMITS)){
    const i=row.indexOf('\t'); if(i<1)continue;
    const short_sha=row.slice(0,i); if(!/^[a-f0-9]{7,12}$/i.test(short_sha))continue;
    commits.push({short_sha,subject:sanitizeCommitSubject(row.slice(i+1))});
  }
  return {local_only_commits:commits,local_only_commits_truncated:rows.length>MAX_LOCAL_COMMITS,upstream_available:true};
}

function gitWorkingTreeDetail(target){
  const status=gitStatusReadonly(target);
  const raw=fixedGit(target,['status','--porcelain=v1','-z','--untracked-files=all']);
  const tokens=raw?raw.split('\0'):[];
  const all=[];
  for(let i=0;i<tokens.length;){
    const item=tokens[i++]; if(!item)continue;
    if(item.length<4||item[2]!==' ')throw new Error('source_mapping_status_parse_failed');
    const status_code=item.slice(0,2);
    const rel=safeRepoRelative(item.slice(3));
    if(/[RC]/.test(status_code)&&i<tokens.length&&tokens[i])safeRepoRelative(tokens[i++]);
    const tracked=status_code!=='??';
    const stat=tracked?trackedNumstat(target,rel):untrackedNumstat(target,rel);
    all.push({status_code,relative_path:rel,tracked,untracked:!tracked,...stat});
  }
  const local=localOnlyCommitsReadonly(target);
  return {...status,paths_exposed:true,changed_paths:all.slice(0,MAX_CHANGED_PATHS),changed_paths_truncated:all.length>MAX_CHANGED_PATHS,...local,credentials_exposed:false,remote_url_exposed:false};
}

`;
  content=replaceExactly(content,
    "function sanitizedRemoteIdentity(target){",
    diagnostics+"function sanitizedRemoteIdentity(target){",
    'v4_diagnostics'); replacements.v4Diagnostics++;

  content=replaceExactly(content,
    "function sourceMappingCompatV3(){\n  return {...sourceMappingCompatV2(),operation:'source_mapping_compat_v3'};\n}",
    "function sourceMappingCompatV3(){\n  return {...sourceMappingCompatV2(),operation:'source_mapping_compat_v3'};\n}\n\nfunction sourceMappingCompatV4(){\n  const v3=sourceMappingCompatV3();\n  return {...v3,operation:'source_mapping_compat_v4',read_only:true,zero_input_semantics:true,credentials_exposed:false,arbitrary_command_exposed:false,arbitrary_path_exposed:false,park_bazar:{...v3.park_bazar,working_tree:{front:safePart(()=>gitWorkingTreeDetail('cfpark_front_prod')),back:safePart(()=>gitWorkingTreeDetail('cfpark_admin_prod'))}},gisheh:{...v3.gisheh,working_tree:safePart(()=>gitWorkingTreeDetail('gisheh360'))}};\n}",
    'v4_function'); replacements.v4Function++;

  content=replaceExactly(content,
    "if(args?.target==='root_scripts'&&args?.path===SOURCE_MAPPING_COMPAT_V3_SENTINEL)return textResult(sourceMappingCompatV3());",
    "if(args?.target==='root_scripts'&&args?.path===SOURCE_MAPPING_COMPAT_V4_SENTINEL)return textResult(sourceMappingCompatV4());\n          if(args?.target==='root_scripts'&&args?.path===SOURCE_MAPPING_COMPAT_V3_SENTINEL)return textResult(sourceMappingCompatV3());",
    'v4_proxy'); replacements.v4Proxy++;

  return {content,sourceSha256,sha256:sha256(content),bytes:Buffer.byteLength(content),replacements};
}
module.exports={EXPECTED_SOURCE_SHA,buildCandidate,sha256};
