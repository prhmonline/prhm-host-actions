import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const BASE_SHA='a177d675a5a198e82b690e3c09732c0b81f2b5019d84acc405ebea7cd27fb033';
const ROOT='/var/backups/prhm-agent-selfmaint';
const HERE=path.dirname(new URL(import.meta.url).pathname);
const BASE_FILE=path.join(HERE,'.safeFiles-zdt-v32-base-'+BASE_SHA+'.mjs');
const WORKTREE='/home/prhm/worktrees/prhm-host-actions-zdt-installer-v2';
const OLD_SYNC='control_plane_agent_zdt_v19_worktree_git_sync_v1';
const NEW_SYNC='control_plane_agent_zdt_v19_worktree_git_sync_v2';
const sha=b=>createHash('sha256').update(b).digest('hex');

function ensureBase(){
  try{if(sha(fs.readFileSync(BASE_FILE))===BASE_SHA)return;}catch{}
  const names=fs.readdirSync(ROOT)
    .filter(n=>n.startsWith('agent_mcp-src_plugins_safeFiles.js-')&&n.endsWith('-'+BASE_SHA+'.bak'))
    .sort().reverse();
  if(!names.length)throw new Error('zdt_v33_base_backup_missing');
  const bytes=fs.readFileSync(path.join(ROOT,names[0]));
  if(sha(bytes)!==BASE_SHA)throw new Error('zdt_v33_base_sha_mismatch');
  const tmp=BASE_FILE+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,BASE_FILE);
  fs.chmodSync(BASE_FILE,0o600);
}

function runUnit(name,script,{writable=[],timeout=300}={}){
  const unit=name+'-'+process.pid+'-'+Date.now(),service=unit+'.service';
  const env={PATH:'/usr/local/bin:/usr/bin:/bin',LC_ALL:'C'};
  const args=['--unit='+unit,'--quiet','--property=Type=oneshot','--property=RemainAfterExit=yes',
    '--property=TimeoutStartSec='+timeout,'--property=StandardOutput=journal','--property=StandardError=journal',
    '--property=NoNewPrivileges=yes','--property=PrivateTmp=yes','--property=PrivateDevices=yes',
    '--property=ProtectSystem=strict','--property=ProtectHome=read-only',
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
      active=p.ActiveState||'';sub=p.SubState||'';result=p.Result||'';
      const n=parseInt(p.ExecMainStatus||'',10);status=Number.isInteger(n)?n:null;
      if(sub==='exited'||active==='failed'||active==='inactive')break;
      Atomics.wait(sleeper,0,0,250);
    }
  }
  const j=spawnSync('/usr/bin/journalctl',['--no-pager','--quiet','--unit='+service,'--output=cat','--lines=2500'],{encoding:'utf8',timeout:10000,maxBuffer:500000,env});
  spawnSync('/usr/bin/systemctl',['stop',service],{encoding:'utf8',timeout:10000,maxBuffer:30000,env});
  spawnSync('/usr/bin/systemctl',['reset-failed',service],{encoding:'utf8',timeout:10000,maxBuffer:30000,env});
  if(!(started.status===0&&status===0&&result==='success'))
    throw new Error('zdt_v33_unit_failed:'+name+':'+[started.stderr,showErr,j.stdout,j.stderr].filter(Boolean).join('\n').slice(-12000));
  for(const line of String(j.stdout||'').trim().split(/\n+/).reverse()){
    try{const o=JSON.parse(line);if(o&&o.ok===true)return o;}catch{}
  }
  throw new Error('zdt_v33_result_missing:'+name);
}

