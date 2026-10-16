'use strict';
/*
 * TEMP-FILESYSTEM TEST INSTALLER ONLY.
 * No host registration, approval, sudo, command execution, network or production path.
 * Hard-code isolation to a private, caller-owned OS temp directory to prevent this
 * code from becoming an accidental production deployment mechanism.
 */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const fixture=require('./deploy-control-cutover-fixture-v1.cjs');
const {PATHS,CHECKPOINTS}=fixture;
const PREEXISTING=[PATHS.POLICY,PATHS.ARANOB,PATHS.HONARTIK];
const NEW=[PATHS.GATE,PATHS.HELPER,PATHS.CORE];
const ALL=[...PREEXISTING,...NEW];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=s=>{throw Error('temp_cutover_'+s)};
const now=()=>new Date().toISOString();
function rootOf(root) {
  if(typeof root!=='string'||!path.isAbsolute(root))fail('root_not_absolute');
  const temp=fs.realpathSync(os.tmpdir());
  const base=path.basename(root);
  if(!/^prhm-cutover-fixture-[A-Za-z0-9_-]+$/.test(base)||
    path.dirname(root)!==temp||fs.realpathSync(root)!==root)
    fail('nonfixture_root_forbidden');
  const st=fs.lstatSync(root);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||
     (st.mode & 0o077)!==0)fail('fixture_root_untrusted');
  return root;
}
function under(root,logical) {
  if(!ALL.includes(logical))fail('path_not_allowlisted');
  const parts=logical.slice(1).split('/');
  const full=path.join(root,...parts);
  if(!full.startsWith(root+path.sep))fail('path_escape');
  return full;
}
function checkTree(root,target) {
  const relative=path.relative(root,path.dirname(target));
  let current=root;
  for(const segment of relative.split(path.sep).filter(Boolean)) {
    current=path.join(current,segment);
    if(!fs.existsSync(current))continue;
    const st=fs.lstatSync(current);
    if(!st.isDirectory()||st.isSymbolicLink()||
       st.uid!==process.getuid()||(st.mode&0o022)!==0)
      fail('untrusted_fixture_parent');
  }
}
function readOld(root,logical) {
  const full=under(root,logical);
  checkTree(root,full);
  let st;
  try{st=fs.lstatSync(full)}catch(e){if(e.code==='ENOENT')return null;throw e}
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||
     (st.mode&0o022)!==0)fail('untrusted_fixture_file');
  return fs.readFileSync(full);
}
function mkdirParents(root,target) {
  const parts=path.relative(root,path.dirname(target)).split(path.sep).filter(Boolean);
  let p=root;
  for(const segment of parts) {
    p=path.join(p,segment);
    if(!fs.existsSync(p))fs.mkdirSync(p,{mode:0o700});
    const st=fs.lstatSync(p);
    if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||
      (st.mode&0o022)!==0)fail('untrusted_fixture_parent');
  }
}
function syncDir(dir) {
  const fd=fs.openSync(dir,'r');
  try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function durableWrite(root,target,bytes) {
  if(!Buffer.isBuffer(bytes))fail('candidate_not_buffer');
  mkdirParents(root,target);
  const temp=target+'.new-'+crypto.randomBytes(8).toString('hex');
  let wrote=false;
  try {
    const fd=fs.openSync(temp,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
    try {
      fs.writeFileSync(fd,bytes);
      fs.fsyncSync(fd);
      wrote=true;
    }finally{fs.closeSync(fd)}
    if(!wrote)fail('fsync_failed');
    fs.renameSync(temp,target);
    syncDir(path.dirname(target));
    if(!fs.readFileSync(target).equals(bytes))fail('verify_write_failed');
  }finally{try{fs.unlinkSync(temp)}catch(e){if(e.code!=='ENOENT')throw e}}
}
function appendJournal(root,record) {
  const file=path.join(root,'cutover-fixture-audit.jsonl');
  const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_APPEND|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  try{
    fs.writeSync(fd,JSON.stringify({schema_version:'prhm.cutover-fixture-audit.v1',
      at:now(),fixture_only:true,production_mutation:false,...record})+'\n');
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd)}
}
function snapshot(root) {
  const all=new Map();
  for(const logical of ALL)all.set(logical,readOld(root,logical));
  for(const logical of PREEXISTING)if(all.get(logical)===null)fail('preimage_missing');
  for(const logical of NEW)if(all.get(logical)!==null)fail('unexpected_existing_candidate');
  return all;
}
function backup(root,state) {
  const dir=path.join(root,'cutover-backup-'+crypto.randomBytes(8).toString('hex'));
  fs.mkdirSync(dir,{mode:0o700});
  for(const [logical,bytes] of state)if(bytes!==null) {
    const name=sha(Buffer.from(logical));
    durableWrite(root,path.join(dir,name),bytes);
  }
  const manifest=[...state].map(([p,b])=>({logical:p,present:b!==null,sha256:b!==null?sha(b):null}));
  durableWrite(root,path.join(dir,'manifest.json'),Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
  syncDir(dir);syncDir(root);
  return {dir,manifest};
}
function restore(root,initial,bkp) {
  // Recover from the *on-disk* backed-up bytes, not a mock return value.
  for(const [logical,expected] of initial) {
    const target=under(root,logical);
    const stored=expected===null?null:fs.readFileSync(path.join(bkp.dir,sha(Buffer.from(logical))));
    if(stored===null) {
      try{fs.unlinkSync(target)}catch(e){if(e.code!=='ENOENT')throw e}
    } else durableWrite(root,target,stored);
  }
  for(const [logical,expected] of initial) {
    const current=readOld(root,logical);
    if(current===null&&expected===null)continue;
    if(current===null||expected===null||sha(current)!==sha(expected))
      fail('rollback_verification_failed');
  }
  syncDir(root);
}
function run(options) {
  if(!options||Object.keys(options).sort().join('|')!==['failureAt','inputs','mode','root'].sort().join('|')||
    options.mode!=='isolated-temp-filesystem')fail('test_only_invocation');
  if(options.failureAt!==null&&!CHECKPOINTS.includes(options.failureAt))
    fail('unknown_failure_point');
  const root=rootOf(options.root);
  const lock=path.join(root,'.cutover-test-lock');
  fs.mkdirSync(lock,{mode:0o700}); // exclusive; concurrency = deny.
  let initial,bkp,step='preflight',begun=false;
  try {
    initial=snapshot(root);
    const actual=new Map(PREEXISTING.map(logical=>[logical,initial.get(logical)]));
    const inputs={...options.inputs,mode:'isolated-memory-fixture',state:actual,failureAt:null};
    const preflight=fixture.simulate(inputs);
    if(preflight.ok!==true||preflight.fixture_only!==true)
      fail('preflight_denied');
    bkp=backup(root,initial);
    appendJournal(root,{event:'preimage_backed_up',backup_sha256:sha(Buffer.from(
      JSON.stringify(bkp.manifest)))});
    function point(name) {
      step=name;
      appendJournal(root,{event:'candidate_checkpoint',checkpoint:name});
      if(options.failureAt===name)fail('injected_'+name);
    }
    begun=true;
    durableWrite(root,under(root,PATHS.POLICY),options.inputs.policyCandidate);
    point('policy_written');
    durableWrite(root,under(root,PATHS.HELPER),options.inputs.dispatcher);
    point('helper_written');
    durableWrite(root,under(root,PATHS.CORE),options.inputs.core);
    point('core_written');
    durableWrite(root,under(root,PATHS.GATE),options.inputs.gatedSudoers);
    for(const logical of [PATHS.ARANOB,PATHS.HONARTIK])fs.unlinkSync(under(root,logical));
    point('sudoers_swapped');
    point('health_check'); // No real health call; contract already mocked.
    for(const logical of NEW) {
      const current=readOld(root,logical);
      if(current===null)fail('missing_candidate');
    }
    if(readOld(root,PATHS.ARANOB)!==null||readOld(root,PATHS.HONARTIK)!==null)
      fail('legacy_grants_remain');
    appendJournal(root,{event:'fixture_install_success'});
    return Object.freeze({ok:true,fixture_only:true,installed_on_host:false,
      execution_authorized:false,backup_dir:bkp.dir});
  }catch(err){
    if(begun&&bkp) {
      try {
        restore(root,initial,bkp);
        appendJournal(root,{event:'fixture_rollback',at_step:step,verified:true});
        return Object.freeze({ok:false,rollback_verified:true,fixture_only:true,
          installed_on_host:false,execution_authorized:false,failed_at:step});
      }catch(rollbackError) {
        appendJournal(root,{event:'fixture_rollback_failed',at_step:step,
          rollback_error:'REQUIRES_MANUAL_SANDBOX_RECOVERY'});
        throw new AggregateError([err,rollbackError],'temp_cutover_rollback_failed');
      }
    }
    throw err;
  }finally{fs.rmdirSync(lock)}
}
module.exports=Object.freeze({run,PATHS,CHECKPOINTS});
