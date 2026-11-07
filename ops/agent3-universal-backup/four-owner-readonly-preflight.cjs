'use strict';
/**
 * Fixed read-only PREINSTALL evidence collector for the four exact Agent 3
 * control-plane owners. Never emits source bytes, keys, env, approval tokens
 * or any arbitrary command result; never writes to production.
 *
 * --check runs only on a separately authorized host. There is NO --apply.
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const path = require('node:path');
const OWNERS = Object.freeze({
  base:'/opt/prhm-agent-selfmaint/server.js',
  executor:'/opt/prhm-agent-selfmaint-exec/server.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'
});
const SERVICES = Object.freeze([
  'prhm-agent-selfmaint.service',
  'prhm-agent-selfmaint-exec.service',
  'prhm-agent-mcp-blue.service',
  'prhm-agent-mcp-green.service'
]);
const ACTION = 'prhm_action_registry_install_v1';
const INSTALL = 'agent3_universal_backup_engine_install_v1';
function deny(reason){throw Error('agent3_owner_preflight_denied:'+reason);}
function readHashStrict(filename,{stat=fs.lstatSync,realpath=fs.realpathSync,open=fs.openSync,read=fs.readSync,fstat=fs.fstatSync,close=fs.closeSync}={}){
  const before=stat(filename);
  if(!before.isFile()||before.isSymbolicLink()||before.size<1||before.size>20*1024*1024||
      (before.mode&0o022)!==0||realpath(filename)!==filename)
    deny('unsafe_owner_file');
  const fd=open(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {
    const pinned=fstat(fd);
    if(pinned.ino!==before.ino||pinned.dev!==before.dev||pinned.uid!==before.uid||
       pinned.gid!==before.gid||pinned.size!==before.size||(pinned.mode&0o777)!==(before.mode&0o777))
      deny('owner_read_race');
    let offset=0,hash=crypto.createHash('sha256');
    const buf=Buffer.allocUnsafe(64*1024);
    while(offset<pinned.size){
      const n=read(fd,buf,0,Math.min(buf.length,pinned.size-offset),offset);
      if(!Number.isInteger(n)||n<=0)deny('owner_changed_during_read');
      hash.update(buf.subarray(0,n));offset+=n;
    }
    const after=fstat(fd);
    if(after.ino!==pinned.ino||after.dev!==pinned.dev||after.size!==pinned.size||
       after.mtimeMs!==pinned.mtimeMs||after.ctimeMs!==pinned.ctimeMs)
      deny('owner_changed_during_read');
    return Object.freeze({
      path:filename,sha256:hash.digest('hex'),size:offset,
      uid:after.uid,gid:after.gid,mode:(after.mode&0o777).toString(8).padStart(4,'0')
    });
  }finally{close(fd);}
}
function readService(unit,execute=(bin,args)=>cp.execFileSync(bin,args,{encoding:'utf8',timeout:8000,maxBuffer:4096})){
  if(!SERVICES.includes(unit))deny('service_not_allowlisted');
  const output=execute('/usr/bin/systemctl',['show',unit,'--property=LoadState,ActiveState,SubState','--no-pager']);
  const fields=Object.fromEntries(String(output).trim().split('\n').map(s=>s.trim().split('=')));
  if(!['loaded'].includes(fields.LoadState)||fields.ActiveState!=='active'||fields.SubState!=='running')
    deny('service_not_healthy:'+unit);
  return Object.freeze({unit,loaded:true,active:true,running:true});
}
function collect({reader=readHashStrict,serviceReader=readService}={}){
  const owners={};
  for(const [name,file] of Object.entries(OWNERS)){
    const evidence=reader(file);
    if(!evidence||evidence.path!==file||!/^[a-f0-9]{64}$/.test(evidence.sha256||'')||
      !Number.isSafeInteger(evidence.size)||evidence.size<=0)deny('incomplete_owner_evidence:'+name);
    owners[name]=evidence;
  }
  const services=SERVICES.map(name=>{
    const evidence=serviceReader(name);
    if(!evidence||evidence.unit!==name||evidence.active!==true||evidence.running!==true||
       evidence.loaded!==true)deny('unhealthy:'+name);
    return evidence;
  });
  const hashes=Object.fromEntries(Object.entries(owners).map(([k,v])=>[k,v.sha256]));
  if(new Set(Object.values(hashes)).size!==4)deny('duplicate_owner_hash');
  return Object.freeze({
    schema:'prhm.agent3.registry-owner-evidence.v1',mode:'READ_ONLY_PREFLIGHT',
    generated_at:new Date().toISOString(),owner_count:4,service_count:4,
    owners,services,hashes,
    shared_registration_action:ACTION,target_install_action:INSTALL,
    trusted_source:'local owner file descriptors and fixed systemd show',
    cryptographically_signed:false,production_mutation:false,
    enrollment_authorized:false,installation_complete:false
  });
}
if(require.main===module){
  if(process.argv.length!==3||process.argv[2]!=='--check'){
    process.stderr.write('read-only --check only; no apply, stage or authorization mode\n');
    process.exitCode=64;
  }else{
    try{process.stdout.write(JSON.stringify(collect())+'\n');}
    catch(e){process.stderr.write(String(e.message)+'\n');process.exitCode=78;}
  }
}
module.exports=Object.freeze({OWNERS,SERVICES,ACTION,INSTALL,readHashStrict,readService,collect});
