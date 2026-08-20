import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { textResult } from '../core/result.js';

const BASE_SHA='a249cbbe0278a902da5855cf93969e8bc03eac028ad8284d0f25a6f5557dcc01';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const BASE_FILE=path.join(HERE,`.safeFiles-cfpark-base-${BASE_SHA}.mjs`);
const BACKUP_ROOT='/var/backups/prhm-agent-selfmaint';
const SOURCE_MAPPING_COMPAT_V2_SENTINEL='__PRHM_SOURCE_MAPPING_COMPAT_V2__';
const SOURCE_MAPPING_COMPAT_V3_SENTINEL='__PRHM_SOURCE_MAPPING_COMPAT_V3__';
const SOURCE_MAPPING_COMPAT_V4_SENTINEL='__PRHM_SOURCE_MAPPING_COMPAT_V4__';
const ROOTS={
  cfpark_front_prod:'/home/cfpark/domains/cfpark.ir/public_html',
  cfpark_admin_prod:'/home/cfpark/domains/dashboard.cfpark.ir/public_html'
};
const PRHM_HOST_ACTIONS_WORKTREE_TARGET='prhm_host_actions_worktree';
const PRHM_HOST_ACTIONS_WORKTREE_ROOT='/home/prhm/worktrees/prhm-host-actions-zdt-installer-v2';
const SOURCE_ROOTS={
  cfpark_front_prod:'/home/cfpark/domains/cfpark.ir/public_html',
  cfpark_admin_prod:'/home/cfpark/domains/dashboard.cfpark.ir/public_html',
  gisheh360:'/home/gisheh360/domains/gisheh360.ir/public_html'
};
const ExpandedTarget=z.enum([
  'shifa','honartik_front_prod','honartik_admin_prod','honartik_front_staging','honartik_admin_staging',
  'imotion_front_prod','imotion_admin_prod','tarjomeh_wordpress','drtarjomeh_prod','gisheh360',
  'titan_front_prod','titan_back_prod','moeinshow_front_prod','agent_api','agent_mcp','root_scripts',
  'cfpark_front_prod','cfpark_admin_prod',PRHM_HOST_ACTIONS_WORKTREE_TARGET
]);
const SourceTarget=z.enum(['cfpark_front_prod','cfpark_admin_prod','gisheh360']);
const DatabaseTarget=z.enum(['cfpark_admin_prod','gisheh360']);
const SENSITIVE=/(^|\/)(\.env(?:\.|$)|_env(?:\/|$)|config(?:s|uration)?(?:\/|$)|secrets?(?:\/|$)|credentials?(?:\/|$)|private(?:\/|$)|.*(?:secret|credential|private[-_]?key|id_rsa|id_ed25519|passwd|passwords?)(?:\.|$))/i;
const SOURCE_RO={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const MAX_CHANGED_PATHS=20;
const MAX_LOCAL_COMMITS=10;

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function ensureBase(){
  try{if(sha256(fs.readFileSync(BASE_FILE))===BASE_SHA)return;}catch{}
  const names=fs.readdirSync(BACKUP_ROOT)
    .filter(n=>n.startsWith('agent_mcp-src_plugins_safeFiles.js-')&&n.endsWith('-'+BASE_SHA+'.bak'))
    .sort().reverse();
  if(!names.length)throw new Error('cfpark_safe_files_base_backup_missing');
  const bytes=fs.readFileSync(path.join(BACKUP_ROOT,names[0]));
  if(sha256(bytes)!==BASE_SHA)throw new Error('cfpark_safe_files_base_sha_mismatch');
  const tmp=BASE_FILE+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,BASE_FILE);
}
ensureBase();
const base=await import(pathToFileURL(BASE_FILE).href+'?sha='+BASE_SHA);

function cfRead(args){
  const root=ROOTS[args.target];
  if(!root)throw new Error('cfpark_read_target_invalid');
  let rel=String(args.path||'').replaceAll('\\','/');
  if(!rel||rel.startsWith('/')||rel.split('/').some(x=>x==='..'||x===''))throw new Error('cfpark_read_path_invalid');
  rel=path.posix.normalize(rel);
  if(rel==='.'||rel.startsWith('../')||SENSITIVE.test(rel))throw new Error('cfpark_read_path_blocked');
  const rootReal=fs.realpathSync(root);
  const abs=path.join(root,rel);
  const st=fs.lstatSync(abs);
  if(!st.isFile()||st.isSymbolicLink())throw new Error('cfpark_read_regular_file_required');
  const real=fs.realpathSync(abs);
  if(!(real===rootReal||real.startsWith(rootReal+path.sep)))throw new Error('cfpark_read_escape_blocked');
  const max=Number(args.maxBytes||200000);
  if(st.size>max)throw new Error(`file exceeds ${max} bytes`);
  const bytes=fs.readFileSync(real);
  const encoding=args.encoding==='base64'?'base64':'utf8';
  return {
    ok:true,operation:'file_read',target:args.target,path:rel,bytes:bytes.length,
    sha256:sha256(bytes),encoding,content:encoding==='base64'?bytes.toString('base64'):bytes.toString('utf8'),
    fixed_root:true,secret_paths_blocked:true
  };
}

