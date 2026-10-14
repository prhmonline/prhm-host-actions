'use strict';
/**
 * Exact, READ-ONLY preflight of the immutable Agent 3 shared registry roots.
 * Describes the required root-owned 0700 directories, including the two
 * paths previously omitted from the transient runner's write allowlist.
 * No mkdir/chmod/chown/systemctl/token/approval side effects or CLI.
 */
const fs=require('node:fs');
const runner=require('./prhm-action-registry-independent-runner-contract-v1.cjs');
const release=require('./manifests/honartik-config-center-registry-release-v1.json');
const required=Object.freeze([
 ['runtime','/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v1'],
 ['runtime_manifests','/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v1/manifests'],
 ['staged_parent','/opt/prhm-agent-selfmaint-exec/staged'],
 ['staged_release','/opt/prhm-agent-selfmaint-exec/staged/honartik-config-center-v1'],
 ['backup','/var/backups/prhm-honartik-config-center-registration-v1'],
 ['once','/var/lib/prhm-agent-selfmaint-exec/registry-one-time-v1'],
 ['recovery_lock','/var/lib/prhm-agent-selfmaint-exec/registry-recovery-lock-v1'],
 ['audit','/var/lib/prhm-agent-selfmaint-exec/registry-audit-v1']
].map(([key,path])=>Object.freeze({key,path,uid:0,gid:0,mode:0o700})));
const PATHS=new Set(required.map(x=>x.path));
const PARENTS=Object.freeze({
 '/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v1':'/opt/prhm-agent-selfmaint-exec/actions',
 '/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v1/manifests':'/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v1',
 '/opt/prhm-agent-selfmaint-exec/staged':'/opt/prhm-agent-selfmaint-exec',
 '/opt/prhm-agent-selfmaint-exec/staged/honartik-config-center-v1':'/opt/prhm-agent-selfmaint-exec/staged',
 '/var/backups/prhm-honartik-config-center-registration-v1':'/var/backups',
 '/var/lib/prhm-agent-selfmaint-exec/registry-one-time-v1':'/var/lib/prhm-agent-selfmaint-exec',
 '/var/lib/prhm-agent-selfmaint-exec/registry-recovery-lock-v1':'/var/lib/prhm-agent-selfmaint-exec',
 '/var/lib/prhm-agent-selfmaint-exec/registry-audit-v1':'/var/lib/prhm-agent-selfmaint-exec'
});
function check(v,code){if(!v)throw Error('registry_bootstrap_preflight_'+code)}
function immutablePlan(){
 const roots=runner.sandboxPlan().systemd_properties.ReadWritePaths.split(' ');
 check(roots.length===9&&roots.length===new Set(roots).size,
   'runner_writepath_set_drift');
 for(const target of required){
  // A child may lie under an exact reviewed writable ancestor; new roots
  // must never authorize a broad /, /home, /var, /etc or /opt subtree.
  const allowed=roots.some(root=>target.path===root||target.path.startsWith(root+'/'));
  check(allowed,'missing_sandbox_writepath_'+target.key);
 }
 for(const forbidden of ['/','/opt','/home','/var','/var/lib','/etc','/root','/tmp'])
  check(!roots.includes(forbidden),'untrusted_broad_writepath');
 check(release.action==='honartik_config_center_readonly_enroll_v1'&&
  release.source_commit==='868ec0251688e30f30691c91390589e80d4f34f9',
  'fixed_release_changed');
 return Object.freeze({
  schema:'prhm.registry.bootstrap.preflight.v1',
  project:'honartik',required_dirs:required,preflight_only:true,
  creates_directories:false,requires_fresh_l4:true,
  source_only:true,production_mutation:false
 });
}
function inspect({io=fs,getuid=()=>process.getuid?.()}={}){
 check(getuid()===0,'root_readonly_preflight_required');
 const plan=immutablePlan();
 check(io&&typeof io.lstatSync==='function'&&
  typeof io.realpathSync==='function','unsafe_read_capability');
 const observed=new Map();
 function readDir(path){
  try{
   const stat=io.lstatSync(path);
   check(stat.isDirectory()&&!stat.isSymbolicLink()&&
    io.realpathSync(path)===path&&stat.uid===0&&stat.gid===0&&
    (stat.mode&0o022)===0,'unsafe_dir_'+path);
   return Object.freeze({present:true,mode:stat.mode&0o777});
  }catch(e){
   if(e?.code==='ENOENT')return Object.freeze({present:false,mode:null});
   throw e;
  }
 }
 const rows=[];
 for(const item of required){
  const parent=PARENTS[item.path];
  const parentObserved=observed.get(parent)||readDir(parent);
  const found=readDir(item.path);
  const status=!parentObserved.present?'PARENT_NOT_STAGED':
    !found.present?'MISSING':
    found.mode!==item.mode?'UNEXPECTED_MODE':'READY';
  rows.push(Object.freeze({...item,parent,status,
   actual_mode:found.mode}));
  observed.set(item.path,found);
 }
 const missing=rows.filter(x=>x.status!=='READY');
 return Object.freeze({schema:plan.schema,ready:missing.length===0,
  checked:rows.length,items:Object.freeze(rows),
  blockers:Object.freeze(missing.map(x=>x.key+':'+x.status)),
  production_mutation:false,approval_consumed:false});
}
module.exports=Object.freeze({immutablePlan,inspect,PATHS});
