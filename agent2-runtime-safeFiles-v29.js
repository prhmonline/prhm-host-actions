import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { textResult } from '../core/result.js';

const BASE_SHA='71cec8afbd7b910e16d47b6e4feddf07efe114bbb82db39b1ad92406e4cd3a60';
const ROOT='/var/backups/prhm-agent-selfmaint';
const HERE=path.dirname(new URL(import.meta.url).pathname);
const BASE_FILE=path.join(HERE,'.safeFiles-zdt-v18-v2-base-'+BASE_SHA+'.mjs');
const WORKTREE='/home/prhm/worktrees/prhm-host-actions-zdt-installer-v2';
const TEST='test-v18-agent-zdt-current-baseline-refresh.js';
const RO={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const sha=b=>createHash('sha256').update(b).digest('hex');

function ensureBase(){
  try{if(sha(fs.readFileSync(BASE_FILE))===BASE_SHA)return;}catch{}
  const names=fs.readdirSync(ROOT)
    .filter(n=>n.startsWith('agent_mcp-src_plugins_safeFiles.js-')&&n.endsWith('-'+BASE_SHA+'.bak'))
    .sort().reverse();
  if(!names.length)throw new Error('zdt_v18_v2_base_backup_missing');
  const bytes=fs.readFileSync(path.join(ROOT,names[0]));
  if(sha(bytes)!==BASE_SHA)throw new Error('zdt_v18_v2_base_sha_mismatch');
  const tmp=BASE_FILE+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,BASE_FILE);
  fs.chmodSync(BASE_FILE,0o600);
}

ensureBase();
const base=await import(pathToFileURL(BASE_FILE).href+'?zdt-v18-v2='+BASE_SHA);
if(typeof base.registerSafeFilesPlugin!=='function')throw new Error('zdt_v18_v2_base_export_missing');

function assertWorktree(){
  const st=fs.lstatSync(WORKTREE);
  if(!st.isDirectory()||st.isSymbolicLink())throw new Error('zdt_v18_v2_worktree_invalid');
  if(fs.realpathSync(WORKTREE)!==WORKTREE)throw new Error('zdt_v18_v2_worktree_realpath_mismatch');
  const file=path.join(WORKTREE,TEST);
  const fst=fs.lstatSync(file);
  if(!fst.isFile()||fst.isSymbolicLink())throw new Error('zdt_v18_v2_test_invalid');
  if(fs.realpathSync(path.dirname(file))!==WORKTREE)throw new Error('zdt_v18_v2_test_escape');
  return file;
}

function runV18ContractV2(){
  assertWorktree();
  const unit='prhm-agent-zdt-v18-v2-'+process.pid+'-'+Date.now();
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
    runner:'v2',
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
  base.registerSafeFilesPlugin(mcp,context);
  mcp.registerTool(
    'control_plane_agent_zdt_v18_worktree_test_v2',
    {
      title:'Test Agent ZDT V18 Contract v2',
      description:'Run only the fixed V18 contract in the existing worktree using a named transient systemd unit with journal capture. Read-only, zero arbitrary command/path/environment/service input, and preserves the V18 sandbox properties.',
      inputSchema:{suite:z.literal('v18_contract')},
      annotations:RO
    },
    async()=>textResult(runV18ContractV2())
  );
}
