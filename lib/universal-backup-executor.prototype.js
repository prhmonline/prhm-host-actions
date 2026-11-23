'use strict';
/** File-only backup executor; run only under a restricted service account.
 * Requires a validated plan from universal-backup-policy.js.
 * No shell, SQL, restore, delete API or user-provided destination.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {openConfinedRegularFile}=require('./agent3-confined-open');

function sha(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
async function streamedHash(file) {
  const digest=crypto.createHash('sha256');
  let bytes=0;
  for await (const chunk of fs.createReadStream(file,{highWaterMark:1024*1024})) {
    bytes+=chunk.length;
    if(bytes>2*1024*1024*1024+1024*1024)throw new Error('archive_size_limit');
    digest.update(chunk);
  }
  return digest.digest('hex');
}
function runTar(args) {
  return new Promise((resolve,reject) => {
    const p = spawn('/usr/bin/tar', args, {shell:false,stdio:['ignore','pipe','pipe']});
    const deadline=setTimeout(()=>p.kill('SIGKILL'),180000);
    let stdout = '', stderr = '';
    p.stdout.on('data', b => { stdout += b; if(stdout.length > 200000) p.kill(); });
    p.stderr.on('data', b => { stderr += b; if(stderr.length > 20000) p.kill(); });
    p.on('error',reject);
    p.on('close',code => {clearTimeout(deadline);code === 0 ? resolve(stdout) : reject(new Error('tar_failed: '+code));});
  });
}
async function executeFileBackup(plan) {
  if (!plan || plan.status !== 'planned_not_executed' || plan.type !== 'files' ||
      !Array.isArray(plan.files) || plan.files.length===0 || plan.files.length>1000 || !/^[a-f0-9]{64}$/.test(plan.job_id)) throw new Error('invalid_plan');
  if (new Set(plan.files).size !== plan.files.length) throw new Error('duplicate_file');
  const destination = await fsp.realpath(plan.destination_root);
  const root = await fsp.realpath(plan.source_root);
  if (destination === root || destination.startsWith(root+path.sep) || root.startsWith(destination+path.sep)) throw new Error('overlapping_roots');
  // Prevent two workers from publishing the same job concurrently. A stale
  // crash lock deliberately fails closed until reviewed; never steal it.
  const lockPath=path.join(destination,'.'+plan.job_id+'.lock');
  const lockHandle=await fsp.open(lockPath,'wx',0o600);
  let stage;
  try {
    stage=await fsp.mkdtemp(path.join(destination,'.backup-stage-'));
    const payload=path.join(stage,'payload');
    const archiveTmp=path.join(stage,'archive.tar.gz');
    const final=path.join(destination,plan.job_id+'.tar.gz');
    const manifestFinal=path.join(destination,plan.job_id+'.manifest.json');
    await fsp.mkdir(payload,{mode:0o700});
    const manifest = [];
    let totalBytes=0;
    for (const relative of plan.files) {
      if (typeof relative !== 'string' || relative.includes('\\\\') || relative.includes('\\0') || relative.startsWith('/') || relative.split('/').some(p => !p || p==='.' || p==='..')) throw new Error('invalid_file');
      // Descend from the pinned source root using directory descriptors, never
      // lstat(path) followed by a separate pathname open.
      const handle = await openConfinedRegularFile(root,relative);
      try {
        const st=await handle.stat();
        if(!st.isFile()||st.size<0||st.size>512*1024*1024)throw new Error('invalid_source_file');
        totalBytes+=st.size;
        if(totalBytes>2*1024*1024*1024)throw new Error('job_size_limit');
        const target=path.join(payload,relative);
        await fsp.mkdir(path.dirname(target),{recursive:true,mode:0o700});
        const hash=crypto.createHash('sha256');
        let copied=0;
        const meter=new Transform({transform(chunk,encoding,callback){
          copied+=chunk.length;
          if(copied>st.size)return callback(new Error('source_changed'));
          hash.update(chunk);
          callback(null,chunk);
        }});
        await pipeline(handle.createReadStream({autoClose:false}),
                       meter,fs.createWriteStream(target,{flags:'wx',mode:0o600}));
        const after=await handle.stat();
        if(copied!==st.size||after.size!==st.size||after.ino!==st.ino||
           after.dev!==st.dev||after.mtimeMs!==st.mtimeMs||after.ctimeMs!==st.ctimeMs)
          throw new Error('source_changed');
        manifest.push({path:relative,bytes:copied,sha256:hash.digest('hex')});
      } finally { await handle.close(); }
    }
    await runTar(['-czf',archiveTmp,'-C',payload,'.']);
    const entries = (await runTar(['-tzf',archiveTmp])).split('\n').filter(Boolean);
    const files = entries.filter(x => !x.endsWith('/')).map(x => x.replace(/^\.\//,'')).sort();
    if (JSON.stringify(files)!==JSON.stringify([...plan.files].sort())) throw new Error('archive_members_mismatch');
    const archiveHash=await streamedHash(archiveTmp);
    const evidence={job_id:plan.job_id,project_id:plan.project_id,profile_id:plan.profile_id,
      file_count:manifest.length,files:manifest,archive_sha256:archiveHash,
      archive_readback_ok:true,created_at:new Date().toISOString()};
    const manifestBytes=Buffer.from(JSON.stringify(evidence,null,2)+'\n');
    const manifestHash=sha(manifestBytes);
    // Exclusive writes prevent overwriting existing backups. No production source writes.
    await fsp.copyFile(archiveTmp,final,fs.constants.COPYFILE_EXCL);
    try {
      const archiveHandle=await fsp.open(final,'r');
      try {await archiveHandle.sync();} finally {await archiveHandle.close();}
      const manifestHandle=await fsp.open(manifestFinal,'wx',0o600);
      try {await manifestHandle.writeFile(manifestBytes);await manifestHandle.sync();}
      finally {await manifestHandle.close();}
      const directoryHandle=await fsp.open(destination,'r');
      try {await directoryHandle.sync();} finally {await directoryHandle.close();}
    } catch(e) {
      await Promise.allSettled([fsp.unlink(final),fsp.unlink(manifestFinal)]);
      throw e;
    }
    const commitMarker=path.join(destination,plan.job_id+'.complete');
    const markerHandle=await fsp.open(commitMarker,'wx',0o600);
    try {await markerHandle.writeFile(manifestHash+'\n');await markerHandle.sync();}
    finally {await markerHandle.close();}
    const committedDir=await fsp.open(destination,'r');
    try {await committedDir.sync();} finally {await committedDir.close();}
    return {job_id:plan.job_id,archive_path:final,manifest_path:manifestFinal,commit_marker_path:commitMarker,
      archive_sha256:archiveHash,manifest_sha256:manifestHash,file_count:manifest.length,
      archive_readback_ok:true,manifest_verified:true,atomic_commit_ok:false,
      note:'Prototype only: fsync added; still no atomic two-file transaction, encryption, DB support or production authorization'};
  } finally {
    try {if(stage)await fsp.rm(stage,{recursive:true,force:true});}
    finally {await lockHandle.close();await fsp.unlink(lockPath);}
  }
}
module.exports={executeFileBackup};
