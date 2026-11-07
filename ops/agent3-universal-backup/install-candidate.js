'use strict';
/**
 * Fixed-file, SHA-pinned installer transaction CANDIDATE.
 * No CLI apply. Only the existing authenticated Level-4 control plane may call
 * installTransaction after signature, nonce, target, revision and replay checks.
 * This module cannot register its own Host Action or expand sudoers.
 */
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const SHA=/^[a-f0-9]{40}$/;
const H=/^[a-f0-9]{64}$/;
const ACTION='agent3_universal_backup_engine_install_v1';
const FILES=Object.freeze([
 'lib/agent3-confined-open.js',
 'lib/universal-backup-policy.js',
 'lib/agent3-encrypted-bundle.candidate.js',
 'lib/agent3-policy-broker.candidate.js'
]);
const BASE='/opt/prhm-agent3-universal-backup';
const TARGET_HOST='prhm-production';
const MAX_STAGE_FILE_BYTES=4*1024*1024;
const INSTALL_LOCK_NAME='.agent3-installer.lock';
function fail(x){throw Error('agent3_install_denied:'+x);}
function bytesHash(b){return crypto.createHash('sha256').update(b).digest('hex');}
function checkRel(x){if(!FILES.includes(x))fail('unexpected_path');}
async function requirePrivateDir(dir){
 const st=await fsp.lstat(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o022)!==0||
    (typeof process.getuid==='function'&&st.uid!==process.getuid())||
    await fsp.realpath(dir)!==dir)fail('unsafe_parent_directory');
 return st;
}
async function hashStage(stagedir,digests) {
 if(!digests||typeof digests!=='object'||Array.isArray(digests)||
    Object.keys(digests).sort().join('|')!==FILES.slice().sort().join('|'))
   fail('invalid_digests');
 await requirePrivateDir(stagedir);
 await requirePrivateDir(path.join(stagedir,'lib'));
 const files={};
 for(const rel of FILES) {
   checkRel(rel);
   if(!H.test(digests[rel]||''))fail('invalid_sha');
   const src=path.join(stagedir,rel);
   const before=await fsp.lstat(src);
   if(!before.isFile()||before.isSymbolicLink()||
      (before.mode&0o022)!==0||before.size<=0||
      before.size>MAX_STAGE_FILE_BYTES)fail('unsafe_stage_file');
   const handle=await fsp.open(src,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
   try{
     const opened=await handle.stat();
     if(!opened.isFile()||opened.ino!==before.ino||opened.dev!==before.dev||
        opened.uid!==before.uid||opened.size!==before.size||
        (opened.mode&0o777)!==(before.mode&0o777))
       fail('stage_file_read_race');
     const data=await handle.readFile();
     const after=await handle.stat();
     if(data.length!==opened.size||after.size!==opened.size||
        after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs)
       fail('stage_file_mutated_during_read');
     if(bytesHash(data)!==digests[rel])fail('sha_mismatch:'+rel);
     files[rel]=data;
   }finally{await handle.close();}
 }
 return files;
}
async function acquireInstallLock(root){
 await requirePrivateDir(root);
 const filename=path.join(root,INSTALL_LOCK_NAME);
 let handle;
 try{handle=await fsp.open(filename,'wx',0o600);}
 catch(e){if(e.code==='EEXIST')fail('concurrent_or_stale_install_lock');throw e;}
 return Object.freeze({filename,handle});
}
async function releaseInstallLock(lock){
 const st=await lock.handle.stat();
 await lock.handle.close();
 const current=await fsp.lstat(lock.filename);
 if(current.ino!==st.ino||current.dev!==st.dev||!current.isFile())
   fail('install_lock_replaced');
 await fsp.unlink(lock.filename);
 await fsyncDir(path.dirname(lock.filename));
}
function contract(expectedSha){
 if(!SHA.test(expectedSha||''))fail('invalid_source_sha');
 return {action:ACTION,approval_level:4,target_host:TARGET_HOST,source_sha:expectedSha,
   fixed_source_root:path.join(BASE,'staging',expectedSha),
   fixed_release_root:path.join(BASE,'releases',expectedSha),
   active_link:path.join(BASE,'current'),
   files:FILES,allow_shell:false,allow_email:false,allow_production_restore:false};
}
async function fsyncDir(d){
 const h=await fsp.open(d,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{await h.sync();}finally{await h.close();}
}
async function readPointer(active){
 try{
  const st=await fsp.lstat(active);
  if(!st.isSymbolicLink())fail('unmanaged_pointer');
  const target=await fsp.readlink(active);
  if(!/^releases\/[a-f0-9]{40}$/.test(target))fail('unmanaged_pointer_target');
  return target;
 }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function preflight({sha,hashes,base=BASE}){
 const spec=contract(sha);
 if(base!==BASE)fail('fixed_target_only');
 const staging=path.join(base,'staging',sha),release=path.join(base,'releases',sha);
 await requirePrivateDir(base);
 await requirePrivateDir(path.join(base,'staging'));
 const staged=await hashStage(staging,hashes);
 try{await fsp.lstat(release);fail('release_exists');}
 catch(e){if(e.code!=='ENOENT')throw e;}
 const active=await readPointer(path.join(base,'current'));
 return {ok:true,mode:'preflight_only',action:ACTION,sha,files:Object.keys(staged),
   active_preimage:active,mutated:false,level4_required:true};
}
async function installTransaction({sha,hashes,approvalMediator,registerAction,rollbackRegistration,healthProbe}){
 if(typeof approvalMediator!=='function'||typeof registerAction!=='function'||
    typeof rollbackRegistration!=='function'||typeof healthProbe!=='function')fail('trusted_mediator_required');
 const plan=await preflight({sha,hashes});
 // This call MUST be supplied by the trusted Approval Center integration, not
 // the caller/model. It consumes one-time cryptographically verified approval.
 const attestation=await approvalMediator({action:ACTION,level:4,
   expected_sha:sha,target_host:TARGET_HOST,expected_preimage:plan.active_preimage});
 if(!attestation||attestation.consumed!==true||attestation.authenticated!==true||
    attestation.action!==ACTION||attestation.expected_sha!==sha||
    attestation.target_host!==TARGET_HOST)fail('approval_not_verified');
 const root=BASE,releases=path.join(root,'releases'),stage=path.join(root,'staging',sha);
 const active=path.join(root,'current'),release=path.join(releases,sha);
 const transaction=path.join(root,'.current-'+sha+'.tmp');
 const installLock=await acquireInstallLock(root);
 try{
 const recheck=await preflight({sha,hashes});
 if(recheck.active_preimage!==plan.active_preimage)fail('concurrent_pointer_drift');
 const staged=await hashStage(stage,hashes);
 let releaseCreated=false,pointerMoved=false,registrationAttempted=false;
 await fsp.mkdir(releases,{recursive:true,mode:0o700});
 await requirePrivateDir(releases);
 try{
  await fsp.mkdir(release,{mode:0o700});
  releaseCreated=true;
  for(const rel of FILES){
    const target=path.join(release,rel);
    await fsp.mkdir(path.dirname(target),{recursive:true,mode:0o700});
    const fd=await fsp.open(target,'wx',0o600);
    try{await fd.writeFile(staged[rel]);await fd.sync();}finally{await fd.close();}
  }
  await fsyncDir(path.join(release,'lib'));await fsyncDir(release);await fsyncDir(releases);
  const justBefore=await readPointer(active);
  if(justBefore!==plan.active_preimage)fail('concurrent_pointer_drift');
  await fsp.symlink('releases/'+sha,transaction);
  await fsp.rename(transaction,active);pointerMoved=true;
  await fsyncDir(root);
  registrationAttempted=true;
  await registerAction({action:ACTION,sha,release,capabilities:['file.read','backup.create','backup.verify']});
  const health=await healthProbe({sha,release});
  if(!health||health.ok!==true||health.sha!==sha||health.registered!==true)fail('health_not_verified');
  return {ok:true,installed:true,sha,release,active,previous:plan.active_preimage,
    verified:true,rollback:false};
 }catch(e){
  const errors=[];
  if(registrationAttempted){
    try{await rollbackRegistration({action:ACTION,sha,expected_previous:plan.active_preimage});}
    catch(regErr){errors.push('registry:'+regErr.message);}
  }
  if(pointerMoved){
    try{
      const rollbackLink=path.join(root,'.rollback-'+sha+'.tmp');
      if(plan.active_preimage){
        await fsp.symlink(plan.active_preimage,rollbackLink);
        await fsp.rename(rollbackLink,active);
      }else {
        // No old release: removing only our own symlink is safe after readlink check.
        if(await fsp.readlink(active)!=='releases/'+sha)fail('pointer_changed');
        await fsp.unlink(active);
      }
      await fsyncDir(root);
    }catch(rollbackError){errors.push('pointer:'+rollbackError.message);}
  }
  if(releaseCreated){
    // Retain release for inspection if rollback failed; never delete prior release.
    if(!errors.length)try{await fsp.rm(release,{recursive:true,force:false});}
    catch(removeError){errors.push('release:'+removeError.message);}
  }
  throw Error('install_failed:'+e.message+(errors.length?':ROLLBACK_INCOMPLETE:'+errors.join('|'):':ROLLED_BACK'));
 }finally{
  try{await fsp.unlink(transaction);}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 }finally{await releaseInstallLock(installLock);}
}
if(require.main===module){
 if(process.argv[2]==='--contract'&&process.argv.length===4){
  try{process.stdout.write(JSON.stringify(contract(process.argv[3]))+'\n');}
  catch(e){process.stderr.write(e.message+'\n');process.exitCode=78;}
 }else{process.stderr.write('no_standalone_apply_control_plane_required\n');process.exitCode=78;}
}
module.exports={FILES,ACTION,BASE,TARGET_HOST,contract,preflight,installTransaction,
 hashStage,requirePrivateDir,acquireInstallLock,releaseInstallLock};
