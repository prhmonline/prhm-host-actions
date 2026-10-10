'use strict';
// Development candidate only. SHA-bound installation and Level-4 approval required.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const C = Object.freeze({
  host: 'server1.prhm.ir',
  backupRoot: '/var/lib/prhm-backup/node1',
  config: '/etc/prhm-backup/node1.conf',
  rcloneProof: '/etc/prhm-backup/node1-dedicated-rclone-client.ok',
  mariadbConfig: '/etc/prhm-backup/node1-mariadb.cnf',
  repo: 'rclone:gdrive-backup:PRHM-Backups/node1',
  volumes: ['/etc', '/home', '/usr/local/directadmin'],
  requiredTools: ['/usr/bin/restic', '/usr/bin/rclone', '/usr/bin/mariadb-dump', '/usr/bin/virsh']
});
function fail(code){throw new Error(code)}
function regularPrivate(file, max=16384) {
  try {
    const s=fs.lstatSync(file);
    return s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o077)===0&&s.size>0&&s.size<=max&&s.uid===0;
  } catch {return false;}
}
function exec(bin,args,opts={}){
  const r=cp.spawnSync(bin,args,{timeout:opts.timeout||30000,encoding:'utf8',maxBuffer:opts.maxBuffer||131072,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/root'},...opts});
  if(r.error||r.status!==0)fail('command_failed:'+path.basename(bin));
  return String(r.stdout||'');
}
function parseRunningVMs(out){
  return String(out).split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>0);
}
function decideReadiness(info){
  const reasons=[];
  for(const x of C.requiredTools)if(!info.tools[x])reasons.push('missing_tool:'+path.basename(x));
  for(const x of C.volumes)if(!info.paths[x])reasons.push('missing_scope:'+x);
  if(!info.privateConfig)reasons.push('private_config_missing_or_insecure');
  if(!info.privateMariadbConfig)reasons.push('mariadb_auth_missing_or_insecure');
  if(!info.dedicatedClientVerified)reasons.push('dedicated_rclone_client_unverified');
  if(!info.repoExact)reasons.push('restic_repo_mismatch');
  if(!info.encryptionKeyVerified)reasons.push('restic_password_file_missing_or_insecure');
  if(!info.capacityBytes||info.capacityBytes<8*1024**3)reasons.push('insufficient_local_scratch_capacity');
  if(!info.vmInventoryVerified)reasons.push('vm_inventory_unverified');
  if(info.runningVMs.length>0)reasons.push('live_vm_snapshot_pipeline_not_implemented');
  if(!info.isolatedSqlRestoreReady)reasons.push('isolated_database_replay_not_implemented');
  return Object.freeze({ok:reasons.length===0, reasons, fail_closed:true, mutation:false});
}
function inspect(){
  const tools=Object.fromEntries(C.requiredTools.map(f=>[f,fs.existsSync(f)]));
  const paths=Object.fromEntries(C.volumes.map(f=>[f,fs.existsSync(f)]));
  const privateConfig=regularPrivate(C.config),privateMariadbConfig=regularPrivate(C.mariadbConfig);
  const dedicatedClientVerified=regularPrivate(C.rcloneProof,2048);
  let repoExact=false,encryptionKeyVerified=false;
  if(privateConfig){
    // Fixed-format config: key=value, rejects unknown keys and shell substitution.
    const lines=fs.readFileSync(C.config,'utf8').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const fields={};let valid=true;
    for(const line of lines){const m=line.match(/^(RESTIC_REPOSITORY|RESTIC_PASSWORD_FILE)=([A-Za-z0-9_@.\/:=-]+)$/);if(!m||fields[m[1]]){valid=false;break}fields[m[1]]=m[2]}
    repoExact=valid&&fields.RESTIC_REPOSITORY===C.repo;
    encryptionKeyVerified=valid&&typeof fields.RESTIC_PASSWORD_FILE==='string'&&fields.RESTIC_PASSWORD_FILE.startsWith('/etc/prhm-backup/')&&regularPrivate(fields.RESTIC_PASSWORD_FILE,4096);
  }
  let vmInventoryVerified=false,runningVMs=[];
  if(tools['/usr/bin/virsh']){
    try{runningVMs=parseRunningVMs(exec('/usr/bin/virsh',['list','--state-running','--name']));vmInventoryVerified=true}catch{}
  }
  let capacityBytes=0;
  try{const s=fs.statfsSync('/var/lib');capacityBytes=Number(s.bavail)*Number(s.bsize)}catch{}
  const state={tools,paths,privateConfig,privateMariadbConfig,dedicatedClientVerified,repoExact,encryptionKeyVerified,vmInventoryVerified,runningVMs,capacityBytes,isolatedSqlRestoreReady:false};
  return Object.freeze({schema_version:'prhm.node1-backup-readiness.v1',host:C.host,read_only:true,mode:'preflight',...decideReadiness(state),running_vm_count:runningVMs.length,capacity_gib:Math.floor(capacityBytes/1024**3)});
}
function main(args=process.argv.slice(2)){
  if(args.length!==1||args[0]!=='--preflight')fail('only_readonly_preflight_supported');
  return inspect();
}
if(require.main===module){try{const out=main();process.stdout.write(JSON.stringify(out)+'\n');if(!out.ok)process.exitCode=2}catch(e){process.stderr.write(String(e.message||e)+'\n');process.exitCode=2}}
module.exports={C,regularPrivate,parseRunningVMs,decideReadiness,main};
