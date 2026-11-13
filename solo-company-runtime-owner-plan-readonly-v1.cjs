'use strict';
/**
 * ROOT-SHELL READ ONLY. Builds the same fixed six-file Solo native plan that
 * will later be signed. NO Root Adapter install, receipt issuer, or mutation.
 * Use only a clean, exact Git checkout under the fixed reviewed host path.
 */
const fs=require('node:fs');
const cp=require('node:child_process');
const path=require('node:path');
const tx=require('./solo-company-runtime-signed-registration-transaction-v1.js');
const receipt=require('./solo-company-runtime-provider-signed-receipt-v1.js');
const owner=require('./solo-company-runtime-owner-root-admission-v1.cjs');
const HOST='/var/tmp/solo-runtime-registration-review-20261103';
const SSH='/var/tmp/solo-runtime-sshagent-review-20261103';
const SOURCE_FILES=Object.freeze([
 'solo-company-runtime-l4-registration-candidate-v1.js',
 'solo-company-runtime-root-action-v1.js',
 'solo-company-runtime-signed-registration-transaction-v1.js',
 'solo-company-runtime-native-registration-bridge-v1.js',
 'solo-company-runtime-provider-signed-receipt-v1.js',
 'solo-company-runtime-owner-root-admission-v1.cjs',
 'solo-company-runtime-owner-plan-readonly-v1.cjs',
 'honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs',
 'solo-company-runtime-root-cutover-contract-v1.cjs',
 'solo-company-runtime-root-live-health-v1.cjs',
 'solo-company-runtime-owner-root-dispatcher-v1.cjs'
]);
const fail=x=>{throw Error('solo_owner_plan_'+x)};
function git(dir,args,{maxBuffer=1024*1024,label='git'}={}){
 // Git config must not depend on the operator's HOME, otherwise a valid
 // root-owned review directory may work in a shell but fail in this child.
 // Use -c safe.directory for THIS verified fixed review directory only,
 // never safe.directory='*' or a global production setting.
 if(dir!==HOST&&dir!==SSH)fail('git_directory_not_allowlisted');
 secureReview(dir);
 const gitBinary=['/usr/bin/git','/usr/local/bin/git'].find(p=>{
   try{const st=fs.statSync(p);return st.isFile()&&(st.mode&0o111)!==0}
   catch{return false}
 });
 if(!gitBinary)fail('git_executable_missing');
 const r=cp.spawnSync(gitBinary,['-c','safe.directory='+dir,'-C',dir,...args],{
   encoding:null,timeout:12000,maxBuffer,env:{PATH:'/usr/bin:/bin',LANG:'C'}});
 if(r.error)fail('git_spawn_failed:'+String(r.error.code||'unknown'));
 if(r.signal)fail('git_timeout_or_signal:'+label);
 if(r.status!==0){
   const err=String(r.stderr||'');
   const kind=/dubious ownership|unsafe repository/i.test(err)?'unsafe_repository':
     /not a git repository/i.test(err)?'not_repository':
     /bad object|invalid object|unknown revision|not a valid object/i.test(err)?'missing_commit':
     /does not exist in|exists on disk, but not in|path .*not in/i.test(err)?'missing_path':
     /not permitted|permission denied/i.test(err)?'permission':
     'other';
   fail('git_failed:'+label+':'+kind+':'+r.status);
 }
 return r.stdout;
}
function secureReview(dir){
 const s=fs.lstatSync(dir);
 if(!s.isDirectory()||s.isSymbolicLink()||fs.realpathSync(dir)!==dir||
    s.uid!==0||(s.mode&0o022)!==0)fail('review_directory_unsafe');
}
function attestHostCheckout(){
 secureReview(HOST);
 if(fs.realpathSync(__dirname)!==HOST)fail('wrong_host_checkout');
 const head=git(HOST,['rev-parse','HEAD']).toString('ascii').trim();
 if(!/^[a-f0-9]{40}$/.test(head))fail('git_head_invalid');
 const dirty=git(HOST,['status','--porcelain','--untracked-files=no']).toString('utf8');
 if(dirty.trim())fail('checkout_dirty');
 for(const rel of SOURCE_FILES){
   const file=path.join(HOST,rel),st=fs.lstatSync(file);
   if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o022)!==0)
     fail('review_source_unsafe:'+rel);
   const pinned=git(HOST,['show',head+':'+rel],{label:'host-file:'+rel});
   if(!fs.readFileSync(file).equals(pinned))fail('source_bytes_drift:'+rel);
 }
 return head;
}
function inspect(file){
 try{
   const st=fs.lstatSync(file);
   return {exists:true,is_file:st.isFile(),is_symlink:st.isSymbolicLink(),
     realpath:fs.realpathSync(file),uid:st.uid,gid:st.gid,
     mode:st.mode&0o777,bytes:fs.readFileSync(file)};
 }catch(e){if(e.code==='ENOENT')return {exists:false};throw e}
}
function pinnedGitRead({repository,commit,path:p}){
 const key=repository==='prhmonline/prhm-host-actions'?'host':
   repository==='prhmonline/sshagent'?'sshagent':null;
 if(!key||commit!==tx.SOURCE_COMMITS[key])fail('source_commit_mismatch');
 const allowed=key==='host'?'solo-company-runtime-root-action-v1.js':
   'mcp-server/src/plugins/soloCompanyRuntimeInstallCore.js';
 if(p!==allowed)fail('source_path_unapproved');
 const base=key==='host'?HOST:SSH;
 secureReview(base);
 return git(base,['show',commit+':'+p],{maxBuffer:1024*1024,label:key+'-source:'+p});
}
function prepareExactPlan(){
 if(process.getuid()!==0)fail('root_required');
 const hostHead=attestHostCheckout();
 const pub=fs.readFileSync(owner.KEY_FILE);
 owner.pinnedPublicKey(pub);
 const plan=tx.getPlan({inspect,pinnedGitRead});
 tx.verifyPlan(plan);
 const native=require('./solo-company-runtime-native-registration-bridge-v1.js')
   .convertExactPlan(plan);
 if(native.manifestSha256!==receipt.hashPlan(plan))fail('native_plan_mismatch');
 return Object.freeze({hostHead,plan,native});
}
function readOnlyPlan(){
 const {hostHead,plan,native}=prepareExactPlan();
 return {host_head:hostHead,plan_sha256:native.manifestSha256,
   release_sha:plan.release_sha,
   source_commits:plan.source_commits,
   steps:plan.steps.map(s=>({kind:s.kind,path:s.path,
     before_sha256:s.before_sha256,after_sha256:s.after_sha256,
     uid:s.uid,gid:s.gid,mode:s.mode})),
   owner_key_sha256:owner.KEY_PIN,production_mutation:false,
   authorized:false,receipt_issued:false};
}
if(require.main===module){
 try{
   if(process.argv.length!==3||process.argv[2]!=='--plan-readonly')
     fail('read_only_only');
   console.log(JSON.stringify(readOnlyPlan(),null,2));
 }catch(e){
   process.stderr.write('OWNER_PLAN_FAILED='+String(e.message).slice(0,220)+'\n');
   process.exitCode=2;
 }
}
module.exports=Object.freeze({HOST,SSH,SOURCE_FILES,attestHostCheckout,prepareExactPlan,readOnlyPlan});
