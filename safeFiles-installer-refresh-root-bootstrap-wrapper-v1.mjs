import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const BASE_SHA='3db499a8bc020403626a6c8a133237a5f086e7c936d6cd7ccdbadd74dd894155';
const SELFMAINT_BACKUP_ROOT='/var/backups/prhm-agent-selfmaint';
const HERE=path.dirname(new URL(import.meta.url).pathname);
const BASE_FILE=path.join(HERE,'.safeFiles-installer-refresh-root-bootstrap-base-'+BASE_SHA+'.mjs');
const REQUEST_TOOL='control_plane_installer_refresh_l4_binding_repair_request_v1';
const APPLY_TOOL='control_plane_installer_refresh_l4_binding_repair_apply_v1';
const CONFIRM='CONFIRM_LEVEL_4_CRITICAL';
const STATE_PARENT='/var/lib/prhm-agent-selfmaint-exec';
const STATE_ROOT=STATE_PARENT+'/installer-refresh-l4-binding-repair-v1';
const BACKUP_PARENT='/var/backups';
const REPAIR_BACKUP_ROOT=BACKUP_PARENT+'/prhm-installer-refresh-l4-binding-repair-v1';
const sha=b=>createHash('sha256').update(b).digest('hex');

function ensureBase(){
  try{if(sha(fs.readFileSync(BASE_FILE))===BASE_SHA)return;}catch{}
  const names=fs.readdirSync(SELFMAINT_BACKUP_ROOT)
    .filter(n=>n.startsWith('agent_mcp-src_plugins_safeFiles.js-')&&n.endsWith('-'+BASE_SHA+'.bak'))
    .sort().reverse();
  if(!names.length)throw new Error('installer_refresh_root_bootstrap_base_backup_missing');
  const bytes=fs.readFileSync(path.join(SELFMAINT_BACKUP_ROOT,names[0]));
  if(sha(bytes)!==BASE_SHA)throw new Error('installer_refresh_root_bootstrap_base_sha_mismatch');
  const tmp=BASE_FILE+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,BASE_FILE);
  fs.chmodSync(BASE_FILE,0o600);
}

function ensureFixedRoots(apply){
  const parents=apply?[STATE_PARENT,BACKUP_PARENT]:[STATE_PARENT];
  const dirs=apply?[STATE_ROOT,REPAIR_BACKUP_ROOT]:[STATE_ROOT];
  const unit='prhm-installer-refresh-root-bootstrap-'+Date.now()+'-'+process.pid;
  const args=[
    '--wait','--quiet','--collect','--unit='+unit,
    '--property=Type=oneshot','--property=UMask=0077',
    '--property=NoNewPrivileges=yes','--property=PrivateTmp=yes','--property=PrivateDevices=yes',
    '--property=ProtectSystem=strict','--property=ProtectHome=read-only',
    '--property=RestrictAddressFamilies=AF_UNIX',
    ...parents.map(p=>'--property=ReadWritePaths='+p),
    '/usr/bin/mkdir','-p',...dirs
  ];
  const r=spawnSync('/usr/bin/systemd-run',args,{
    encoding:'utf8',timeout:30000,maxBuffer:120000,
    env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C'}
  });
  if(r.error||r.status!==0)throw new Error('installer_refresh_root_bootstrap_failed:'+String(r.stderr||r.stdout||'').slice(-2000));
}

ensureBase();
const base=await import(pathToFileURL(BASE_FILE).href+'?installer-refresh-root-bootstrap='+BASE_SHA);
if(typeof base.registerSafeFilesPlugin!=='function')throw new Error('installer_refresh_root_bootstrap_base_export_missing');

export function registerSafeFilesPlugin(mcp,context){
  let requestConfig=null,requestHandler=null,applyConfig=null,applyHandler=null;
  const proxy=new Proxy(mcp,{get(target,prop){
    if(prop==='registerTool')return(name,config,handler)=>{
      if(name===REQUEST_TOOL){requestConfig=config;requestHandler=handler;return;}
      if(name===APPLY_TOOL){applyConfig=config;applyHandler=handler;return;}
      return target.registerTool.call(target,name,config,handler);
    };
    const value=Reflect.get(target,prop,target);
    return typeof value==='function'?value.bind(target):value;
  }});
  base.registerSafeFilesPlugin(proxy,context);
  if(!requestConfig||typeof requestHandler!=='function'||!applyConfig||typeof applyHandler!=='function')
    throw new Error('installer_refresh_root_bootstrap_surface_missing');
  mcp.registerTool(REQUEST_TOOL,{...requestConfig,title:'Request Installer Refresh L4 Binding Repair / Root Bootstrap'},async args=>{
    ensureFixedRoots(false);
    return requestHandler(args);
  });
  mcp.registerTool(APPLY_TOOL,{...applyConfig,title:'Apply Installer Refresh L4 Binding Repair / Root Bootstrap'},async args=>{
    if(args?.second_confirmation!==CONFIRM)throw new Error('critical_second_confirmation_required');
    ensureFixedRoots(true);
    return applyHandler(args);
  });
}
