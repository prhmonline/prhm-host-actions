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
const TEST='test-v18-agent-zdt-current-baseline-refresh.js';
const TARGET_TOOL='control_plane_agent_zdt_v18_worktree_test_v1';
const sha=b=>createHash('sha256').update(b).digest('hex');

function ensureBase(){
  try{if(sha(fs.readFileSync(BASE_FILE))===BASE_SHA)return;}catch{}
  const names=fs.readdirSync(ROOT)
    .filter(n=>n.startsWith('agent_mcp-src_plugins_safeFiles.js-')&&n.endsWith('-'+BASE_SHA+'.bak'))
    .sort().reverse();
  if(!names.length)throw new Error('zdt_v18_v30_base_backup_missing');
  const bytes=fs.readFileSync(path.join(ROOT,names[0]));
  if(sha(bytes)!==BASE_SHA)throw new Error('zdt_v18_v30_base_sha_mismatch');
  const tmp=BASE_FILE+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,BASE_FILE);
  fs.chmodSync(BASE_FILE,0o600);
}

ensureBase();
const base=await import(pathToFileURL(BASE_FILE).href+'?zdt-v18-handler-v30='+BASE_SHA);
if(typeof base.registerSafeFilesPlugin!=='function')throw new Error('zdt_v18_v30_base_export_missing');

function assertWorktree(){
  const st=fs.lstatSync(WORKTREE);
  if(!st.isDirectory()||st.isSymbolicLink())throw new Error('zdt_v18_v30_worktree_invalid');
  if(fs.realpathSync(WORKTREE)!==WORKTREE)throw new Error('zdt_v18_v30_worktree_realpath_mismatch');
  const file=path.join(WORKTREE,TEST);
  const fst=fs.lstatSync(file);
  if(!fst.isFile()||fst.isSymbolicLink())throw new Error('zdt_v18_v30_test_invalid');
  if(fs.realpathSync(path.dirname(file))!==WORKTREE)throw new Error('zdt_v18_v30_test_escape');
}

function runV18Contract(){
  assertWorktree();
  const unit='prhm-agent-zdt-v18-contract-'+process.pid+'-'+Date.now();
  const serviceUnit=unit+'.service';
  const env={PATH:'/usr/local/bin:/usr/bin:/bin',LC_ALL:'C'};
  const args=[
    '--unit='+unit,'--quiet',
    '--property=Type=oneshot',
    '--property=RemainAfterExit=yes',
    '--property=TimeoutStartSec=120',
    '--property=StandardOutput=journal',
    '--property=StandardError=journal',
    '--property=NoNewPrivileges=yes',
    '--property=PrivateTmp=yes',
    '--property=ProtectSystem=strict',
    '--property=ProtectHome=read-only',
    '--property=WorkingDirectory='+WORKTREE,
    '/usr/local/bin/prhm-node','--test',TEST
  ];
  const started=spawnSync('/usr/bin/systemd-run',args,{encoding:'utf8',timeout:15000,maxBuffer:120000,env});
  let activeState='',subState='',result='',execMainStatus=null,showError='';
  if(started.status===0){
    const sleeper=new Int32Array(new SharedArrayBuffer(4));
    for(let i=0;i<240;i++){
      const shown=spawnSync('/usr/bin/systemctl',['show',serviceUnit,'--no-pager','--property=ActiveState','--property=SubState','--property=Result','--property=ExecMainStatus'],{encoding:'utf8',timeout:5000,maxBuffer:120000,env});
      if(shown.status!==0){showError=String(shown.stderr||shown.stdout||'').slice(0,4000);break;}
      const props=Object.fromEntries(String(shown.stdout||'').trim().split(/\n+/).map(line=>{const i=line.indexOf('=');return i<0?[line,'']:[line.slice(0,i),line.slice(i+1)];}));
      activeState=props.ActiveState||'';
      subState=props.SubState||'';
      result=props.Result||'';
      const parsed=Number.parseInt(props.ExecMainStatus||'',10);
      execMainStatus=Number.isInteger(parsed)?parsed:null;
      if(subState==='exited'||activeState==='failed'||activeState==='inactive')break;
      Atomics.wait(sleeper,0,0,250);
    }
  }
  const journal=spawnSync('/usr/bin/journalctl',['--no-pager','--quiet','--unit='+serviceUnit,'--output=cat','--lines=2000'],{encoding:'utf8',timeout:10000,maxBuffer:400000,env});
  spawnSync('/usr/bin/systemctl',['stop',serviceUnit],{encoding:'utf8',timeout:10000,maxBuffer:40000,env});
  spawnSync('/usr/bin/systemctl',['reset-failed',serviceUnit],{encoding:'utf8',timeout:10000,maxBuffer:40000,env});
  const exitCode=started.status===0?execMainStatus:started.status;
  const ok=started.status===0&&exitCode===0&&result==='success'&&(subState==='exited'||activeState==='inactive');
  return {
    ok,
    suite:'v18_contract',
    state:ok?'GREEN':'RED',
    exit_code:Number.isInteger(exitCode)?exitCode:null,
    stdout:String(journal.stdout||'').slice(0,100000),
    stderr:[String(started.stderr||''),showError,String(journal.stderr||'')].filter(Boolean).join('\n').slice(0,20000),
    sandbox:{no_new_privileges:true,private_tmp:true,protect_system:'strict',protect_home:'read-only'},
    transport:{mode:'named_transient_unit_journal',unit:serviceUnit,active_state:activeState,sub_state:subState,result},
    production_mutation:false
  };
}

export function registerSafeFilesPlugin(mcp,context){
  let replaced=false;
  const proxy=new Proxy(mcp,{
    get(target,prop){
      if(prop==='registerTool'){
        return (name,config,handler)=>{
          if(name===TARGET_TOOL){
            if(replaced)throw new Error('zdt_v18_v30_duplicate_target_tool');
            replaced=true;
            return target.registerTool.call(target,name,config,async()=>textResult(runV18Contract()));
          }
          return target.registerTool.call(target,name,config,handler);
        };
      }
      const value=Reflect.get(target,prop,target);
      return typeof value==='function'?value.bind(target):value;
    }
  });
  base.registerSafeFilesPlugin(proxy,context);
  if(!replaced)throw new Error('zdt_v18_v30_target_tool_not_found');
}