function prhmHostActionsWorktreeRead(args){
  if(args?.target!==PRHM_HOST_ACTIONS_WORKTREE_TARGET)throw new Error('prhm_host_actions_worktree_target_invalid');
  let rel=String(args.path||'').replaceAll('\\','/');
  if(!rel||rel.startsWith('/')||rel.split('/').some(x=>x==='..'||x===''))throw new Error('prhm_host_actions_worktree_path_invalid');
  rel=path.posix.normalize(rel);
  if(rel==='.'||rel.startsWith('../')||SENSITIVE.test(rel))throw new Error('prhm_host_actions_worktree_path_blocked');
  const rootReal=fs.realpathSync(PRHM_HOST_ACTIONS_WORKTREE_ROOT);
  const abs=path.join(PRHM_HOST_ACTIONS_WORKTREE_ROOT,rel);
  const st=fs.lstatSync(abs);
  if(!st.isFile()||st.isSymbolicLink())throw new Error('prhm_host_actions_worktree_regular_file_required');
  const real=fs.realpathSync(abs);
  if(!(real===rootReal||real.startsWith(rootReal+path.sep)))throw new Error('prhm_host_actions_worktree_escape_blocked');
  const max=Number(args.maxBytes||200000);
  if(!Number.isInteger(max)||max<1||max>1000000)throw new Error('prhm_host_actions_worktree_max_bytes_invalid');
  if(st.size>max)throw new Error(`file exceeds ${max} bytes`);
  const bytes=fs.readFileSync(real);
  const encoding=args.encoding==='base64'?'base64':'utf8';
  return {
    ok:true,operation:'file_read',target:PRHM_HOST_ACTIONS_WORKTREE_TARGET,path:rel,bytes:bytes.length,
    sha256:sha256(bytes),encoding,content:encoding==='base64'?bytes.toString('base64'):bytes.toString('utf8'),
    fixed_root:true,read_only:true,secret_paths_blocked:true,symlink_escape_blocked:true
  };
}

function fixedGit(target,args){
  const root=SOURCE_ROOTS[target];
  if(!root)throw new Error('source_mapping_target_invalid');
  const r=spawnSync('/usr/bin/git',['-c',`safe.directory=${root}`,'-C',root,...args],{encoding:'utf8',timeout:8000,maxBuffer:131072,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_TERMINAL_PROMPT:'0'}});
  if(r.error)throw new Error('source_mapping_git_exec_failed');
  if(r.status!==0)throw new Error('source_mapping_git_failed');
  return String(r.stdout||'').trim();
}

function fixedGitRaw(target,args){
  const root=SOURCE_ROOTS[target];
  if(!root)throw new Error('source_mapping_target_invalid');
  const r=spawnSync('/usr/bin/git',['-c',`safe.directory=${root}`,'-C',root,...args],{encoding:'utf8',timeout:8000,maxBuffer:131072,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_TERMINAL_PROMPT:'0'}});
  if(r.error)throw new Error('source_mapping_git_exec_failed');
  if(r.status!==0)throw new Error('source_mapping_git_failed');
  return String(r.stdout||'');
}

function gitStatusReadonly(target){
  let branch=null;
  try{branch=fixedGit(target,['symbolic-ref','--quiet','--short','HEAD'])||null;}catch{}
  const head=fixedGit(target,['rev-parse','HEAD']);
  const status=fixedGit(target,['status','--porcelain=v1','--branch']);
  const lines=status?status.split(/\r?\n/):[];
  const header=lines[0]?.startsWith('## ')?lines.shift():'';
  const changed=lines.filter(Boolean).length;
  let ahead=0,behind=0;
  const a=header.match(/ahead (\d+)/); if(a)ahead=Number(a[1]);
  const b=header.match(/behind (\d+)/); if(b)behind=Number(b[1]);
  return {ok:true,read_only:true,target,branch,head,clean:changed===0,changed_path_count:changed,ahead,behind,paths_exposed:false};
}

