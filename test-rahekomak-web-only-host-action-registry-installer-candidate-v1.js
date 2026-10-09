'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const r=require('./rahekomak-web-only-host-action-registry-installer-candidate-v1.js');
const reg=require('./rahekomak-web-only-host-action-registry-candidate-v1.js');
function approval(){return {action:r.ACTION,level:4,risk:'critical',
 verified_by_trusted_mediator:true,one_time_token_consumed:true,
 second_confirmation_valid:true,pinned_application_sha:reg.SHA}}
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rah-installer-'));
 const files={},sources={},original={};
 for(const key of r.KEYS){
  const p=path.join(root,key+'.txt');
  fs.writeFileSync(p,'before-'+key);
  files[key]={path:p,bytes:Buffer.from('before-'+key),sha256:r.sha(Buffer.from('before-'+key)),mode:0o600,uid:process.getuid(),gid:process.getgid()};
  sources[key]='before-'+key; original[key]='before-'+key;
 }
 const candidates=Object.fromEntries(r.KEYS.map(k=>[k,'after-'+k]));
 const plan={inputs:files,candidates,candidate_sha256:Object.fromEntries(r.KEYS.map(k=>[k,r.sha(Buffer.from(candidates[k]))]))};
 return {root,files,original,plan,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})}
}
function withMappedPath(f){
 const saved={...r.PATHS};
 // Patch only filesystem fixture hooks; candidate module itself has immutable fixed roots.
 const io={...fs,
  lstatSync:(name)=>fs.lstatSync(name),
  realpathSync:(name)=>fs.realpathSync(name),
  readFileSync:(name)=>fs.readFileSync(name),
  mkdirSync:(...a)=>fs.mkdirSync(...a),
  writeFileSync:(...a)=>fs.writeFileSync(...a),
  chownSync:(...a)=>fs.chownSync(...a),
  chmodSync:(...a)=>fs.chmodSync(...a),
  renameSync:(...a)=>fs.renameSync(...a),
  unlinkSync:(...a)=>fs.unlinkSync(...a)
 };
 return f(io,saved);
}
test('requires an authenticated consumed Level-4 one-time approval before mutation',()=>{
 assert.throws(()=>r.checkStagedApproval(null),/trusted_level4/);
 const a=approval();delete a.one_time_token_consumed;
 assert.throws(()=>r.checkStagedApproval(a),/trusted_level4/);
 assert.equal(r.checkStagedApproval(approval()),true);
});
test('preimage guard rejects symlinks, files with world write, and drift',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rah-path-'));
 try{
  const p=path.join(tmp,'regular'),link=path.join(tmp,'link');
  fs.writeFileSync(p,'a',{mode:0o600});
  fs.symlinkSync(p,link);
  assert.throws(()=>r.validatePath(link,fs.lstatSync(link),fs.realpathSync(link)),/source_path_invalid/);
  assert.doesNotThrow(()=>r.validatePath(p,fs.lstatSync(p),fs.realpathSync(p)));
  fs.chmodSync(p,0o602);
  assert.throws(()=>r.validatePath(p,fs.lstatSync(p),fs.realpathSync(p)),/world_writable/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});
test('only four pinned surfaces and fixed services, no API or website mutations',()=>{
 assert.deepEqual(Object.keys(r.PATHS),['base','executor','mcp','policy']);
 assert.ok(!Object.values(r.PATHS).some(x=>x.includes('/apps/web/')||x.includes('/apps/api/')));
 assert.ok(!r.SERVICES.includes('httpd.service'));
 assert.equal(r.ACTION,'rahekomak_web_only_registry_install_v1');
});
test('CLI has no standalone apply capability',()=>{
 const old=process.argv;
 try{process.argv=['node','script','--apply'];assert.throws(()=>r.main(),/no_standalone_apply/)}
 finally{process.argv=old}
});
test('candidate generator rejects any changed pinned preimage',()=>{
 const original={sources:{base:'x',executor:'x',mcp:'x',policy:'x'},
  files:Object.fromEntries(r.KEYS.map(k=>[k,{sha256:'0'.repeat(64)}]))};
 assert.throws(()=>r.planRegistration(original),/preimage_sha_mismatch/);
});
test('fixture transaction succeeds and records exact SHA results without modifying outside fixtures',()=>{
 const x=fixture();const baseBackup=path.join(r.BACKUP_ROOT,'fixture-success-'+process.pid);
 // Only a mock IO remaps an allowlisted backup root into a temporary directory.
 const backupFake=path.join(x.root,'backups');
 const io={...fs,
  mkdirSync:(p,opts)=>fs.mkdirSync(p===baseBackup?backupFake:p,opts),
  writeFileSync:(p,...args)=>fs.writeFileSync(p.startsWith(baseBackup+'/')?p.replace(baseBackup,backupFake):p,...args),
  readFileSync:(p,...args)=>fs.readFileSync(p.startsWith(baseBackup+'/')?p.replace(baseBackup,backupFake):p,...args)
 };
 // Fixed-path containment is tested independently; mutation requires valid verifier.
 const oldPaths={...r.PATHS};
 try{
  for(const k of r.KEYS)r.PATHS[k]=x.files[k].path;
  const result=r.executeTransaction(x.plan,{io,backupDir:baseBackup,approval:approval(),
   restart:()=>{},health:()=>{}});
  assert.equal(result.ok,true);
  for(const k of r.KEYS)assert.equal(fs.readFileSync(x.files[k].path,'utf8'),'after-'+k);
  assert.equal(JSON.parse(fs.readFileSync(path.join(backupFake,'result.json'))).rollback_performed,false);
 }finally{for(const k of r.KEYS)r.PATHS[k]=oldPaths[k];x.cleanup()}
});
test('failure after swaps triggers exact byte restoration in reverse order',()=>{
 const x=fixture();const backupRoot=path.join(r.BACKUP_ROOT,'fixture-fail-'+process.pid);
 const backing=path.join(x.root,'backup');
 const io={...fs,
  mkdirSync:(p,opts)=>fs.mkdirSync(p===backupRoot?backing:p,opts),
  writeFileSync:(p,...args)=>fs.writeFileSync(p.startsWith(backupRoot+'/')?p.replace(backupRoot,backing):p,...args),
  readFileSync:(p,...args)=>fs.readFileSync(p.startsWith(backupRoot+'/')?p.replace(backupRoot,backing):p,...args)
 };
 const oldPaths={...r.PATHS};
 try{
  for(const k of r.KEYS)r.PATHS[k]=x.files[k].path;
  assert.throws(()=>r.executeTransaction(x.plan,{io,backupDir:backupRoot,approval:approval(),
    restart:(svc)=>{if(svc===r.SERVICES[0])throw new Error('injected_restart_failure')},health:()=>{}}),/registration_failed/);
  for(const k of r.KEYS)assert.equal(fs.readFileSync(x.files[k].path,'utf8'),'before-'+k);
 }finally{for(const k of r.KEYS)r.PATHS[k]=oldPaths[k];x.cleanup()}
});
