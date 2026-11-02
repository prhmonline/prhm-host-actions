'use strict';
/**
 * READ ONLY production preflight / IN-MEMORY fault injection.
 * No production writes, no service control, no real authorization, no install.
 * Designed for the server's isolated /var/tmp Git review checkouts.
 */
const fs=require('node:fs');
const cp=require('node:child_process');
const assert=require('node:assert/strict');
const core=require('./solo-company-runtime-signed-registration-transaction-v1.js');

const HOST_REVIEW='/var/tmp/solo-runtime-registration-review-20261103';
const SSH_REVIEW='/var/tmp/solo-runtime-sshagent-review-20261103';
const refs={
  'prhmonline/sshagent':{
    dir:SSH_REVIEW,head:core.SOURCE_COMMITS.sshagent,
    path:'mcp-server/src/plugins/soloCompanyRuntimeInstallCore.js'
  },
  'prhmonline/prhm-host-actions':{
    dir:HOST_REVIEW,head:null,
    path:'solo-company-runtime-root-action-v1.js'
  }
};
function gitHead(dir){
  const result=cp.spawnSync('/usr/bin/git',['-C',dir,'rev-parse','HEAD'],{
    encoding:'utf8',timeout:10000,env:{PATH:'/usr/bin:/bin'}});
  if(result.status!==0)throw Error('read_only_git_reference_invalid');
  return result.stdout.trim();
}
function diskState(filename){
  try{
    const st=fs.lstatSync(filename);
    return {exists:true,is_file:st.isFile(),is_symlink:st.isSymbolicLink(),
      realpath:fs.realpathSync(filename),uid:st.uid,gid:st.gid,
      mode:st.mode&0o777,bytes:fs.readFileSync(filename)};
  }catch(error){
    if(error.code==='ENOENT')return {exists:false};
    throw error;
  }
}
function sourceRead({repository,commit,path}){
  const ref=refs[repository];
  if(!ref||ref.path!==path||commit!==core.SOURCE_COMMITS[repository==='prhmonline/sshagent'?'sshagent':'host'])
    throw Error('read_only_git_binding_invalid');
  if(ref.head&&gitHead(ref.dir)!==ref.head)throw Error('read_only_checkout_drift');
  return fs.readFileSync(ref.dir+'/'+ref.path);
}
async function main(){
  if(process.argv.length!==3||process.argv[2]!=='--read-only')
    throw Error('read_only_mode_required');
  const before=new Map(Object.entries(core.TARGETS).map(([k,p])=>[p,diskState(p)]));
  const inspect=p=>before.get(p);
  const plan=core.getPlan({inspect,pinnedGitRead:sourceRead});
  core.verifyPlan(plan);
  console.log('EXACT_LIVE_BASELINES=PASS');
  console.log('READ_ONLY_PLAN=PASS');
  for(const item of plan.steps)console.log(item.kind.toUpperCase()+'_CANDIDATE_SHA256='+item.after_sha256);
  console.log('ROOT_ADAPTER_SOURCE_SHA256='+plan.root_helper_sha);
  const memory=new Map();
  const prior=new Map([...before].map(([p,s])=>[p,s.exists?{...s,bytes:Buffer.from(s.bytes)}:{exists:false}]));
  for(const [p,s] of before)memory.set(p,s.exists?{...s,bytes:Buffer.from(s.bytes)}:{exists:false});
  let backup=null,writes=0,records=[];
  const mock={
    inspect:p=>memory.get(p),
    pinnedGitRead:sourceRead,
    consumeSignedL4:async req=>({
      verified:req.operation===core.OPERATION,consumed:true,
      operation:req.operation,level:4,risk:'critical',
      request_id:'99999999-9999-4999-8999-999999999999'
    }),
    lock:async()=>async()=>{},
    snapshot:async steps=>steps.map(x=>memory.get(x.path)),
    backup:async copies=>{backup=copies.map(s=>s.exists?{...s,bytes:Buffer.from(s.bytes)}:{exists:false})},
    writeExact:async s=>{
      writes++;
      if(writes===3)throw Error('INJECTED_FAULT_SIMULATION_ONLY');
      memory.set(s.path,{exists:true,is_file:true,is_symlink:false,
        realpath:s.path,mode:s.mode,uid:s.uid,gid:s.gid,bytes:Buffer.from(s.bytes)});
    },
    verifyExact:async s=>assert.equal(core.hash(memory.get(s.path).bytes),s.after_sha256),
    restoreExact:async (p,k)=>{
      const original=prior.get(p);
      memory.set(p,original.exists?{...original,bytes:Buffer.from(original.bytes)}:{exists:false});
    },
    verifyRestore:async k=>{
      const p=core.TARGETS[k],old=prior.get(p),now=memory.get(p);
      assert.equal(now.exists,old.exists);
      if(old.exists)assert.equal(core.hash(now.bytes),core.hash(old.bytes));
    },
    reloadAndHealth:async()=>({approval:true,executor:true,mcp:true,router:true}),
    record:async r=>{records.push(r)}
  };
  await assert.rejects(()=>core.applyPrepared(plan,mock),/registration_failed_rollback_complete/);
  assert.ok(writes>=3);assert.ok(backup?.length===6);
  assert.equal(memory.get(core.TARGETS.worker).exists,false);
  assert.ok(records.some(x=>x.ok===false&&x.rollback_performed===true));
  for(const [p,s]of before){
    const untouched=diskState(p);
    assert.equal(untouched.exists,s.exists);
    if(s.exists)assert.equal(core.hash(untouched.bytes),core.hash(s.bytes));
  }
  console.log('IN_MEMORY_FAULT_INJECTION=PASS');
  console.log('IN_MEMORY_ROLLBACK=PASS');
  console.log('PRODUCTION_CHANGED=FALSE');
  console.log('SIGNED_LEVEL4_INSTALL=NOT_EXECUTED');
}
if(require.main===module)main().catch(e=>{
  // Fixed bounded error class only; no full filesystem or secret output.
  console.error('READ_ONLY_PREFLIGHT_FAILED='+String(e?.message||'unknown').slice(0,120));
  process.exitCode=2;
});
module.exports={diskState,sourceRead,main};