function safeRepoRelative(rel){
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
  const raw=fixedGitRaw(target,['status','--porcelain=v1','-z','--untracked-files=all']);
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

function sanitizedRemoteIdentity(target){
  const raw=fixedGit(target,['config','--get','remote.origin.url']);
  if(!raw)throw new Error('source_mapping_origin_missing');
  let host=''; let repoPath='';
  try{
    if(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)){
      const u=new URL(raw);
      host=u.hostname.toLowerCase();
      repoPath=u.pathname;
    }else{
      const m=raw.match(/^(?:[^@\s]+@)?([^:\s]+):(.+)$/);
      if(m){host=m[1].toLowerCase();repoPath=m[2];}
      else repoPath=raw;
    }
  }catch{throw new Error('source_mapping_origin_parse_failed');}
  const parts=repoPath.replace(/^\/+|\/+$/g,'').replace(/\.git$/i,'').split('/').filter(Boolean);
  if(parts.length<2)throw new Error('source_mapping_origin_identity_unresolved');
  const owner=parts.at(-2); const repo=parts.at(-1);
  if(!/^[A-Za-z0-9_.-]+$/.test(owner)||!/^[A-Za-z0-9_.-]+$/.test(repo))throw new Error('source_mapping_origin_identity_invalid');
  return {ok:true,read_only:true,target,host:host||null,owner_repo:`${owner}/${repo}`,credentials_exposed:false,remote_url_exposed:false};
}

function readFixedRegular(root,file){
  const rootReal=fs.realpathSync(root);
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink())throw new Error('source_mapping_db_file_invalid');
  const real=fs.realpathSync(file);
  if(!(real===rootReal||real.startsWith(rootReal+path.sep)))throw new Error('source_mapping_db_file_escape');
  if(st.size>524288)throw new Error('source_mapping_db_file_too_large');
  return fs.readFileSync(real,'utf8');
}

