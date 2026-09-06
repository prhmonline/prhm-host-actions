import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const TARGET='/home/agent/ssh-mcp-server/src/plugins/safeFiles.js';
const EXPECTED='08e992a988380d99d3d4964d43eef361b155729b4bbd40a51a6113e00257d1f2';
const sha=b=>createHash('sha256').update(b).digest('hex');

const OLD=String.raw`function runZdtContract(){
  assertZdtWorktree();
  const testFile=fixedZdtFile(ZDT_TEST);
  if(!fs.existsSync(testFile))throw new Error('zdt_v19_test_missing');
  const args=[
    '--wait','--collect','--quiet',
    '--property=NoNewPrivileges=yes',
    '--property=PrivateTmp=yes',
    '--property=PrivateDevices=yes',
    '--property=ProtectSystem=strict',
    '--property=ProtectHome=read-only',
    '--property=RestrictAddressFamilies=AF_UNIX',
    '--property=WorkingDirectory='+ZDT_WORKTREE,
    '/usr/local/bin/prhm-node','--test',ZDT_TEST
  ];
  const r=spawnSync('/usr/bin/systemd-run',args,{
    encoding:'utf8',timeout:120000,maxBuffer:400000,
    env:{PATH:'/usr/local/bin:/usr/bin:/bin',LC_ALL:'C'}
  });
  return {
    ok:r.status===0,
    suite:'agent_zdt_v19_contract',
    state:r.status===0?'GREEN':'RED',
    exit_code:Number.isInteger(r.status)?r.status:null,
    stdout:String(r.stdout||'').slice(0,180000),
    stderr:String(r.stderr||'').slice(0,40000),
    sandbox:{no_new_privileges:true,private_tmp:true,private_devices:true,protect_system:'strict',protect_home:'read-only',restrict_address_families:'AF_UNIX'},
    production_mutation:false
  };
}`;

const NEW=String.raw`function runZdtContract(){
  assertZdtWorktree();
  const testFile=fixedZdtFile(ZDT_TEST);
  if(!fs.existsSync(testFile))throw new Error('zdt_v19_test_missing');
  const unit='prhm-agent-zdt-v19-contract-'+process.pid+'-'+Date.now();
  const serviceUnit=unit+'.service';
  const env={PATH:'/usr/local/bin:/usr/bin:/bin',LC_ALL:'C'};
  const startArgs=[
    '--unit='+unit,'--quiet',
    '--property=Type=oneshot',
    '--property=RemainAfterExit=yes',
    '--property=TimeoutStartSec=120',
    '--property=StandardOutput=journal',
    '--property=StandardError=journal',
    '--property=NoNewPrivileges=yes',
    '--property=PrivateTmp=yes',
    '--property=PrivateDevices=yes',
    '--property=ProtectSystem=strict',
    '--property=ProtectHome=read-only',
    '--property=RestrictAddressFamilies=AF_UNIX',
    '--property=WorkingDirectory='+ZDT_WORKTREE,
    '/usr/local/bin/prhm-node','--test',ZDT_TEST
  ];
  const started=spawnSync('/usr/bin/systemd-run',startArgs,{encoding:'utf8',timeout:15000,maxBuffer:120000,env});
  let activeState='';
  let subState='';
  let result='';
  let execMainStatus=null;
  let showError='';
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
    suite:'agent_zdt_v19_contract',
    state:ok?'GREEN':'RED',
    exit_code:Number.isInteger(exitCode)?exitCode:null,
    stdout:String(journal.stdout||'').slice(0,180000),
    stderr:[String(started.stderr||''),showError,String(journal.stderr||'')].filter(Boolean).join('\n').slice(0,40000),
    sandbox:{no_new_privileges:true,private_tmp:true,private_devices:true,protect_system:'strict',protect_home:'read-only',restrict_address_families:'AF_UNIX'},
    transport:{mode:'named_transient_unit_journal',unit:serviceUnit,active_state:activeState,sub_state:subState,result},
    production_mutation:false
  };
}`;

const before=fs.readFileSync(TARGET);
if(sha(before)!==EXPECTED)throw new Error('zdt_v27_preimage_sha_mismatch');
const source=before.toString('utf8');
if(source.split(OLD).length-1!==1)throw new Error('zdt_v27_transport_anchor_mismatch');
const next=source.replace(OLD,NEW);
for(const token of ['NoNewPrivileges=yes','PrivateTmp=yes','PrivateDevices=yes','ProtectSystem=strict','ProtectHome=read-only','RestrictAddressFamilies=AF_UNIX','WorkingDirectory=']){
  if(!next.includes(token))throw new Error('zdt_v27_sandbox_property_missing:'+token);
}
const candidate=Buffer.from(next,'utf8');
const tmp=TARGET+'.zdt-v27-'+process.pid+'.tmp';
const backup=TARGET+'.pre-zdt-v27-'+EXPECTED+'.bak';
fs.copyFileSync(TARGET,backup,fs.constants.COPYFILE_EXCL);
let renamed=false;
try{
  fs.writeFileSync(tmp,candidate,{mode:0o644,flag:'wx'});
  fs.renameSync(tmp,TARGET);
  renamed=true;
  const checked=spawnSync('/usr/local/bin/prhm-node',['--check',TARGET],{encoding:'utf8',timeout:15000,maxBuffer:120000});
  if(checked.status!==0)throw new Error('zdt_v27_node_check_failed:'+String(checked.stderr||checked.stdout||''));
  const restarted=spawnSync('/usr/bin/systemctl',['restart','prhm-agent-mcp.service'],{encoding:'utf8',timeout:30000,maxBuffer:120000});
  if(restarted.status!==0)throw new Error('zdt_v27_restart_failed:'+String(restarted.stderr||restarted.stdout||''));
  const active=spawnSync('/usr/bin/systemctl',['is-active','prhm-agent-mcp.service'],{encoding:'utf8',timeout:10000,maxBuffer:40000});
  if(active.status!==0||String(active.stdout||'').trim()!=='active')throw new Error('zdt_v27_service_not_active');
  console.log(JSON.stringify({ok:true,target:TARGET,old_sha256:EXPECTED,new_sha256:sha(fs.readFileSync(TARGET)),backup,service:'active',sandbox_preserved:true}));
}catch(error){
  try{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}catch{}
  if(renamed){try{fs.copyFileSync(backup,TARGET);spawnSync('/usr/bin/systemctl',['restart','prhm-agent-mcp.service'],{timeout:30000});}catch{}}
  throw error;
}
