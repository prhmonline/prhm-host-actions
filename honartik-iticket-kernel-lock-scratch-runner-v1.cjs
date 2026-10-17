'use strict';
/**
 * Kernel advisory flock (util-linux) harness for dedicated TEMP SCRATCH fixtures.
 * NOT a root adapter, NOT an installer, NOT an approval request.
 * No dynamic command execution. Only /usr/bin/flock may launch this exact file
 * under process.execPath. The only accepted roots are our freshly-created,
 * owner-verified temp fixture directories.
 */
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const disk=require('./honartik-iticket-root-installer-disk-fixture-v1.cjs');
const engine=require('./honartik-iticket-root-installer-transaction-engine-v1.cjs');
const {ORDER,sha256,execute,recover}=engine;
const FLOCK='/usr/bin/flock';
const TX_ID='kernel-lock-fixture-001';
const MAX_HOLD_MS=15000;
function fail(s){throw Error('kernel_lock_fixture_'+s);}
function check(root){
  disk.openFixture(root); // strict name/temp boundary / owner / realpath
  return root;
}
function lockFile(root){
  check(root);
  const file=path.join(root,'.kernel-flock.lock');
  try{
    const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|
      fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
    try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    const d=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
    try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  }catch(e){if(e.code!=='EEXIST')throw e;}
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||
     st.uid!==process.getuid()||st.gid!==process.getgid()||
     (st.mode&0o7777)!==0o600)fail('lock_file_untrusted');
  return file;
}
function argv(root,mode){
  if(!['probe','hold','apply','crash-after-exec','recover'].includes(mode))
    fail('operation_not_allowed');
  const file=lockFile(root);
  return ['-F','-n','-x','-E','73',file,process.execPath,__filename,'--worker',mode,root];
}
function spawnFixture(root,mode){
  return cp.spawn(FLOCK,argv(root,mode),{
    stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/local/bin:/usr/bin:/bin'},cwd:__dirname
  });
}
function runFixture(root,mode){
  return cp.spawnSync(FLOCK,argv(root,mode),{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:25000,
    env:{PATH:'/usr/local/bin:/usr/bin:/bin'},cwd:__dirname
  });
}
function fixtureParams(root,adapter){
  const expected={},candidates={};
  for(const key of ORDER){
    expected[key]=sha256(Buffer.from('DISK_FIXTURE_ORIGINAL_'+key));
    candidates[key]=Buffer.from('DISK_FIXTURE_CANDIDATE_'+key);
  }
  return {mode:'isolated-fixture',id:TX_ID,expected,candidates,adapter};
}
function lockInherited(root){
  // flock --no-fork exec keeps the lock FD open in this process.
  const st=fs.statSync(lockFile(root));
  const dir='/proc/self/fd';
  if(!fs.existsSync(dir))fail('proc_fd_required');
  for(const ent of fs.readdirSync(dir)){
    if(!/^\d+$/.test(ent))continue;
    try{const f=fs.fstatSync(Number(ent));if(f.dev===st.dev&&f.ino===st.ino)return true;}
    catch{}
  }
  return false;
}
async function worker(mode,root){
  check(root);
  if(!lockInherited(root))fail('kernel_lock_fd_not_inherited');
  process.stdout.write('KERNEL_FLOCK_INHERITED=PASS\n');
  if(mode==='probe')return;
  if(mode==='hold'){
    process.stdout.write('LOCK_HOLD_READY=YES\n');
    await new Promise(resolve=>setTimeout(resolve,MAX_HOLD_MS));
    return;
  }
  const adapter=disk.openFixture(root);
  const p=fixtureParams(root,adapter);
  if(mode==='recover'){
    const result=await recover({mode:'isolated-fixture',id:TX_ID,expected:p.expected,adapter});
    if(!result.ok)fail('recovery_not_complete');
    process.stdout.write('SCRATCH_RECOVERY=PASS\n');
    return;
  }
  if(mode==='crash-after-exec'){
    const original=adapter.commitCandidate;
    adapter.commitCandidate=async(id,key,handle)=>{
      await original(id,key,handle);
      if(key==='exec'){
        process.stdout.write('CRASH_AFTER_SECOND_REAL_RENAME=YES\n');
        // Hard child exit before the transaction engine can mark completion.
        process.exit(86);
      }
    };
  }
  const result=await execute(p);
  if(!result.ok||!result.fixture_only||result.signed_install_authorized)
    fail('unexpected_execution_result');
  process.stdout.write('SCRATCH_TRANSACTION_COMMITTED=PASS\n');
}
if(require.main===module){
  const args=process.argv.slice(2);
  if(args.length!==3||args[0]!=='--worker'){
    process.stderr.write('kernel_lock_fixture_worker_only\n');
    process.exitCode=64;
  }else{
    worker(args[1],args[2]).catch(e=>{
      process.stderr.write(String(e.message||e)+'\n');
      process.exitCode=65;
    });
  }
}
module.exports=Object.freeze({TX_ID,check,lockFile,spawnFixture,runFixture});
