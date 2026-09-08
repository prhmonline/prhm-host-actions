import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { textResult } from '../core/result.js';
import { z } from 'zod';

const BASE_SHA='e1ea620d01764e0cc4778341635bf919b4ecf5ead4f520a37835d86f6353fcdd';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const BASE=path.join(HERE,`.project-honartik-iticket-pretoken-git-sync-base-${BASE_SHA}.mjs`);
const BACK='/var/backups/prhm-agent-selfmaint';
const PROD='/home/honartik/domains/dashboard.honartik.ir/public_html';
const STAGING='/home/prhm/domains/honartik-api-staging.prhm.ir/honartik-back';
const ORIGIN='/home/honartik/git/honartik-dashboard-honartik-ir.git';
const WT='/home/honartik/worktrees/iticket-pretoken-v1-back';
const BRANCH='feature/iticket-pretoken-v1';
const EXPECTED_HEAD='1eb4335da14f9eacf23b9d5fd4288c133786386c';
const LEGACY_PROVIDER_SHA='ca14ecdc210c418686c73d5ef60b150adc0629d6b943b32d11d0d06dd3a3bdf6';
const PROVIDER_SHA='63ee081699c3b1984e4f59e9db668b0e2937986c0dd53b786721dae0e69c1ce2';
const TEST_SHA='275bc08e326917d5787082bdc72e819c980950effefc142e3eae2f49199d712c';
const REL_PROVIDER='app/components/external/base.php';
const REL_TEST='app/components/external/IticketExternalProviderTest.php';
const EXPECTED_PATHS=Object.freeze([REL_PROVIDER,REL_TEST].sort());
const TOOL='honartik_iticket_pretoken_git_sync_v1';
const OPERATION=TOOL;
const CONFIRMATION='CONFIRM_LEVEL_3_PRODUCTION';
const MAX=500000;
const H=b=>createHash('sha256').update(b).digest('hex');
const F=x=>{throw new Error(x)};

function ensureBase(){
  try{if(H(fs.readFileSync(BASE))===BASE_SHA)return}catch{}
  const suffix='-'+BASE_SHA+'.bak';
  const name=fs.readdirSync(BACK).filter(x=>x.startsWith('agent_mcp-src_plugins_project.js-')&&x.endsWith(suffix)).sort().reverse()[0];
  if(!name)F('iticket_git_sync_base_backup_missing');
  const bytes=fs.readFileSync(path.join(BACK,name));
  if(H(bytes)!==BASE_SHA)F('iticket_git_sync_base_sha_mismatch');
  const tmp=BASE+'.'+process.pid+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,BASE);
  fs.chmodSync(BASE,0o600);
}
ensureBase();
const old=await import(pathToFileURL(BASE).href+'?sha='+BASE_SHA);
if(typeof old.registerProjectPlugin!=='function')F('iticket_git_sync_base_export_missing');

