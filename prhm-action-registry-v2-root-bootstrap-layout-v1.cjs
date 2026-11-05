'use strict';
/**
 * READ-ONLY, source-only V2 bootstrap layout contract.
 * Neither a provisioning launcher nor permission to run one.
 * The independently approved, SHA-attested root bootstrap must provision
 * these fixed paths before the signed five-field route can be installed.
 * No mkdir/chown/chmod, approval request, service restart or CLI.
 */
const fs=require('node:fs');
const runner=require('./prhm-action-registry-v2-independent-runner-contract-v1.cjs');
const release=require('./manifests/honartik-config-center-registry-release-v2.json');
const stage=require('./manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json');
const vault=require('./prhm-action-registry-v2-root-sealed-token-vault-v1.cjs');
const socket=require('./prhm-action-registry-v2-isolated-socket-v1.cjs');
const base='/opt/prhm-agent-selfmaint-exec';
const state='/var/lib/prhm-agent-selfmaint-exec';
const required=Object.freeze([
 ['runtime',base+'/actions/shared-registry-v2','runner'],
 ['runtime_manifests',base+'/actions/shared-registry-v2/manifests','runner'],
 ['staged_parent',base+'/staged','bootstrap'],
 ['staged_release',base+'/staged/honartik-config-center-v1','runner'],
 ['backup','/var/backups/prhm-honartik-config-center-registration-v1','runner'],
 ['once',state+'/registry-one-time-v1','runner'],
 ['recovery_lock',state+'/registry-recovery-lock-v1','runner'],
 ['audit',state+'/registry-audit-v1','runner'],
 ['approval_vault',vault.DIR,'sidecar'],
 ['approval_socket',socket.SOCKET_DIR,'sidecar']
].map(([key,path,writer])=>Object.freeze({key,path,writer,uid:0,gid:0,mode:0o700})));
const PARENTS=Object.freeze({
 runtime:base+'/actions',
 runtime_manifests:base+'/actions/shared-registry-v2',
 staged_parent:base,
 staged_release:base+'/staged',
 backup:'/var/backups',
 once:state,
 recovery_lock:state,
 audit:state,
 approval_vault:state,
 approval_socket:'/run'
});
const FORBIDDEN=Object.freeze(['/','/opt','/home','/var','/var/lib','/etc','/root','/tmp','/run','/etc/systemd/system',base+'/staged',vault.DIR,socket.SOCKET_DIR]);
function check(x,code){if(!x)throw Error('registry_v2_bootstrap_layout_'+code)}
function immutablePlan(){
 const r=runner.sandboxPlan();
 const paths=r.systemd_properties.ReadWritePaths.split(' ');
 check(paths.length===9&&new Set(paths).size===9,'runner_scope_count_drift');
 check(stage.schema==='prhm.shared-registry.v2.reviewed-runtime-stage.v1'&&
   stage.status==='NOT_STAGED'&&stage.installation_authorized===false&&
   stage.level4_consumed===false&&stage.files.length===20&&
   stage.destination_root===required[0].path&&
   stage.v2_runner_recovery_lock_and_audit_write_scopes_verified_in_source===true&&
   stage.v2_runner_scope_source_commit===
     stage.files.find(x=>x.source_path==='prhm-action-registry-v2-independent-runner-contract-v1.cjs')?.source_commit,
   'stage_untrusted');
 check(release.project==='honartik'&&
   release.action==='honartik_config_center_readonly_enroll_v1'&&
   release.source_commit===stage.project_source_commit&&
   stage.approval_arguments_sha256===r.approval_arguments_sha256,
   'immutable_release_mismatch');
 check(socket.SOCKET_DIR==='/run/prhm-shared-registry-v2'&&
   socket.SOCKET===socket.SOCKET_DIR+'/registry.sock'&&
   vault.DIR===state+'/registry-approval-v2',
   'private_transport_location_drift');
 for(const item of required){
   const writable=paths.some(p=>item.path===p||item.path.startsWith(p+'/'));
   if(item.writer==='runner')check(writable,'runner_missing_write_scope_'+item.key);
   // Sidecar and bootstrap directories must not inherit a broad RW grant.
   if(item.writer==='sidecar'||item.key==='staged_parent')
     check(!paths.includes(item.path),'untrusted_runner_write_scope_'+item.key);
 }
 for(const bad of FORBIDDEN)check(!paths.includes(bad),'broad_runner_write_scope');
 check(new Set(required.map(r=>r.path)).size===10,'directory_collision');
 return Object.freeze({
   schema:'prhm.registry-v2.root-bootstrap-layout.v1',repo:'prhmonline/prhm-host-actions',
   source_commit:stage.project_source_commit,manifest_commit:stage.release_manifest_commit,
   manifest_sha256:stage.release_manifest_sha256,approval_arguments_sha256:stage.approval_arguments_sha256,
   required_dirs:required,runner_writepath_count:paths.length,
   strictly_source_only:true,installs:false,requires_new_signed_l4:true,
   rollback_rule:'remove_only_journaled_new_empty_directories_in_reverse_order',
   mutable_server_state:false
 });
}
function inspect({io=fs,getuid=()=>process.getuid?.()}={}){
 check(getuid()===0,'root_readonly_probe_required');
 const plan=immutablePlan(),cache=new Map();
 check(typeof io?.lstatSync==='function'&&typeof io?.realpathSync==='function',
   'trusted_reader_missing');
 function readDir(p){
   if(cache.has(p))return cache.get(p);
   let s;
   try{s=io.lstatSync(p)}
   catch(e){
     if(e?.code==='ENOENT'){
       const absent=Object.freeze({present:false,mode:null});cache.set(p,absent);return absent;
     }
     throw e;
   }
   check(s.isDirectory()&&!s.isSymbolicLink()&&io.realpathSync(p)===p&&
     s.uid===0&&s.gid===0&&(s.mode&0o022)===0,'unsafe_directory_'+p);
   const found=Object.freeze({present:true,mode:s.mode&0o777});
   cache.set(p,found);
   return found;
 }
 const items=required.map(item=>{
   const parent=PARENTS[item.key],p=readDir(parent),actual=readDir(item.path);
   const status=!p.present?'PARENT_NOT_READY':
     !actual.present?'MISSING':
     actual.mode!==item.mode?'UNEXPECTED_MODE':'READY';
   return Object.freeze({...item,parent,status,observed_mode:actual.mode});
 });
 // A private endpoint must not already be occupied at bootstrap time.
 // Do not unlink a stale socket; operator reconciliation is required.
 const socketPath=socket.SOCKET;
 let occupied=false;
 try{io.lstatSync(socketPath);occupied=true}
 catch(e){if(e?.code!=='ENOENT')throw e}
 const blockers=items.filter(x=>x.status!=='READY').map(x=>x.key+':'+x.status);
 if(occupied)blockers.push('APPROVAL_SOCKET_ALREADY_EXISTS');
 return Object.freeze({
   schema:plan.schema,ready_for_directory_stage:blockers.length===0,
   ready_for_install:false,checked:items.length,items:Object.freeze(items),
   blockers:Object.freeze(blockers),approval_consumed:false,production_mutation:false
 });
}
module.exports=Object.freeze({required,PARENTS,immutablePlan,inspect});
