import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { textResult } from '../core/result.js';

const BASE_SHA='d8ec64523fff91248f1195654b5f0353ce843a6982e27351baad5530647492c2';
const ROOT='/var/backups/prhm-agent-selfmaint';
const HERE=path.dirname(new URL(import.meta.url).pathname);
const BASE_FILE=path.join(HERE,'.safeFiles-zdt-v18-handler-v30-base-'+BASE_SHA+'.mjs');
const WORKTREE='/home/prhm/worktrees/prhm-host-actions-zdt-installer-v2';
const GITDIR='/home/prhm/git/prhm-host-actions.git';
const TEST='test-v18-agent-zdt-current-baseline-refresh.js';
const TARGET_TOOL='control_plane_agent_zdt_v18_worktree_test_v1';
const sha=b=>createHash('sha256').update(b).digest('hex');

function ensureBase(){
  try{if(sha(fs.readFileSync(BASE_FILE))===BASE_SHA)return;}catch{}
  const names=fs.readdirSync(ROOT).filter(n=>n.startsWith('agent_mcp-src_plugins_safeFiles.js-')&&n.endsWith('-'+BASE_SHA+'.bak')).sort().reverse();
  if(!names.length)throw new Error('zdt_v31_base_backup_missing');
  const bytes=fs.readFileSync(path.join(ROOT,names[0]));
  if(sha(bytes)!==BASE_SHA)throw new Error('zdt_v31_base_sha_mismatch');
  const tmp=BASE_FILE+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});fs.renameSync(tmp,BASE_FILE);fs.chmodSync(BASE_FILE,0o600);
}
ensureBase();
const base=await import(pathToFileURL(BASE_FILE).href+'?zdt-v31='+BASE_SHA);
if(typeof base.registerSafeFilesPlugin!=='function')throw new Error('zdt_v31_base_export_missing');

function assertWorktree(){
  const st=fs.lstatSync(WORKTREE);
  if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(WORKTREE)!==WORKTREE)throw new Error('zdt_v31_worktree_invalid');
}
function runUnit(name,script,{writable=[],timeout=300}={}){
  assertWorktree();
  const unit=name+'-'+process.pid+'-'+Date.now(), service=unit+'.service';
  const env={PATH:'/usr/local/bin:/usr/bin:/bin',LC_ALL:'C'};
  const args=['--unit='+unit,'--quiet','--property=Type=oneshot','--property=RemainAfterExit=yes','--property=TimeoutStartSec='+timeout,
    '--property=StandardOutput=journal','--property=StandardError=journal','--property=NoNewPrivileges=yes','--property=PrivateTmp=yes',
    '--property=PrivateDevices=yes','--property=ProtectSystem=strict','--property=ProtectHome=read-only',
    '--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','--property=WorkingDirectory='+WORKTREE,
    ...writable.map(p=>'--property=BindPaths='+p),'/usr/local/bin/prhm-node','-e',script];
  const started=spawnSync('/usr/bin/systemd-run',args,{encoding:'utf8',timeout:15000,maxBuffer:120000,env});
  let active='',sub='',result='',status=null,showErr='';
  if(started.status===0){
    const sleeper=new Int32Array(new SharedArrayBuffer(4));
    for(let i=0;i<timeout*4;i++){
      const r=spawnSync('/usr/bin/systemctl',['show',service,'--no-pager','--property=ActiveState','--property=SubState','--property=Result','--property=ExecMainStatus'],{encoding:'utf8',timeout:5000,maxBuffer:120000,env});
      if(r.status!==0){showErr=String(r.stderr||r.stdout||'').slice(0,3000);break;}
      const p=Object.fromEntries(String(r.stdout||'').trim().split(/\n+/).map(x=>{const j=x.indexOf('=');return [x.slice(0,j),x.slice(j+1)];}));
      active=p.ActiveState||'';sub=p.SubState||'';result=p.Result||'';const n=parseInt(p.ExecMainStatus||'',10);status=Number.isInteger(n)?n:null;
      if(sub==='exited'||active==='failed'||active==='inactive')break;Atomics.wait(sleeper,0,0,250);
    }
  }
  const j=spawnSync('/usr/bin/journalctl',['--no-pager','--quiet','--unit='+service,'--output=cat','--lines=2500'],{encoding:'utf8',timeout:10000,maxBuffer:500000,env});
  spawnSync('/usr/bin/systemctl',['stop',service],{encoding:'utf8',timeout:10000,maxBuffer:30000,env});
  spawnSync('/usr/bin/systemctl',['reset-failed',service],{encoding:'utf8',timeout:10000,maxBuffer:30000,env});
  if(!(started.status===0&&status===0&&result==='success'))throw new Error('zdt_v31_unit_failed:'+name+':'+[started.stderr,showErr,j.stdout,j.stderr].filter(Boolean).join('\n').slice(-10000));
  for(const line of String(j.stdout||'').trim().split(/\n+/).reverse()){try{const o=JSON.parse(line);if(o&&o.ok===true)return o;}catch{}}
  throw new Error('zdt_v31_result_missing:'+name);
}
function runV18Contract(){
  const helper="const cp=require('node:child_process');const r=cp.spawnSync('/usr/local/bin/prhm-node',['--test','"+TEST+"'],{cwd:"+JSON.stringify(WORKTREE)+",encoding:'utf8',timeout:120000,maxBuffer:400000});process.stdout.write(JSON.stringify({ok:!r.error&&r.status===0,suite:'v18_contract',state:(!r.error&&r.status===0)?'GREEN':'RED',exit_code:r.status,stdout:String(r.stdout||'').slice(0,100000),stderr:String(r.stderr||'').slice(0,20000),production_mutation:false})+'\\n');process.exit(r.error?2:(r.status||0));";
  return runUnit('prhm-agent-zdt-v18-contract-v31',helper,{timeout:150});
}