function run(bin,args,cwd,timeout=180000){
  const r=spawnSync(bin,args,{cwd,encoding:'utf8',timeout,maxBuffer:MAX,shell:false,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',LC_ALL:'C.UTF-8'}});
  return {ok:!r.error&&r.status===0,status:Number.isInteger(r.status)?r.status:null,signal:r.signal||null,error:r.error?.message||null,stdout:String(r.stdout||'').trim(),stderr:String(r.stderr||'').trim()};
}
function ok(r,code){if(!r.ok)F(code+':'+String(r.error||r.stderr||r.stdout||r.status).slice(0,1200));return r.stdout;}
function git(cwd,args,timeout=180000){return ok(run('/usr/bin/git',args,cwd,timeout),'git_'+String(args[0]||'command')+'_failed');}
function phpBin(){for(const x of ['/usr/local/php83/bin/php','/usr/local/bin/php','/usr/bin/php'])try{if(fs.lstatSync(x).isFile())return x}catch{}F('php_cli_missing');}
function shaFile(file){const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile())F('unsafe_file:'+file);return H(fs.readFileSync(file));}
function atomicCopy(src,dst){const parent=path.dirname(dst);const pst=fs.lstatSync(parent);if(pst.isSymbolicLink()||!pst.isDirectory())F('unsafe_parent:'+parent);const bytes=fs.readFileSync(src);const tmp=dst+'.iticket-'+process.pid+'-'+Date.now()+'.tmp';fs.writeFileSync(tmp,bytes,{mode:0o644,flag:'wx'});fs.renameSync(tmp,dst);}
function changedPaths(cwd){
  const raw=git(cwd,['status','--porcelain=v1','--untracked-files=all']);
  return raw?raw.split(/\r?\n/).filter(Boolean).map(x=>x.slice(3)).sort():[];
}
function branchSha(){const r=run('/usr/bin/git',['--git-dir='+ORIGIN,'rev-parse','--verify','refs/heads/'+BRANCH],PROD,30000);return r.ok?r.stdout.trim():null;}
function verifyFixedInputs(){
  if(git(PROD,['rev-parse','HEAD'])!==EXPECTED_HEAD)F('production_head_mismatch');
  if(git(PROD,['branch','--show-current'])!=='main')F('production_branch_mismatch');
  if(git(PROD,['remote','get-url','origin'])!==ORIGIN)F('production_origin_mismatch');
  if(shaFile(path.join(PROD,REL_PROVIDER))!==LEGACY_PROVIDER_SHA)F('production_legacy_provider_sha_mismatch');
  if(shaFile(path.join(STAGING,REL_PROVIDER))!==PROVIDER_SHA)F('staging_provider_sha_mismatch');
  if(shaFile(path.join(STAGING,REL_TEST))!==TEST_SHA)F('staging_test_sha_mismatch');
}
function verifyPrepared(commit,prodStatus){
  if(git(WT,['rev-parse','HEAD'])!==commit)F('worktree_head_mismatch');
  if(git(WT,['branch','--show-current'])!==BRANCH)F('worktree_branch_mismatch');
  if(shaFile(path.join(WT,REL_PROVIDER))!==PROVIDER_SHA||shaFile(path.join(WT,REL_TEST))!==TEST_SHA)F('worktree_artifact_sha_mismatch');
  if(changedPaths(WT).length!==0)F('worktree_not_clean');
  if(branchSha()!==commit)F('origin_branch_sha_mismatch');
  if(git(PROD,['rev-parse','HEAD'])!==EXPECTED_HEAD)F('production_head_changed');
  if(git(PROD,['status','--porcelain=v1','--untracked-files=all'])!==prodStatus)F('source_overlay_changed');
}
function alreadyApplied(prodStatus){
  if(!fs.existsSync(WT))return null;
  const remote=branchSha();if(!remote)return null;
  verifyPrepared(remote,prodStatus);
  return {ok:true,action:OPERATION,status:'already_applied',commit:remote,branch:BRANCH,worktree:WT,test_marker:'ITICKET_EXTERNAL_PROVIDER_TEST=PASS',origin_branch_verified:true,production_application_tree_mutation:false,database_mutation:false,external_network:false,token_read:false,production_deploy:false,rollback:{performed:false}};
}
function apply(){
  verifyFixedInputs();
  const prodStatus=git(PROD,['status','--porcelain=v1','--untracked-files=all']);
  const prior=alreadyApplied(prodStatus);if(prior)return prior;
  if(fs.existsSync(WT))F('worktree_path_conflict');
  if(branchSha())F('origin_branch_conflict');
  const local=run('/usr/bin/git',['-C',PROD,'show-ref','--verify','--quiet','refs/heads/'+BRANCH],PROD,30000);
  if(local.status===0)F('local_branch_conflict');
  fs.mkdirSync(path.dirname(WT),{recursive:true,mode:0o755});
  let made=false,pushed=false;
  try{
    git(PROD,['worktree','add','-b',BRANCH,WT,EXPECTED_HEAD],180000);made=true;
    atomicCopy(path.join(STAGING,REL_PROVIDER),path.join(WT,REL_PROVIDER));
    atomicCopy(path.join(STAGING,REL_TEST),path.join(WT,REL_TEST));
    const php=phpBin();
    ok(run(php,['-l',path.join(WT,REL_PROVIDER)],WT,60000),'php_lint_provider');
    ok(run(php,['-l',path.join(WT,REL_TEST)],WT,60000),'php_lint_test');
    const testOut=ok(run(php,[path.join(WT,REL_TEST)],WT,60000),'php_contract_test');
    if(!testOut.includes('ITICKET_EXTERNAL_PROVIDER_TEST=PASS'))F('php_contract_marker_missing');
    const changed=changedPaths(WT);
    if(JSON.stringify(changed)!==JSON.stringify(EXPECTED_PATHS))F('unexpected_worktree_diff:'+changed.join(','));
    git(WT,['add','--',...EXPECTED_PATHS]);
    const staged=git(WT,['diff','--cached','--name-only']).split(/\r?\n/).filter(Boolean).sort();
    if(JSON.stringify(staged)!==JSON.stringify(EXPECTED_PATHS))F('unexpected_staged_paths');
    git(WT,['-c','user.name=Honartik Production','-c','user.email=deploy@honartik.ir','commit','-m','feat(iticket): prepare secret-backed provider']);
    const commit=git(WT,['rev-parse','HEAD']);
    if(commit===EXPECTED_HEAD)F('commit_not_created');
    git(WT,['push','origin','HEAD:refs/heads/'+BRANCH],180000);pushed=true;
    verifyPrepared(commit,prodStatus);
    return {ok:true,action:OPERATION,status:'succeeded',commit,branch:BRANCH,base_head:EXPECTED_HEAD,worktree:WT,test_marker:'ITICKET_EXTERNAL_PROVIDER_TEST=PASS',origin_branch_verified:true,artifact_sha256:{provider:PROVIDER_SHA,test:TEST_SHA},production_application_tree_mutation:false,database_mutation:false,external_network:false,token_read:false,production_deploy:false,rollback:{performed:false}};
  }catch(error){
    let rollbackError=null;
    if(pushed){try{git(WT,['push','origin','--delete',BRANCH],120000)}catch(e){rollbackError=String(e?.message||e)}}
    if(made){try{git(PROD,['worktree','remove','--force',WT],120000)}catch(e){rollbackError=rollbackError||String(e?.message||e)};try{git(PROD,['branch','-D',BRANCH],30000)}catch(e){rollbackError=rollbackError||String(e?.message||e)}}
    try{if(git(PROD,['status','--porcelain=v1','--untracked-files=all'])!==prodStatus)rollbackError=rollbackError||'production_overlay_not_restored'}catch(e){rollbackError=rollbackError||String(e?.message||e)}
    if(rollbackError)F('iticket_git_sync_failed_rollback_failed:'+String(error?.message||error)+':'+rollbackError);
    F('iticket_git_sync_failed_rolled_back:'+String(error?.message||error));
  }
}
export function registerProjectPlugin(mcp,context){
  const result=old.registerProjectPlugin(mcp,context);
  mcp.tool(TOOL,'Fixed typed Level-3 Honartik iTicket pre-token canonical Git synchronization. Verifies exact production/staging SHAs, runs PHP lint and the provider contract, commits/pushes only the two iTicket files to the local canonical origin, preserves the production overlay, and performs no token read, database mutation, external network request or production deploy.',{confirmation:z.literal(CONFIRMATION)},async args=>{
    if(args?.confirmation!==CONFIRMATION)F('iticket_git_sync_level3_confirmation_required');
    return textResult(apply());
  });
  return result;
}