function databaseNameOnly(target){
  if(target==='gisheh360'){
    const root=SOURCE_ROOTS.gisheh360;
    const file=path.join(root,'wp-config.php');
    const s=readFixedRegular(root,file);
    const m=s.match(/define\s*\(\s*['"]DB_NAME['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i);
    if(!m)throw new Error('source_mapping_db_name_not_found');
    return {ok:true,read_only:true,target,database_name:m[1],credentials_exposed:false,source_content_exposed:false};
  }
  if(target==='cfpark_admin_prod'){
    const root=SOURCE_ROOTS.cfpark_admin_prod;
    const candidates=['common/config/base_env.php','common/config/main-local.php','common/config/db.php','config/db.php','backend/config/main-local.php','common/config/main.php'];
    for(const rel of candidates){
      const file=path.join(root,rel);
      if(!fs.existsSync(file))continue;
      let s=''; try{s=readFixedRegular(root,file);}catch{continue;}
      const m=s.match(/dbname=([A-Za-z0-9][A-Za-z0-9_.-]*)/i);
      if(m)return {ok:true,read_only:true,target,database_name:m[1],credentials_exposed:false,source_content_exposed:false};
    }
    throw new Error('source_mapping_db_name_not_found');
  }
  throw new Error('source_mapping_db_target_invalid');
}

function serviceState(unit){
  const r=spawnSync('/usr/bin/systemctl',['show',unit,'--no-pager','--property=Id,LoadState,ActiveState,SubState,UnitFileState,MainPID,Result'],{encoding:'utf8',timeout:5000,maxBuffer:32768,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
  if(r.error||r.status!==0)return {unit,available:false};
  const out={unit,available:true};
  for(const line of String(r.stdout||'').split(/\r?\n/)){
    const i=line.indexOf('='); if(i<1)continue;
    const k=line.slice(0,i),v=line.slice(i+1);
    if(['Id','LoadState','ActiveState','SubState','UnitFileState','MainPID','Result'].includes(k))out[k]=v;
  }
  return out;
}

function safePart(fn){
  try{return fn();}catch(error){return {ok:false,error:String(error?.message||error).slice(0,160),credentials_exposed:false};}
}

function sourceMappingCompatV2(){
  return {
    ok:true,
    operation:'source_mapping_compat_v2',
    read_only:true,
    zero_input_semantics:true,
    credentials_exposed:false,
    arbitrary_command_exposed:false,
    arbitrary_path_exposed:false,
    park_bazar:{
      canonical_roots:{front:SOURCE_ROOTS.cfpark_front_prod,back:SOURCE_ROOTS.cfpark_admin_prod,tenant:'park.prhm.ir',place_id:1},
      git:{front:safePart(()=>gitStatusReadonly('cfpark_front_prod')),back:safePart(()=>gitStatusReadonly('cfpark_admin_prod'))},
      remote:{front:safePart(()=>sanitizedRemoteIdentity('cfpark_front_prod')),back:safePart(()=>sanitizedRemoteIdentity('cfpark_admin_prod'))},
      database:safePart(()=>databaseNameOnly('cfpark_admin_prod')),
      services:[serviceState('cfpark-frontend.service'),serviceState('httpd.service'),serviceState('php-fpm.service')]
    },
    gisheh:{
      canonical_root:SOURCE_ROOTS.gisheh360,
      git:safePart(()=>gitStatusReadonly('gisheh360')),
      remote:safePart(()=>sanitizedRemoteIdentity('gisheh360')),
      database:safePart(()=>databaseNameOnly('gisheh360')),
      services:[serviceState('httpd.service'),serviceState('php-fpm.service')]
    }
  };
}

function sourceMappingCompatV3(){
  return {...sourceMappingCompatV2(),operation:'source_mapping_compat_v3'};
}

function sourceMappingCompatV4(){
  const v3=sourceMappingCompatV3();
  return {...v3,operation:'source_mapping_compat_v4',read_only:true,zero_input_semantics:true,credentials_exposed:false,arbitrary_command_exposed:false,arbitrary_path_exposed:false,park_bazar:{...v3.park_bazar,working_tree:{front:safePart(()=>gitWorkingTreeDetail('cfpark_front_prod')),back:safePart(()=>gitWorkingTreeDetail('cfpark_admin_prod'))}},gisheh:{...v3.gisheh,working_tree:safePart(()=>gitWorkingTreeDetail('gisheh360'))}};
}

function registerSourceMappingTools(mcp){
  mcp.registerTool('source_mapping_git_status_readonly',{title:'Source Mapping Git Status Read-only',description:'Fixed-scope Git status metadata for CF Park front/back and Gisheh. Returns branch, HEAD, clean/dirty count and ahead/behind only; never returns changed paths.',inputSchema:{target:SourceTarget},annotations:SOURCE_RO},async args=>textResult(gitStatusReadonly(args.target)));
  mcp.registerTool('source_mapping_git_remote_identity_sanitized',{title:'Source Mapping Git Remote Identity Sanitized',description:'Fixed-scope origin identity for CF Park front/back and Gisheh. Returns host and owner/repo only; never returns remote URL, userinfo, token or credentials.',inputSchema:{target:SourceTarget},annotations:SOURCE_RO},async args=>textResult(sanitizedRemoteIdentity(args.target)));
  mcp.registerTool('source_mapping_database_name_only',{title:'Source Mapping Database Name Only',description:'Fixed-scope database-name diagnostic for CF Park backend and Gisheh. Returns only the database/schema name and no host, username, password, DSN or source content.',inputSchema:{target:DatabaseTarget},annotations:SOURCE_RO},async args=>textResult(databaseNameOnly(args.target)));
}

function proxy(mcp){
  return new Proxy(mcp,{get(target,prop){
    if(prop==='registerTool')return (name,config,handler)=>{
      if(name==='safe_file_read'){
        const next={...config,inputSchema:{...config.inputSchema,target:ExpandedTarget}};
        return target.registerTool(name,next,async args=>{
          if(args?.target==='root_scripts'&&args?.path===SOURCE_MAPPING_COMPAT_V4_SENTINEL)return textResult(sourceMappingCompatV4());
          if(args?.target==='root_scripts'&&args?.path===SOURCE_MAPPING_COMPAT_V3_SENTINEL)return textResult(sourceMappingCompatV3());
          if(args?.target==='root_scripts'&&args?.path===SOURCE_MAPPING_COMPAT_V2_SENTINEL)return textResult(sourceMappingCompatV2());
          if(args?.target===PRHM_HOST_ACTIONS_WORKTREE_TARGET)return textResult(prhmHostActionsWorktreeRead(args));
          if(ROOTS[args?.target])return textResult(cfRead(args));
          return handler(args);
        });
      }
      if(name==='safe_file_targets'){
        return target.registerTool(name,config,async args=>{
          const result=await handler(args);
          const text=result?.content?.[0]?.text;
          let payload={};
          try{payload=JSON.parse(String(text||'{}'));}catch{throw new Error('safe_file_targets_base_invalid');}
          const targets=Array.isArray(payload.targets)?payload.targets.slice():[];
          if(!targets.includes(PRHM_HOST_ACTIONS_WORKTREE_TARGET))targets.push(PRHM_HOST_ACTIONS_WORKTREE_TARGET);
          return textResult({...payload,ok:true,targets});
        });
      }
      return target.registerTool(name,config,handler);
    };
    const v=target[prop];
    return typeof v==='function'?v.bind(target):v;
  }});
}

export function registerSafeFilesPlugin(mcp,context){
  base.registerSafeFilesPlugin(proxy(mcp),context);
  registerSourceMappingTools(mcp);
}