const REBUILD=String.raw`
const fs=require('node:fs'),cp=require('node:child_process');
let s=fs.readFileSync('/root/zdt-v19-immutable-rebuild.sh','utf8');
function once(a,b,l){const n=s.split(a).length-1;if(n!==1)throw new Error(l+'_anchor_'+n);s=s.replace(a,b);}
once("OLD_IMPL_SHA='f2e36900413865d1221332063981d43adee5cd9ba39abea0ca0a69e9189e782d'","OLD_IMPL_SHA='33b14dff259393cbc1b989ca4721204845a742ce4912a139586e3af71faf85e6'","impl");
once("OLD_TEST_SHA='17eab4283e798c05a95fd6bfc5dd7ee381f5587ebfe74398f4ce372db1214fe0'","OLD_TEST_SHA='cd70da0dbf9e9b58d8bf2e66d1284eb4460863e95cc0156e9922f472562a64d1'","test");
once("BUILDER='/root/zdt-v19-immutable-builder.js'","BUILDER='/run/zdt-v19-immutable-builder-v31.js'","builder");
once('BACKUP="/root/zdt-v19-pre-rebuild-$STAMP"','BACKUP="/run/zdt-v19-pre-rebuild-$STAMP"',"backup");
once("  '/root/zdt-v19-generator-derive-' +","  '/run/zdt-v19-generator-derive-' +","derive");
once("  '0fa0229c2593459f11785929cb38a41e07c3fa4f8a61698671ec68587fd01a90';","  'd391e32332f0707a5a8829ceb436c613da9afec073b4642e2b2edd29f5c5d57d';","installer");
const bad1="testSource = replaceObjectBlock(\\n  testSource,\\n  'REGISTRATION_BASELINE_SHA256',\\n  baseline\\n);\\n\\n";
const bad2="testSource = replaceObjectBlock(\\n  testSource,\\n  'REGISTRATION_CANDIDATE_SHA256',\\n  candidate\\n);\\n\\n";
once(bad1,"","testbaseline");once(bad2,"","testcandidate");
const old="const built =\\n  oldModule.buildRegistrationCandidates({\\n    base: owners.base.content,\\n    exec: owners.exec.content,\\n    policy: owners.policy.content,\\n    mcp: owners.mcp.content\\n  });";
const neu="let baselineDerive = replaceObjectBlock(originalImpl, 'REGISTRATION_BASELINE_SHA256', baseline);\\nconst baselineDeriveFile='/run/zdt-v19-baseline-derive-'+process.pid+'.js';\\nfs.writeFileSync(baselineDeriveFile,baselineDerive,{mode:0o600,flag:'wx'});\\nsyntax(baselineDeriveFile);\\ndelete require.cache[require.resolve(baselineDeriveFile)];\\nconst baselineModule=require(baselineDeriveFile);\\nconst built = baselineModule.buildRegistrationCandidates({\\n    base: owners.base.content,\\n    exec: owners.exec.content,\\n    policy: owners.policy.content,\\n    mcp: owners.mcp.content\\n  });\\nfs.unlinkSync(baselineDeriveFile);";
once(old,neu,"candidatebuild");
const r=cp.spawnSync('/bin/bash',['-s'],{input:s,encoding:'utf8',timeout:240000,maxBuffer:600000,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/root'}});
if(r.error||r.status!==0)throw new Error('rebuild_failed:'+String(r.stdout||r.stderr||'').slice(-12000));
const out=String(r.stdout||'');const mi=out.match(/NEW_IMPL_SHA=([a-f0-9]{64})/g)||[], mt=out.match(/NEW_TEST_SHA=([a-f0-9]{64})/g)||[];
process.stdout.write(JSON.stringify({ok:true,action:'control_plane_agent_zdt_v19_rebuild_current_baseline_v1',new_impl_sha256:(mi.at(-1)||'').split('=')[1],new_test_sha256:(mt.at(-1)||'').split('=')[1],contract_green:out.includes('CONTRACT=GREEN'),production_mutation:false,development_mutation:true})+'\\n');
`;

