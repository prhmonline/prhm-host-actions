import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const BASE_SHA='12ff27a53cba7ac1e824a0cf6c798de5cf56ba9ba8521d50cddacbafc4be64db';
const ROOT='/var/backups/prhm-agent-selfmaint';
const HERE=path.dirname(new URL(import.meta.url).pathname);
const PATCHED=path.join(HERE,'.safeFiles-zdt-v19-'+BASE_SHA+'.mjs');
const sha=b=>createHash('sha256').update(b).digest('hex');

function backupBytes(expected){
  const names=fs.readdirSync(ROOT)
    .filter(n=>n.startsWith('agent_mcp-src_plugins_safeFiles.js-')&&n.endsWith('-'+expected+'.bak'))
    .sort().reverse();
  if(!names.length)throw new Error('safe_files_backup_missing:'+expected);
  const b=fs.readFileSync(path.join(ROOT,names[0]));
  if(sha(b)!==expected)throw new Error('safe_files_backup_sha_mismatch:'+expected);
  return b;
}
function writeDerived(file,bytes){
  if(fs.existsSync(file)&&sha(fs.readFileSync(file))===sha(bytes))return;
  const tmp=file+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,file);
  fs.chmodSync(file,0o600);
}

const bytes=backupBytes(BASE_SHA);
let source=bytes.toString('utf8');

const V18_OWNER_SHA='09d1d28a6becac962736495fb3082e6a678ff0eb2667f72cd7c75ed0b5ea3497';
const SHIFA_BASE_SHA='8c0ca2cf392a93dd42511397f9b56c9d27f367fc4dd992ccd09f43e2dde0badf';
const oldV18=String.raw`function runTest(){
  assertWorktree();
  const testFile=fixedFile(FILES[1]);
  if(!fs.existsSync(testFile))throw new Error('zdt_v18_test_missing');
  const args=[
    '--pipe','--wait','--collect','--quiet',
    '--property=NoNewPrivileges=yes','--property=PrivateTmp=yes','--property=ProtectSystem=strict','--property=ProtectHome=read-only',
    `--property=WorkingDirectory=${WORKTREE}`,
    '/usr/local/bin/prhm-node','--test',FILES[1]
  ];
  const r=spawnSync('/usr/bin/systemd-run',args,{encoding:'utf8',timeout:60000,maxBuffer:240000,env:{PATH:'/usr/local/bin:/usr/bin:/bin',LC_ALL:'C'}});
  return {ok:r.status===0,suite:'v18_contract',exit_code:Number.isInteger(r.status)?r.status:null,stdout:String(r.stdout||'').slice(0,100000),stderr:String(r.stderr||'').slice(0,20000),sandbox:{no_new_privileges:true,private_tmp:true,protect_system:'strict',protect_home:'read-only'},production_mutation:false};
}`;
const newV18=String.raw`function runTest(){
  assertWorktree();
  const testFile=fixedFile(FILES[1]);
  if(!fs.existsSync(testFile))throw new Error('zdt_v18_test_missing');
  const unit='prhm-agent-zdt-v18-contract-'+process.pid+'-'+Date.now();
  const serviceUnit=unit+'.service';
  const env={PATH:'/usr/local/bin:/usr/bin:/bin',LC_ALL:'C'};
  const startArgs=[
    '--unit='+unit,'--quiet',
    '--property=Type=oneshot','--property=RemainAfterExit=yes','--property=TimeoutStartSec=120',
    '--property=StandardOutput=journal','--property=StandardError=journal',
    '--property=NoNewPrivileges=yes','--property=PrivateTmp=yes','--property=ProtectSystem=strict','--property=ProtectHome=read-only',
    '--property=WorkingDirectory='+WORKTREE,
    '/usr/local/bin/prhm-node','--test',FILES[1]
  ];
  const started=spawnSync('/usr/bin/systemd-run',startArgs,{encoding:'utf8',timeout:15000,maxBuffer:120000,env});
  let activeState='',subState='',result='',execMainStatus=null,showError='';
  if(started.status===0){
    const sleeper=new Int32Array(new SharedArrayBuffer(4));
    for(let i=0;i<240;i++){
      const shown=spawnSync('/usr/bin/systemctl',['show',serviceUnit,'--no-pager','--property=ActiveState','--property=SubState','--property=Result','--property=ExecMainStatus'],{encoding:'utf8',timeout:5000,maxBuffer:120000,env});
      if(shown.status!==0){showError=String(shown.stderr||shown.stdout||'').slice(0,4000);break;}
      const props=Object.fromEntries(String(shown.stdout||'').trim().split(/\n+/).map(line=>{const i=line.indexOf('=');return i<0?[line,'']:[line.slice(0,i),line.slice(i+1)];}));
      activeState=props.ActiveState||'';subState=props.SubState||'';result=props.Result||'';
      const parsed=Number.parseInt(props.ExecMainStatus||'',10);execMainStatus=Number.isInteger(parsed)?parsed:null;
      if(subState==='exited'||activeState==='failed'||activeState==='inactive')break;
      Atomics.wait(sleeper,0,0,250);
    }
  }
  const journal=spawnSync('/usr/bin/journalctl',['--no-pager','--quiet','--unit='+serviceUnit,'--output=cat','--lines=2000'],{encoding:'utf8',timeout:10000,maxBuffer:400000,env});
  spawnSync('/usr/bin/systemctl',['stop',serviceUnit],{encoding:'utf8',timeout:10000,maxBuffer:40000,env});
  spawnSync('/usr/bin/systemctl',['reset-failed',serviceUnit],{encoding:'utf8',timeout:10000,maxBuffer:40000,env});
  const exitCode=started.status===0?execMainStatus:started.status;
  const ok=started.status===0&&exitCode===0&&result==='success'&&(subState==='exited'||activeState==='inactive');
  return {ok,suite:'v18_contract',exit_code:Number.isInteger(exitCode)?exitCode:null,stdout:String(journal.stdout||'').slice(0,100000),stderr:[String(started.stderr||''),showError,String(journal.stderr||'')].filter(Boolean).join('\n').slice(0,20000),sandbox:{no_new_privileges:true,private_tmp:true,protect_system:'strict',protect_home:'read-only'},transport:{mode:'named_transient_unit_journal',unit:serviceUnit,active_state:activeState,sub_state:subState,result},production_mutation:false};
}`;
let v18Source=backupBytes(V18_OWNER_SHA).toString('utf8');
if(v18Source.split(oldV18).length-1!==1)throw new Error('zdt_v28_v18_runner_anchor_mismatch');
v18Source=v18Source.replace(oldV18,newV18);
const v18Bytes=Buffer.from(v18Source,'utf8');
const v18Sha=sha(v18Bytes);
writeDerived(path.join(HERE,'.safeFiles-honartik-settlement-base-'+v18Sha+'.mjs'),v18Bytes);

