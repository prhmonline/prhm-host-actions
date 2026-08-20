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
  if(rel==='.'||rel.starsWith('../')||SENSITIVE.test(rel))throw new Error('prhm_host_actions_worktree_path_blocked');
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
  return {ok:true,read_only:true,target,branch,head,clean:changed===0,changed_path_count:changed,aÖÊù—∑°äwijÿl{h±Á_j[