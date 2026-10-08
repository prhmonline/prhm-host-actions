'use strict';
// Inert until explicitly constructed by reviewed SHA-bound, Level-4 Host Action.
// An in-process approval object is never proof of server-side authorization.
// Concrete host backend for existing node1-host-adapter-v1 fixed specs.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto');
const gate=require('./node1-host-adapter-v1'),offsite=require('./node1-db-offsite-v1');
const STAGE='/var/lib/prhm-backup/node1/staging';
const RESTIC='/usr/bin/restic',VIRSH='/usr/bin/virsh',DUMP='/usr/bin/mariadb-dump';
function requireTrue(b,e){if(!b)throw Error(e)}
function regularRootSecret(p){
 try{const s=fs.lstatSync(p);return s.isFile()&&!s.isSymbolicLink()&&s.uid===0&&(s.mode&0o077)===0&&s.size>0&&s.size<65536}catch{return false}
}
function assertStage(runId,file){
 const run=gate.validRun(runId),root=path.posix.join(STAGE,run);
 requireTrue(typeof file==='string'&&file.startsWith(root+'/')&&path.posix.normalize(file)===file,'stage_path_rejected');
 requireTrue(!file.split('/').includes('..'),'stage_traversal');
 return file;
}
function assertSecureExistingDir(dir){
 // Every existing path below STAGE must be root-owned, no symlink, no group/other write.
 let p=STAGE;const st=fs.lstatSync(p);
 requireTrue(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0&&(st.mode&0o022)===0,'stage_root_insecure');
 for(const part of dir.slice(STAGE.length).split('/').filter(Boolean)){
   p=path.posix.join(p,part);
   if(!fs.existsSync(p)){fs.mkdirSync(p,{mode:0o700});}
   const s=fs.lstatSync(p);
   requireTrue(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===0&&(s.mode&0o022)===0,'stage_child_insecure');
 }
}
function ensureExclusive(runId,target){
 assertStage(runId,target);
 assertSecureExistingDir(path.posix.dirname(target));
 return fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
}
function subprocess(spec,options={}){
 const time=spec.bin===RESTIC?12*60*60*1000:spec.bin===DUMP?60*60*1000:spec.args[0]==='backup-begin'?120000:30000;
 const result=cp.spawnSync(spec.bin,spec.args,{encoding:'utf8',timeout:time,maxBuffer:16*1024*1024,stdio:options.stdio||['ignore','pipe','pipe'],env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/root'}});
 requireTrue(!result.error&&result.status===0,'fixed_command_failed:'+path.basename(spec.bin)+':'+String(spec.args[0]).replace(/[^a-z-]/g,''));
 return String(result.stdout||'');
}
function artifactHash(file){
 const stat=fs.lstatSync(file);
 requireTrue(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0,'artifact_not_regular');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 const h=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(4*1024*1024);
 try {let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0)h.update(buffer.subarray(0,n))}
 finally{fs.closeSync(fd)}
 return {regular:true,symlink:false,bytes:stat.size,mode:stat.mode&0o777,sha256:h.digest('hex')};
}
function createBackend(runId){
 gate.validRun(runId);
 // The caller must pass only fixed command specifications produced by node1-host-adapter.
 // This module has no CLI and does not start any service on import.
 return Object.freeze({
  invoke(spec){
   requireTrue(spec&&Array.isArray(spec.args),'spec_missing');
   let trusted;
   if(spec.bin===VIRSH)trusted=gate.virshSpec(spec.args,runId);
   else if(spec.bin===RESTIC)trusted=gate.resticSpec(spec.bin,spec.args,runId,offsite.sqlDumpPlan(runId).file);
   else throw Error('binary_not_allowlisted');
   requireTrue(trusted.mutating===spec.mutating,'spec_tampering');
   return subprocess(trusted);
  },
  createOutput({dir,xml,body,exclusive,mode,symlinks}){
   requireTrue(exclusive===true&&mode===0o600&&symlinks===false,'unsafe_xml_flags');
   const candidate=Object.values(require('./node1-live-vm-backup-v1').DOMAINS).map(_=>null);
   const valid=Object.keys(require('./node1-live-vm-backup-v1').DOMAINS).some(domain=>{
     const p=gate.planOf(domain,runId);
     return p.xml===xml&&path.posix.dirname(p.xml)===dir&&body===require('./node1-live-vm-backup-v1').makePlan(domain,runId,'file disk vda '+require('./node1-live-vm-backup-v1').DOMAINS[domain].source+'\n').body;
   });
   requireTrue(valid,'xml_invalid');
   const fd=ensureExclusive(runId,xml);
   try{fs.writeSync(fd,body);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
   return true;
  },
  artifact(file){
   assertStage(runId,file);
   const known=Object.keys(require('./node1-live-vm-backup-v1').DOMAINS).map(x=>gate.planOf(x,runId).artifact).concat([offsite.sqlDumpPlan(runId).file]);
   requireTrue(known.includes(file),'artifact_not_allowlisted');
   return artifactHash(file);
  },
  exportToFile(spec){
   const v=gate.dumpSpec(spec.bin,spec.args,runId,spec.target,{owner:'root',mode:spec.mode,noShell:true,createExclusive:true});
   const fd=ensureExclusive(runId,v.target);let ok=false;
   try{ const out=cp.spawnSync(DUMP,v.args,{timeout:60*60*1000,stdio:['ignore',fd,'pipe'],env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/root'}});
      requireTrue(!out.error&&out.status===0,'mariadb_dump_failed'); fs.fsyncSync(fd);ok=true;
   } finally{fs.closeSync(fd);if(!ok){try{fs.unlinkSync(v.target)}catch{}}}
   return true;
  },
  secretFileValid(file){return file===offsite.CONF.password&&regularRootSecret(file)},
  remoteIdentityVerified(){return false}, // Must be established by independent, authorized rclone remote verifier.
  runtimePreflight(plan){
    requireTrue(plan?.runId===runId&&Object.keys(require('./node1-live-vm-backup-v1').DOMAINS).includes(plan.domain),'preflight_plan_invalid');
    // Fail closed until verified QEMU runtime UID, SELinux writable context,
    // guest-agent readiness and libvirt version/feature support have signed evidence.
    return {libvirt_backup_api_supported:false,guest_agent_responsive:false,qemu_output_writable:false,selinux_context_verified:false,stage_path_exclusive:false};
  }
 });
}
module.exports={STAGE,assertStage,regularRootSecret,artifactHash,createBackend};