const GITSYNC=String.raw`
const cp=require('node:child_process');
const WT='/home/prhm/worktrees/prhm-host-actions-zdt-installer-v2',B='feature/agent-zdt-fixed-action-installer-v2';
const F=['bootstrap-host-actions-v18-agent-zdt-current-baseline-refresh.js','test-v18-agent-zdt-current-baseline-refresh.js'];
function g(a,t=120000){const r=cp.spawnSync('/usr/bin/git',['-c','safe.directory='+WT,'-C',WT,...a],{encoding:'utf8',timeout:t,maxBuffer:400000,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/root'}});if(r.error||r.status!==0)throw new Error('git_'+a[0]+':'+String(r.stderr||r.stdout||'').slice(0,4000));return String(r.stdout||'').trim();}
if(g(['symbolic-ref','--short','HEAD'])!==B)throw new Error('branch_mismatch');
for(const x of g(['status','--porcelain=v1','--untracked-files=all']).split('\\n').filter(Boolean)){const c=x.slice(0,2),p=x.slice(3);if(F.includes(p))continue;if(c!=='??')throw new Error('unrelated_tracked_change');}
g(['add','--',...F]);const staged=g(['diff','--cached','--name-only']).split('\\n').filter(Boolean).sort();
if(JSON.stringify(staged)!==JSON.stringify([...F].sort()))throw new Error('staged_scope_mismatch');
const q=cp.spawnSync('/usr/local/bin/prhm-node',['--test',F[1]],{cwd:WT,encoding:'utf8',timeout:120000,maxBuffer:400000});if(q.error||q.status!==0)throw new Error('contract_not_green');
g(['-c','user.name=PRHM Agent','-c','user.email=agent@prhm.invalid','commit','-m','fix(agent-zdt): refresh v19 immutable current baseline']);
const h=g(['rev-parse','HEAD']);g(['push','origin','HEAD:refs/heads/'+B],180000);const r=g(['ls-remote','origin','refs/heads/'+B],180000).split(/\\s+/)[0]||'';
if(r!==h)throw new Error('remote_head_mismatch');
process.stdout.write(JSON.stringify({ok:true,action:'control_plane_agent_zdt_v19_worktree_git_sync_v2',branch:B,head:h,remote_head:r,force:false,production_mutation:false})+'\\n');
`;

export function registerSafeFilesPlugin(mcp,context){
  let replaced=false;
  const proxy=new Proxy(mcp,{get(target,prop){
    if(prop==='registerTool')return (name,config,handler)=>{
      if(name===TARGET_TOOL){if(replaced)throw new Error('zdt_v31_duplicate_target');replaced=true;return target.registerTool.call(target,name,config,async()=>textResult(runV18Contract()));}
      return target.registerTool.call(target,name,config,handler);
    };
    const v=Reflect.get(target,prop,target);return typeof v==='function'?v.bind(target):v;
  }});
  base.registerSafeFilesPlugin(proxy,context);
  if(!replaced)throw new Error('zdt_v31_target_missing');
  const mut={readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false};
  mcp.registerTool('control_plane_agent_zdt_v19_rebuild_current_baseline_v1',{title:'Rebuild Agent ZDT V19 Immutable Baseline',description:'Rebuild exactly the two fixed V19 development files from current SHA-bound owners and roll back on contract failure.',inputSchema:{},annotations:mut},async()=>textResult(runUnit('prhm-zdt-v19-rebuild-v31',REBUILD,{writable:[WORKTREE],timeout:300})));
  mcp.registerTool('control_plane_agent_zdt_v19_worktree_git_sync_v2',{title:'Git Sync Agent ZDT V19 Worktree',description:'Stage exactly the two fixed V19 files, require GREEN contract, commit without force, push the fixed branch, and verify remote HEAD.',inputSchema:{},annotations:mut},async()=>textResult(runUnit('prhm-zdt-v19-gitsync-v31',GITSYNC,{writable:[GITDIR],timeout:360})));
}
