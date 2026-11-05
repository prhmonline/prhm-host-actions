'use strict';
/**
 * Synthetic REAL-PROCESS cold restart regression for the durable recovery
 * engine. Only creates temporary synthetic files in the CI runner tmpdir.
 * Child persists nine changed files, four backups, recovery JSON and a
 * simulated consumption receipt, then SIGKILLs itself. A fresh process
 * reconstructs and restores the original state from the disk journal.
 *
 * Does NOT invoke a Production runner, systemd, or a live Approval Center.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const C=require('./prhm-action-registry-v2-durable-recovery-v1.cjs');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const requestId='51a846d0-8052-485e-8f7b-1363a41300b5';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fsyncFile=file=>{const fd=fs.openSync(file,'r');try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}};
const fsyncDir=dir=>{const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}};
const dir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'prhm-cold-restart-v2-'));
const read=p=>fs.readFileSync(p);
function pinFile(filename,bytes){
 fs.writeFileSync(filename,bytes,{flag:'wx',mode:0o600});
 fsyncFile(filename);
}
function bootstrapChild(temp){
 if(!temp.startsWith(os.tmpdir()+path.sep)||!path.basename(temp).startsWith('prhm-cold-restart-v2-'))
  throw Error('synthetic_root_not_tmp');
 for(const d of ['backups','owners','assets'])
  fs.mkdirSync(path.join(temp,d),{mode:0o700});
 const owners={},pins={},snapshotOwners={},assets=[];
 for(const key of C.OWNER_KEYS){
  const original=Buffer.from('ORIGINAL_SYNTHETIC_'+key+'_'.repeat(8));
  const updated=Buffer.from('UPDATED_SYNTHETIC_'+key+'_'.repeat(8));
  const file=path.join(temp,'owners',key);
  const backup=path.join(temp,'backups',key+'.bak');
  pinFile(file,updated);pinFile(backup,original);
  pins[key]={path:G.OWNER_PATHS[key],before_sha256:sha(original),
    after_sha256:sha(updated)};
  snapshotOwners[key]={sha256:sha(original),uid:0,gid:0,mode:0o640};
  owners[key]={file};
 }
 for(let i=0;i<5;i++){
  const data=Buffer.from('synthetic-reviewed-asset-'+i);
  const file=path.join(temp,'assets',String(i));
  pinFile(file,data);
  assets.push({path:'/opt/prhm-agent-selfmaint-exec/actions/synthetic-'+i+'.cjs',
    source_path:'synthetic-'+i+'.cjs',sha256:sha(data),file});
 }
 const release={
  normalized:{project:'honartik',action:'honartik_config_center_readonly_enroll_v1',
   owners:pins,assets:assets.map(({path,source_path,sha256})=>({path,source_path,sha256}))},
  source_commit:'a'.repeat(40),manifest_commit:'b'.repeat(40),
  manifest_sha256:'c'.repeat(64)
 };
 const snapshot={schema:'prhm.registry.recovery.v1',
  request_id:requestId,project:release.normalized.project,
  action:release.normalized.action,source_commit:release.source_commit,
  manifest_commit:release.manifest_commit,manifest_sha256:release.manifest_sha256,
  owners:snapshotOwners};
 const record={release,snapshot,owners,assets,
  receipt:{request_id:requestId,operation:G.OPERATION,
   manifest_sha256:release.manifest_sha256,consumed_simulated:true}};
 pinFile(path.join(temp,'journal.json'),Buffer.from(JSON.stringify(record)+'\n'));
 pinFile(path.join(temp,'claimed.json'),Buffer.from(JSON.stringify(record.receipt)+'\n'));
 for(const d of ['owners','backups','assets'])fsyncDir(path.join(temp,d));
 fsyncDir(temp);
 // Emulate abrupt process termination: no finally, no in-memory callback.
 process.kill(process.pid,'SIGKILL');
}
if(process.argv[2]==='--crash-child'){
 bootstrapChild(process.argv[3]||'');
 process.exitCode=77;
} else {
 function fromDisk(temp,opts={}){
  const rec=JSON.parse(read(path.join(temp,'journal.json')));
  let mutations=0;
  const entryForAsset=Object.fromEntries(rec.assets.map(a=>[a.path,a]));
  const actual=()=>{
   const owners={},assets={};
   for(const key of C.OWNER_KEYS){
    const bytes=read(rec.owners[key].file);
    owners[key]={exists:true,regular:true,symlink:false,
     sha256:sha(bytes),uid:0,gid:0,mode:0o640};
   }
   for(const [n,item] of Object.entries(entryForAsset)){
    if(fs.existsSync(item.file))assets[n]={exists:true,regular:true,symlink:false,
     sha256:sha(read(item.file)),uid:0,gid:0,mode:0o644};
    else assets[n]={exists:false,regular:false,symlink:false,sha256:null,
     uid:null,gid:null,mode:null};
   }
   return {owners,assets};
  };
  const callbacks={
   release:rec.release,snapshot:rec.snapshot,
   readBackup:key=>read(path.join(temp,'backups',key+'.bak')),
   readLive:async()=>actual(),
   authorizeRecovery:async binding=>{
    if(opts.denyAuthorization)return false;
    const claim=JSON.parse(read(path.join(temp,'claimed.json')));
    return claim.consumed_simulated===true&&claim.request_id===binding.request_id&&
     claim.operation===binding.operation&&claim.manifest_sha256===binding.manifest_sha256;
   },
   exclusiveLock:async()=>{
    const lock=path.join(temp,'exclusive-lock');
    fs.mkdirSync(lock,{mode:0o700});
    return ()=>fs.rmdirSync(lock);
   },
   restoreOwner:async step=>{
    assert.equal(sha(step.bytes),step.sha256);
    mutations++;
    fs.writeFileSync(rec.owners[step.key].file,step.bytes);
    fsyncFile(rec.owners[step.key].file);
   },
   removeAsset:async step=>{
    const a=entryForAsset[step.path];
    assert.equal(sha(read(a.file)),step.sha256);
    mutations++;fs.unlinkSync(a.file);
    fsyncDir(path.dirname(a.file));
   },
   verifyOriginalState:async()=>{
    const state=actual();
    return C.OWNER_KEYS.every(k=>state.owners[k].sha256===
      rec.snapshot.owners[k].sha256)&&
      Object.values(state.assets).every(x=>x.exists===false);
   },
   verifyServices:async()=>opts.failServices!==true, // sandbox-only synthetic
   verifyTargetAbsent:async action=>{
    assert.equal(action,rec.release.normalized.action);
    if(opts.discoveryError)throw Error('synthetic_mcp_timeout');
    return opts.staleDiscovery!==true;
   },
   audit:async value=>{
    const file=path.join(temp,'audit.jsonl');
    fs.appendFileSync(file,JSON.stringify(value)+'\n',{mode:0o600});
    fsyncFile(file);
   }
  };
  return {callbacks,actual,getMutations:()=>mutations};
 }
 function startCrashedChild(){
  const temp=dir();
  const r=cp.spawnSync(process.execPath,[__filename,'--crash-child',temp],
    {encoding:'utf8',timeout:12000});
  assert.equal(r.signal,'SIGKILL',r.stderr||'child did not die by SIGKILL');
  assert.ok(fs.existsSync(path.join(temp,'journal.json')));
  assert.ok(fs.existsSync(path.join(temp,'claimed.json')));
  return temp;
 }
 test('SIGKILL after persisted nine-path change allows fresh-process journal restoration',async()=>{
  const temp=startCrashedChild();
  try{
   const fresh=fromDisk(temp);
   const first=await C.reconcileFromDurableJournal(fresh.callbacks);
   assert.equal(first.ok,true);assert.equal(first.verified,true);
   assert.equal(first.steps,9);assert.equal(fresh.getMutations(),9);
   assert.ok(fs.readFileSync(path.join(temp,'audit.jsonl'),'utf8').includes('"verified":true'));
   assert.equal(fs.existsSync(path.join(temp,'exclusive-lock')),false);
   // After another loss of in-memory state, fresh reconstruction is idempotent.
   const secondProcess=fromDisk(temp);
   const result=await C.reconcileFromDurableJournal(secondProcess.callbacks);
   assert.equal(result.steps,0);
   assert.equal(secondProcess.getMutations(),0);
   assert.equal(fs.existsSync(path.join(temp,'claimed.json')),true);
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
 });
 test('tampered backup after SIGKILL refuses restore before any mutation',async()=>{
  const temp=startCrashedChild();
  try{
   fs.writeFileSync(path.join(temp,'backups','base.bak'),'untrusted');
   const f=fromDisk(temp);
   await assert.rejects(C.reconcileFromDurableJournal(f.callbacks),/durable_backup_sha_base/);
   assert.equal(f.getMutations(),0);
   assert.equal(fs.existsSync(path.join(temp,'audit.jsonl')),false);
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
 });
 test('missing previously consumed simulated request refuses recovery and lock',async()=>{
  const temp=startCrashedChild();
  try{
   const f=fromDisk(temp,{denyAuthorization:true});
   await assert.rejects(C.reconcileFromDurableJournal(f.callbacks),
     /consumed_approval_binding_missing/);
   assert.equal(f.getMutations(),0);
   assert.equal(fs.existsSync(path.join(temp,'exclusive-lock')),false);
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
 });
 test('failed health verification after restore never declares success',async()=>{
  const temp=startCrashedChild();
  try{
   const f=fromDisk(temp,{failServices:true});
   await assert.rejects(C.reconcileFromDurableJournal(f.callbacks),/services_unhealthy/);
   assert.equal(fs.existsSync(path.join(temp,'audit.jsonl')),false);
   assert.equal(fs.existsSync(path.join(temp,'exclusive-lock')),false);
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
 });
 test('stale MCP tool after SIGKILL restore cannot be audited as verified',async()=>{
  const temp=startCrashedChild();
  try{
   const f=fromDisk(temp,{staleDiscovery:true});
   await assert.rejects(C.reconcileFromDurableJournal(f.callbacks),
    /target_mcp_tool_still_visible_or_unverified/);
   assert.equal(fs.existsSync(path.join(temp,'audit.jsonl')),false);
   assert.equal(fs.existsSync(path.join(temp,'exclusive-lock')),false);
   assert.equal(f.getMutations(),9);
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
 });
 test('unreachable MCP discovery after SIGKILL recovery remains NO-GO',async()=>{
  const temp=startCrashedChild();
  try{
   const f=fromDisk(temp,{discoveryError:true});
   await assert.rejects(C.reconcileFromDurableJournal(f.callbacks),
    /synthetic_mcp_timeout/);
   assert.equal(fs.existsSync(path.join(temp,'audit.jsonl')),false);
   assert.equal(fs.existsSync(path.join(temp,'exclusive-lock')),false);
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
 });

}
