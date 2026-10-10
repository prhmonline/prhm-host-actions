'use strict';
// Fixed, strictly read-only preflight for future PRHM central encrypted restic->Node1 SFTP backup.
// This script cannot initialize a repository, upload, create users, change SSHD, or deploy.
const fs=require('node:fs');
const cp=require('node:child_process');
const path=require('node:path');
const C=Object.freeze({
 snapshotState:'/var/lib/prhm-central-gdrive-bundle/latest.json',
 source:'/var/backups/prhm-central',
 restic:'/var/lib/prhm-central-gdrive-restic/restic-0.19.1',
 node1Host:'185.191.76.138',
 backupUser:'prhmbackup',
 remoteJail:'/srv/prhm-sftp',
 remoteRepo:'/srv/prhm-sftp/repo/central-production',
 sshConfig:'/etc/prhm-backup/node1/ssh_config',
 knownHosts:'/etc/prhm-backup/node1/known_hosts',
 privateKey:'/etc/prhm-backup/node1/id_ed25519',
 password:'/etc/prhm-backup/node1/restic.password',
 minFreeBytes:8*1024*1024*1024
});
function run(command,args,timeout=8000){
 const p=cp.spawnSync(command,args,{encoding:'utf8',timeout,maxBuffer:30000});
 return {ok:p.status===0&&!p.error,stdout:String(p.stdout||''),exit:p.status,error:p.error?.code||null};
}
function safeFile(f,mode){
 try{
  const st=fs.lstatSync(f);
  return st.isFile()&&!st.isSymbolicLink()&&st.uid===0&&st.gid===0&&(st.mode&0o777)===mode&&st.size>0;
 }catch{return false}
}
function inspect(read=fs.readFileSync,exists=fs.existsSync,probe=run){
 const result={schema:'prhm.node1-central-backup-preflight.v1',
  target:'server1.prhm.ir',transport:'sftp',repository:'sftp:prhm-node1-backup:/repo/central-production',
  cloud_subscription_required:false,remote_mutation:false,production_mutation:false,
  checks:{},warnings:[]};
 let state;
 try{state=JSON.parse(read(C.snapshotState,'utf8'))}catch{state=null}
 result.checks.source_state=Boolean(state?.status==='pass'&&/^20\d{6}T\d{6}Z$/.test(state.snapshot||''));
 const snapshot=result.checks.source_state?state.snapshot:null;
 result.snapshot=snapshot;
 result.checks.local_snapshot_complete=Boolean(snapshot&&exists(path.join(C.source,snapshot,'COMPLETE'))&&exists(path.join(C.source,snapshot,'SHA256SUMS')));
 result.checks.restic_executable=Boolean(exists(C.restic));
 result.checks.sftp_ssh_config=safeFile(C.sshConfig,0o600);
 result.checks.sftp_known_hosts=safeFile(C.knownHosts,0o600);
 result.checks.sftp_key=safeFile(C.privateKey,0o600);
 result.checks.restic_password=safeFile(C.password,0o600);
 const sshBase=['-o','BatchMode=yes','-o','ConnectTimeout=6','-o','StrictHostKeyChecking=yes','root@'+C.node1Host];
 const ssh=probe('/usr/bin/ssh',[...sshBase,'getent passwd '+C.backupUser+' >/dev/null && stat -c %a '+C.remoteRepo],12000);
 result.checks.node1_restricted_account=Boolean(ssh.ok&&/^700\s*$/m.test(ssh.stdout));
 const disk=probe('/usr/bin/ssh',[...sshBase,'df -B1 / | tail -1'],12000);
 result.checks.node1_capacity=Boolean(disk.ok&&disk.stdout.trim().split('\n').some(line=>{
  const parts=line.trim().split(/\s+/);return parts.length>=4&&Number(parts[3])>=C.minFreeBytes;
 }));
 const missing=Object.entries(result.checks).filter(([,v])=>!v).map(([k])=>k);
 result.status=missing.length?'BLOCKED_PROVISIONING':'READY_FOR_SEPARATE_LEVEL4_DEPLOY';
 result.blockers=missing;
 if(result.checks.local_snapshot_complete){
  try{
   const files=fs.readdirSync(path.join(C.source,snapshot,'files'));
   result.warnings=files.filter(f=>f.endsWith('.SKIPPED.txt')).map(f=>'snapshot_file_scope_skipped:'+f);
  }catch{}
 }
 return result;
}
if(require.main===module){
 if(process.argv.length!==3||process.argv[2]!=='--preflight'){
  process.stderr.write('READ_ONLY_PREFLIGHT_ONLY\n');process.exitCode=2;
 }else{
  const r=inspect();process.stdout.write(JSON.stringify(r,null,2)+'\n');
  if(r.status==='BLOCKED_PROVISIONING')process.exitCode=3;
 }
}
module.exports={C,inspect,safeFile,run};