let shifaSource=backupBytes(SHIFA_BASE_SHA).toString('utf8');
const ownerAnchor="const BASE_SHA='"+V18_OWNER_SHA+"';";
if(shifaSource.split(ownerAnchor).length-1!==1)throw new Error('zdt_v28_owner_sha_anchor_mismatch');
shifaSource=shifaSource.replace(ownerAnchor,"const BASE_SHA='"+v18Sha+"';");
const shifaBytes=Buffer.from(shifaSource,'utf8');
const shifaSha=sha(shifaBytes);
writeDerived(path.join(HERE,'.safeFiles-shifa-ca-base-'+shifaSha+'.mjs'),shifaBytes);
const shifaAnchor="const BASE_SHA='"+SHIFA_BASE_SHA+"';";
if(source.split(shifaAnchor).length-1!==1)throw new Error('zdt_v28_shifa_sha_anchor_mismatch');
source=source.replace(shifaAnchor,"const BASE_SHA='"+shifaSha+"';");

const insertAnchor='export function registerSafeFilesPlugin(mcp,context){';
if(source.split(insertAnchor).length-1!==1)throw new Error('zdt_v19_register_anchor_mismatch');

const helper=String.raw`
const ZDT_WORKTREE='/home/prhm/worktrees/prhm-host-actions-zdt-installer-v2';
const ZDT_FILES=Object.freeze([
  'bootstrap-host-actions-v18-agent-zdt-current-baseline-refresh.js',
  'test-v18-agent-zdt-current-baseline-refresh.js'
]);
const ZDT_TEST='test-v18-agent-zdt-current-baseline-refresh.js';
const ZdtDevFile=z.enum(ZDT_FILES);

function assertZdtWorktree(){
  const st=fs.lstatSync(ZDT_WORKTREE);
  if(!st.isDirectory()||st.isSymbolicLink())throw new Error('zdt_v19_worktree_invalid');
  if(fs.realpathSync(ZDT_WORKTREE)!==ZDT_WORKTREE)throw new Error('zdt_v19_worktree_realpath_mismatch');
}
function fixedZdtFile(name){
  if(!ZDT_FILES.includes(name))throw new Error('zdt_v19_file_not_allowlisted');
  assertZdtWorktree();
  const file=path.join(ZDT_WORKTREE,name);
  if(fs.realpathSync(path.dirname(file))!==ZDT_WORKTREE)throw new Error('zdt_v19_parent_escape');
  return file;
}
function zdtFileState(file){
  try{const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink())throw new Error('zdt_v19_regular_file_required');const real=fs.realpathSync(file);if(path.dirname(real)!==ZDT_WORKTREE)throw new Error('zdt_v19_file_escape');const b=fs.readFileSync(real);return {exists:true,bytes:b,sha256:digest(b)};}catch(error){if(error?.code==='ENOENT')return {exists:false,bytes:null,sha256:ABSENT_SHA};throw error;}
}
function patchZdtFile(args){
  const file=fixedZdtFile(args.file);const before=zdtFileState(file);if(before.sha256!==args.expected_old_sha256)throw new Error('zdt_v19_old_sha_mismatch');const candidate=Buffer.from(String(args.new_content),'utf8');if(candidate.length>120000)throw new Error('zdt_v19_candidate_too_large');const candidateSha=digest(candidate);if(candidateSha!==args.expected_new_sha256)throw new Error('zdt_v19_new_sha_mismatch');const tmp=file+'.'+process.pid+'.'+Date.now()+'.tmp';let committed=false;try{fs.writeFileSync(tmp,candidate,{mode:0o644,flag:'wx'});if(digest(fs.readFileSync(tmp))!==candidateSha)throw new Error('zdt_v19_tmp_sha_mismatch');fs.renameSync(tmp,file);committed=true;const after=zdtFileState(file);if(after.sha256!==candidateSha)throw new Error('zdt_v19_post_sha_mismatch');return {ok:true,file:args.file,old_sha256:before.sha256,new_sha256:after.sha256,created:!before.exists,atomic:true,rollback_performed:false,production_mutation:false};}catch(error){try{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}catch{}if(committed){try{if(before.exists){const rb=file+'.rollback-'+process.pid+'-'+Date.now()+'.tmp';fs.writeFileSync(rb,before.bytes,{mode:0o644,flag:'wx'});fs.renameSync(rb,file);}else if(fs.existsSync(file)){fs.unlinkSync(file);}}catch(rb){throw new Error('zdt_v19_patch_failed_and_rollback_failed:'+String(error?.message||error)+':'+String(rb?.message||rb));}}throw error;}
}
function runZdtContract(){
  assertZdtWorktree();const testFile=fixedZdtFile(ZDT_TEST);if(!fs.existsSync(testFile))throw new Error('zdt_v19_test_missing');const unit='prhm-agent-zdt-v19-contract-'+process.pid+'-'+Date.now();const serviceUnit=unit+'.service';const env={PATH:'/usr/local/bin:/usr/bin:/bin',LC_ALL:'C'};const startArgs=['--unit='+unit,'--quiet','--property=Type=oneshot','--property=RemainAfterExit=yes','--property=TimeoutStartSec=120','--property=StandardOutput=journal','--property=StandardError=journal','--property=NoNewPrivileges=yes','--property=PrivateTmp=yes','--property=PrivateDevices=yes','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=RestrictAddressFamilies=AF_UNIX','--property=WorkingDirectory='+ZDT_WORKTREE,'/usr/local/bin/prhm-node','--test',ZDT_TEST];const started=spawnSync('/usr/bin/systemd-run',startArgs,{encoding:'utf8',timeout:15000,maxBuffer:120000,env});let activeState='',subState='',result='',execMainStatus=null,showError='';if(started.status===0){const sleeper=new Int32Array(new SharedArrayBuffer(4));for(let i=0;i<240;i++){const shown=spawnSync('/usr/bin/systemctl',['show',serviceUnit,'--no-pager','--property=ActiveState','--property=SubState','--property=Result','--property=ExecMainStatus'],{encoding:'utf8',timeout:5000,maxBuffer:120000,env});if(shown.status!==0){showError=String(shown.stderr||shown.stdout||'').slice(0,4000);break;}const props=Object.fromEntries(String(shown.stdout||'').trim().split(/\n+/).map(line=>{const i=line.indexOf('=');return i<0?[line,'']:[line.slice(0,i),line.slice(i+1)];}));activeState=props.ActiveState||'';subState=props.SubState||'';result=props.Result||'';const parsed=Number.parseInt(props.ExecMainStatus||'',10);execMainStatus=Number.isInteger(parsed)?parsed:null;if(subState==='exited'||activeState==='failed'||activeState==='inactive')break;Atomics.wait(sleeper,0,0,250);}}const journal=spawnSync('/usr/bin/journalctl',['--no-pager','--quiet','--unit='+serviceUnit,'--output=cat','--lines=2000'],{encoding:'utf8',timeout:10000,maxBuffer:400000,env});spawnSync('/usr/bin/systemctl',['stop',serviceUnit],{encoding:'utf8',timeout:10000,maxBuffer:40000,env});spawnSync('/usr/bin/systemctl',['reset-failed',serviceUnit],{encoding:'utf8',timeout:10000,maxBuffer:40000,env});const exitCode=started.status===0?execMainStatus:started.status;const ok=started.status===0&&exitCode===0&&result==='success'&&(subState==='exited'||activeState==='inactive');return {ok,suite:'agent_zdt_v19_contract',state:ok?'GREEN':'RED',exit_code:Number.isInteger(exitCode)?exitCode:null,stdout:String(journal.stdout||'').slice(0,180000),stderr:[String(started.stderr||''),showError,String(journal.stderr||'')].filter(Boolean).join('\n').slice(0,40000),sandbox:{no_new_privileges:true,private_tmp:true,private_devices:true,protect_system:'strict',protect_home:'read-only',restrict_address_families:'AF_UNIX'},transport:{mode:'named_transient_unit_journal',unit:serviceUnit,active_state:activeState,sub_state:subState,result},production_mutation:false};
}
function zdtDiff(){assertZdtWorktree();const common=['-c','safe.directory='+ZDT_WORKTREE,'-C',ZDT_WORKTREE];const branch=git([...common,'branch','--show-current'],{timeout:12000,maxBuffer:120000});const status=git([...common,'status','--porcelain=v1','--',...ZDT_FILES],{timeout:12000,maxBuffer:120000});const d=git([...common,'diff','--no-ext-diff','--',...ZDT_FILES],{timeout:12000,maxBuffer:220000});const files=Object.fromEntries(ZDT_FILES.map(name=>{const s=zdtFileState(path.join(ZDT_WORKTREE,name));return [name,{exists:s.exists,sha256:s.sha256}];}));return {ok:branch.status===0&&status.status===0&&d.status===0,read_only:true,branch:String(branch.stdout||'').trim(),status:String(status.stdout||'').slice(0,12000),diff:String(d.stdout||'').slice(0,180000),files,production_mutation:false};}
function zdtGitSync(){assertZdtWorktree();const common=['-c','safe.directory='+ZDT_WORKTREE,'-C',ZDT_WORKTREE];const branchResult=git([...common,'branch','--show-current'],{timeout:12000,maxBuffer:120000});if(branchResult.status!==0)throw new Error('zdt_v19_branch_read_failed');const branch=String(branchResult.stdout||'').trim();if(!branch)throw new Error('zdt_v19_detached_head_rejected');const add=git([...common,'add','--',...ZDT_FILES],{timeout:20000,maxBuffer:120000});if(add.status!==0)throw new Error('zdt_v19_git_add_failed:'+String(add.stderr||add.stdout||'').slice(0,4000));const staged=git([...common,'diff','--cached','--quiet','--',...ZDT_FILES],{timeout:12000,maxBuffer:120000});let committed=false;if(staged.status===1){const commit=git([...common,'commit','-m','fix(zdt): embed immutable registration installer artifact','--',...ZDT_FILES],{timeout:60000,maxBuffer:240000});if(commit.status!==0)throw new Error('zdt_v19_git_commit_failed:'+String(commit.stderr||commit.stdout||'').slice(0,8000));committed=true;}else if(staged.status!==0)throw new Error('zdt_v19_git_staged_check_failed');const head=git([...common,'rev-parse','HEAD'],{timeout:12000,maxBuffer:120000});if(head.status!==0)throw new Error('zdt_v19_git_head_failed');const headSha=String(head.stdout||'').trim();const push=git([...common,'push','origin','HEAD:'+branch],{timeout:120000,maxBuffer:300000});if(push.status!==0)throw new Error('zdt_v19_git_push_failed:'+String(push.stderr||push.stdout||'').slice(0,12000));const verify=git([...common,'rev-parse','origin/'+branch],{timeout:12000,maxBuffer:120000});if(verify.status!==0)throw new Error('zdt_v19_git_remote_verify_failed');const remoteSha=String(verify.stdout||'').trim();if(remoteSha!==headSha)throw new Error('zdt_v19_git_remote_sha_mismatch');return {ok:true,branch,head:headSha,remote_head:remoteSha,committed,pushed:true,production_mutation:false};}
`;
source=source.replace(insertAnchor,helper+'\n'+insertAnchor);
const registerAnchor='  base.registerSafeFilesPlugin(mcp,context);';
if(source.split(registerAnchor).length-1!==1)throw new Error('zdt_v19_base_register_anchor_mismatch');
const registration=String.raw`
  mcp.registerTool('control_plane_agent_zdt_v19_worktree_patch_v1',{title:'Patch Agent ZDT V19 Development File',description:'Atomically patch exactly one of two fixed Agent ZDT V19 development files in the existing isolated prhm-host-actions worktree with mandatory old/new SHA-256 binding and rollback. No production application tree is touched.',inputSchema:{file:ZdtDevFile,expected_old_sha256:Sha,new_content:z.string().max(120000),expected_new_sha256:Sha},annotations:DEVWR},async args=>textResult(patchZdtFile(args)));
  mcp.registerTool('control_plane_agent_zdt_v19_worktree_test_v1',{title:'Test Agent ZDT V19 Contract',description:'Run only the fixed Agent ZDT V19 contract test in a read-only systemd sandbox. No arbitrary command, path, environment, service, credential, or production input is accepted.',inputSchema:{suite:z.literal('contract')},annotations:RO},async()=>textResult(runZdtContract()));
  mcp.registerTool('control_plane_agent_zdt_v19_worktree_diff_v1',{title:'Agent ZDT V19 Worktree Diff',description:'Return Git branch/status/diff and SHA metadata only for the two fixed Agent ZDT V19 development files.',inputSchema:{},annotations:RO},async()=>textResult(zdtDiff()));
  mcp.registerTool('control_plane_agent_zdt_v19_worktree_git_sync_v1',{title:'Sync Agent ZDT V19 Worktree to Git',description:'Stage only the two fixed Agent ZDT V19 development files, create the fixed commit when needed, push the current non-detached branch to origin, and verify remote HEAD equality. No arbitrary repo, path, branch, remote, commit message, or Git argument input is accepted.',inputSchema:{},annotations:DEVWR},async()=>textResult(zdtGitSync()));
`;
source=source.replace(registerAnchor,registerAnchor+registration);
const out=Buffer.from(source,'utf8');
writeDerived(PATCHED,out);
const mod=await import(pathToFileURL(PATCHED).href+'?zdt-v19='+BASE_SHA);
if(typeof mod.registerSafeFilesPlugin!=='function')throw new Error('zdt_v19_register_export_missing');
export const registerSafeFilesPlugin=mod.registerSafeFilesPlugin;
