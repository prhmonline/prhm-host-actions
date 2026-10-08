'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const tx=require('./drtarjomeh-readonly-registration-transaction-v1.js');
const APPROVED=Object.freeze({
  operation:tx.OPERATION,level:4,second_confirmation:tx.APPROVAL,
  one_time_consumed:true,production_scope:'control_plane',
  source_commit:'69de3224ab08969102cb518164d576086af924aa'
});
const sha=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');
function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'drt-readonly-tx-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const paths=Array.from({length:5},(_,i)=>path.join(base,'targets','t'+i+'.js'));
  fs.mkdirSync(path.dirname(paths[0]),{recursive:true});
  const backupRoot=path.join(base,'backups');fs.mkdirSync(backupRoot,{mode:0o700});
  const originals=paths.map((p,i)=>i<3?null:Buffer.from('original-owner-'+i+'\n'));
  originals.forEach((b,i)=>{if(b)fs.writeFileSync(paths[i],b);});
  const entries=paths.map((p,i)=>{
    const bytes=Buffer.from('read-only-registry-'+i+'\n');
    return {target:p,old_sha256:originals[i]?sha(originals[i]):'ABSENT',
      new_sha256:sha(bytes),bytes,mode:0o644};
  });
  return {base,paths,backupRoot,entries,originals,options:{
    targets:paths,backupRoot,verifyApproval:()=>APPROVED,
    activate:()=>({api_ok:true,mcp_ok:true,audit_contract_ok:true})
  }};
}
test('fixed production target set, source pin and explicit critical level',()=>{
  assert.equal(tx.EXACT_TARGETS.length,5);
  assert.equal(new Set(tx.EXACT_TARGETS).size,5);
  assert.equal(tx.OPERATION,'host_action.drtarjomeh_readonly_registration_install_v1');
  assert.equal(tx.APPROVAL,'CONFIRM_LEVEL_4_CRITICAL');
  assert.equal(tx.exactApproval(APPROVED),true);
});
test('successful transaction installs exactly five pinned outputs and keeps private backup',t=>{
  const f=fixture(t);
  const result=tx.executePrepared(f.entries,f.options);
  assert.equal(result.ok,true);
  assert.equal(result.status,'INSTALLED_VERIFIED');
  assert.equal(result.production_app_mutation,false);
  assert.equal(result.provider_credentials_rotated,false);
  assert.equal(result.files.length,5);
  for(let i=0;i<5;i++)assert.equal(sha(fs.readFileSync(f.paths[i])),f.entries[i].new_sha256);
  assert.equal(fs.existsSync(path.join(f.backupRoot,'install.lock')),false);
  assert.equal(sha(fs.readFileSync(path.join(result.backup_directory,'before-3'))),f.entries[3].old_sha256);
  assert.equal(fs.statSync(result.backup_directory).mode&0o777,0o700);
});
test('refuses unsigned, wrong commit, wrong level and unconsumed approval before writes',t=>{
  const f=fixture(t);
  for(const bad of [
    null,{...APPROVED,level:3},{...APPROVED,one_time_consumed:false},
    {...APPROVED,source_commit:'0'.repeat(40)}
  ]){
    assert.throws(()=>tx.executePrepared(f.entries,{...f.options,verifyApproval:()=>bad}),
      /trusted_level4_approval_required/);
    for(let i=0;i<5;i++)assert.equal(fs.existsSync(f.paths[i]),i>=3);
  }
});
test('preimage drift is rejected without touching existing owner',t=>{
  const f=fixture(t);
  fs.writeFileSync(f.paths[3],Buffer.from('new competing bytes'));
  assert.throws(()=>tx.executePrepared(f.entries,f.options),/target_preimage_sha_drift/);
  assert.equal(fs.readFileSync(f.paths[3],'utf8'),'new competing bytes');
  for(let i=0;i<3;i++)assert.equal(fs.existsSync(f.paths[i]),false);
});
test('symlink and existing artifact both fail closed',t=>{
  const f=fixture(t);
  fs.symlinkSync(f.paths[4],f.paths[0]);
  assert.throws(()=>tx.executePrepared(f.entries,f.options),/target_not_regular/);
  fs.unlinkSync(f.paths[0]);fs.writeFileSync(f.paths[0],'untrusted');
  assert.throws(()=>tx.executePrepared(f.entries,f.options),/target_already_present/);
  assert.equal(fs.readFileSync(f.paths[0],'utf8'),'untrusted');
});
test('failed health reverses all owner changes and removes all three new artifacts',t=>{
  const f=fixture(t);const calls=[];
  const options={...f.options,activate:phase=>{
    calls.push(phase);
    return phase==='activate'?{api_ok:false,mcp_ok:true,audit_contract_ok:false}:
      {api_ok:true,mcp_ok:true,audit_contract_ok:true};
  }};
  assert.throws(()=>tx.executePrepared(f.entries,options),/ROLLED_BACK:postinstall_health_failed/);
  assert.deepEqual(calls,['activate','rollback']);
  for(let i=0;i<5;i++){
    if(f.originals[i])assert.deepEqual(fs.readFileSync(f.paths[i]),f.originals[i]);
    else assert.equal(fs.existsSync(f.paths[i]),false);
  }
  assert.equal(fs.existsSync(path.join(f.backupRoot,'install.lock')),false);
});
test('health throws after partial service activation, and owner bytes still roll back',t=>{
  const f=fixture(t);const calls=[];
  assert.throws(()=>tx.executePrepared(f.entries,{...f.options,activate:phase=>{
    calls.push(phase);
    if(phase==='activate')throw Error('API_restart_failed');
    return {api_ok:true,mcp_ok:true};
  }}),/ROLLED_BACK:API_restart_failed/);
  assert.deepEqual(calls,['activate','rollback']);
  for(let i=0;i<5;i++)
    assert.equal(fs.existsSync(f.paths[i]),i>=3);
  assert.deepEqual(fs.readFileSync(f.paths[4]),f.originals[4]);
});
test('backup lock cannot be stolen, and releases are not altered',t=>{
  const f=fixture(t);
  fs.writeFileSync(path.join(f.backupRoot,'install.lock'),'other transaction');
  assert.throws(()=>tx.executePrepared(f.entries,f.options),/installer_lock_busy_or_missing_root/);
  assert.equal(fs.readFileSync(path.join(f.backupRoot,'install.lock'),'utf8'),'other transaction');
  for(let i=0;i<3;i++)assert.equal(fs.existsSync(f.paths[i]),false);
});
test('candidate builder on non-production CI host fails closed',()=>{
  assert.throws(()=>tx.generateEntries(),/live_sha_drift/);
});
test('no installation CLI; mutation remains behind trusted control-plane action',()=>{
  const script=path.join(__dirname,'drtarjomeh-readonly-registration-transaction-v1.js');
  const bad=spawnSync(process.execPath,[script,'--install'],{encoding:'utf8'});
  assert.equal(bad.status,2);
  assert.match(bad.stderr,/Library-only/);
  const source=fs.readFileSync(script,'utf8');
  assert.doesNotMatch(source,/child_process|systemctl|execFile|spawnSync|fetch\(/);
});