const REBUILD=String.raw`
const fs=require('node:fs'),cp=require('node:child_process');
let s=fs.readFileSync('/root/zdt-v19-immutable-rebuild.sh','utf8');
function once(a,b,l){const n=s.split(a).length-1;if(n!==1)throw new Error(l+'_anchor_'+n);s=s.replace(a,b);}
once("OLD_IMPL_SHA='f2e36900413865d1221332063981d43adee5cd9ba39abea0ca0a69e9189e782d'","OLD_IMPL_SHA='33b14dff259393cbc1b989ca4721204845a742ce4912a139586e3af71faf85e6'","impl");
once("OLD_TEST_SHA='17eab4283e798c05a95fd6bfc5dd7ee381f5587ebfe74398f4ce372db1214fe0'","OLD_TEST_SHA='cd70da0dbf9e9b58d8bf2e66d1284eb4460863e95cc0156e9922f472562a64d1'","test");
once("BUILDER='/root/zdt-v19-immutable-builder.js'","BUILDER='/run/zdt-v19-immutable-builder-v33.js'","builder");
once('BACKUP="/root/zdt-v19-pre-rebuild-$STAMP"','BACKUP="/run/zdt-v19-pre-rebuild-$STAMP"',"backup");
once("  '/root/zdt-v19-generator-derive-' +","  '/run/zdt-v19-generator-derive-' +","derive");
once("  '0fa0229c2593459f11785929cb38a41e07c3fa4f8a61698671ec68587fd01a90';","  'd391e32332f0707a5a8829ceb436c613da9afec073b4642e2b2edd29f5c5d57d';","installer");
const bad1="testSource = replaceObjectBlock(\\n  testSource,\\n  'REGISTRATION_BASELINE_SHA256',\\n  baseline\\n);\\n\\n";
const bad2="testSource = replaceObjectBlock(\\n  testSource,\\n  'REGISTRATION_CANDIDATE_SHA256',\\n  candidate\\n);\\n\\n";
if(s.includes(bad1))s=s.replace(bad1,"");
if(s.includes(bad2))s=s.replace(bad2,"");
const old="const built =\\n  oldModule.buildRegistrationCandidates({\\n    base: owners.base.content,\\n    exec: owners.exec.content,\\n    policy: owners.policy.content,\\n    mcp: owners.mcp.content\\n  });";
const neu="let baselineDerive = replaceObjectBlock(originalImpl, 'REGISTRATION_BASELINE_SHA256', baseline);\\nconst baselineDeriveFile='/run/zdt-v19-baseline-derive-'+process.pid+'.js';\\nfs.writeFileSync(baselineDeriveFile,baselineDerive,{mode:0o600,flag:'wx'});\\nsyntax(baselineDeriveFile);\\ndelete require.cache[require.resolve(baselineDeriveFile)];\\nconst baselineModule=require(baselineDeriveFile);\\nconst built = baselineModule.buildRegistrationCandidates({\\n    base: owners.base.content,\\n    exec: owners.exec.content,\\n    policy: owners.policy.content,\\n    mcp: owners.mcp.content\\n  });\\nfs.unlinkSync(baselineDeriveFile);";
once(old,neu,"candidatebuild");
const r=cp.spawnSync('/bin/bash',['-s'],{input:s,encoding:'utf8',timeout:240000,maxBuffer:600000,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/root'}});
if(r.error||r.status!==0)throw new Error('rebuild_failed:'+String(r.stdout||r.stderr||'').slice(-12000));
const out=String(r.stdout||'');
const mi=out.match(/NEW_IMPL_SHA=([a-f0-9]{64})/g)||[],mt=out.match(/NEW_TEST_SHA=([a-f0-9]{64})/g)||[];
process.stdout.write(JSON.stringify({ok:true,action:'control_plane_agent_zdt_v19_rebuild_current_baseline_v2',new_impl_sha256:(mi.at(-1)||'').split('=')[1],new_test_sha256:(mt.at(-1)||'').split('=')[1],contract_green:out.includes('CONTRACT=GREEN'),production_mutation:false,development_mutation:true})+'\\n');
`;

ensureBase();
const base=await import(pathToFileURL(BASE_FILE).href+'?zdt-v33='+BASE_SHA);
if(typeof base.registerSafeFilesPlugin!=='function')throw new Error('zdt_v33_base_export_missing');

export function registerSafeFilesPlugin(mcp,context){
  let oldConfig=null,syncHandler=null;
  const proxy=new Proxy(mcp,{get(target,prop){
    if(prop==='registerTool')return(name,config,handler)=>{
      if(name===OLD_SYNC){oldConfig=config;return;}
      if(name===NEW_SYNC)syncHandler=handler;
      return target.registerTool.call(target,name,config,handler);
    };
    const v=Reflect.get(target,prop,target);return typeof v==='function'?v.bind(target):v;
  }});
  base.registerSafeFilesPlugin(proxy,context);
  if(!oldConfig||typeof syncHandler!=='function')throw new Error('zdt_v33_required_surface_missing');
  mcp.registerTool(OLD_SYNC,{...oldConfig,title:'Rebuild and Git Sync Agent ZDT V19 Worktree v33',
    description:'Idempotently rebuild the two fixed V19 files from current owner SHAs, require GREEN contract, then run the bounded non-force Git sync and remote HEAD verification.'},
    async()=>{
      const rebuilt=runUnit('prhm-zdt-v19-rebuild-v33',REBUILD,{writable:[WORKTREE],timeout:300});
      if(rebuilt?.contract_green!==true)throw new Error('zdt_v33_contract_not_green');
      return await syncHandler({});
    });
}
