'use strict';
/*
 * READ-ONLY, fixed-scope Production runtime attestation precursor.
 *
 * Identifies the exact live Node executable used by the active root-owned
 * prhm-agent-selfmaint-exec.service, executes that executable only with
 * --eval fixed literal read-only version metadata, and checks the PID/exe
 * has not changed during collection.
 *
 * No dynamic command/path, target selection, env exposure, process args,
 * sockets, compilation, chmod/chown, service restart, approval or install.
 * NOT a verification of undocumented net.Socket._handle.fd stability, not
 * an approved native binary, not a registry production release.
 */
const fs=require('node:fs');
const cp=require('node:child_process');
const lock=require('./native-v3-addon-ci-build-lock.json');
const SERVICE='prhm-agent-selfmaint-exec';
const FIXED='process.stdout.write(JSON.stringify({node:process.versions.node,napi:process.versions.napi,modules:process.versions.modules,uv:process.versions.uv,platform:process.platform,arch:process.arch,glibc:(process.report&&typeof process.report.getReport==="function"?process.report.getReport().header.glibcVersionRuntime:null)}))';
function deny(code){throw Error('agent3_prod_node_runtime_audit_denied:'+code);}
function systemdPID(){
 const response=cp.execFileSync('/usr/bin/systemctl',[
  'show',SERVICE,'-p','MainPID','-p','ActiveState','-p','SubState'
 ],{encoding:'utf8',timeout:5000,maxBuffer:1024,
   stdio:['ignore','pipe','ignore']});
 const m=Object.fromEntries(response.trim().split('\n').map(x=>x.split('=',2)));
 const pid=Number(m.MainPID);
 if(m.ActiveState!=='active'||m.SubState!=='running'||
    !Number.isSafeInteger(pid)||pid<2||pid>2147483647)
  deny('service_not_running_or_invalid_pid');
 return pid;
}
function inspectExecutable(pid){
 const exe='/proc/'+pid+'/exe';
 const st=fs.statSync(exe);
 if(!st.isFile())deny('process_exe_not_file');
 const target=fs.readlinkSync(exe);
 // Only an actual Node executable, not a wrapper or arbitrary server binary.
 if(!/(?:^|\/)(?:node|node\d+|prhm-node20)(?: \(deleted\))?$/.test(target))
  deny('unexpected_executable_identity');
 return Object.freeze({path:exe,target,ino:st.ino,dev:st.dev});
}
function probe(pid,exe){
 const child=cp.execFileSync(exe.path,['--eval',FIXED],{
  encoding:'utf8',timeout:6500,maxBuffer:2000,
  stdio:['ignore','pipe','ignore']
 });
 if(child.length>1600)deny('runtime_report_oversize');
 let j;
 try{j=JSON.parse(child)}catch{deny('runtime_report_invalid_json');}
 return j;
}
function assess({pid,version,stable,liveUID,expectedNode=lock.node_version}={}){
 if(!Number.isSafeInteger(pid)||pid<2||
    !version||typeof version!=='object'||Array.isArray(version)||
    typeof stable!=='boolean'||!Number.isSafeInteger(liveUID))
  deny('invalid_fixed_evidence');
 const node=String(version.node||'');
 const napi=String(version.napi||'');
 const arch=String(version.arch||'');
 const platform=String(version.platform||'');
 const blockers=[];
 if(!stable)blockers.push('LIVE_PID_OR_EXECUTABLE_DRIFT');
 if(liveUID!==0)blockers.push('EXECUTOR_SERVICE_IDENTITY_DRIFT');
 if(node!==expectedNode)blockers.push('NODE_VERSION_DIFFERS_FROM_PINNED_CI');
 if(napi!==String(lock.napi_version))blockers.push('NODE_NAPI_VERSION_DIFFERS_FROM_CI');
 if(platform!=='linux'||arch!==lock.arch)
  blockers.push('NODE_PLATFORM_OR_ARCH_MISMATCH');
 if(version.glibc===null||!/^2\.\d+$/.test(String(version.glibc)))
  blockers.push('GLIBC_RUNTIME_VERSION_NOT_OBSERVED');
 return Object.freeze({
  schema:'prhm.agent3.native-v3-production-node-runtime-readonly.v1',
  mode:'READ_ONLY_PRODUCTION_METADATA',
  service:SERVICE,
  live_main_pid:pid,
  live_runtime:Object.freeze({
   node,napi,modules:String(version.modules||''),
   uv:String(version.uv||''),platform,arch,
   glibc_runtime:String(version.glibc||'UNAVAILABLE')
  }),
  ci_review_node_version:lock.node_version,
  ci_review_napi_version:String(lock.napi_version),
  target_process_stable_during_read:stable,
  blockers:Object.freeze(blockers),
  exact_node_runtime_matches_ci:
   node===expectedNode&&napi===String(lock.napi_version)&&
   platform==='linux'&&arch===lock.arch&&stable,
  linux_kernel_peercred_supported: 'PREVIOUSLY_OBSERVED_NOT_RETESTED',
  production_native_addon_binary_attested:false,
  undocumented_node_fd_binding_reviewed:false,
  native_listener_installed:false,
  four_owner_dispatch_installed:false,
  signed_level4_consumed:false,
  production_mutation:false,
  release_ready:false
 });
}
function run(){
 if(process.platform!=='linux')deny('linux_only');
 if(process.getuid?.()!==0)deny('root_readonly_proc_access_required');
 const pid=systemdPID();
 const exe=inspectExecutable(pid);
 const stat=fs.statSync('/proc/'+pid);
 const version=probe(pid,exe);
 const after=inspectExecutable(pid);
 const stable=systemdPID()===pid&&
   after.target===exe.target&&after.ino===exe.ino&&after.dev===exe.dev;
 const status=fs.readFileSync('/proc/'+pid+'/status','utf8');
 const uidLine=status.match(/^Uid:\s+(\d+)/m);
 if(!uidLine)deny('live_uid_status_missing');
 // /proc/<pid> also remains same inode even if PID was recycled.
 if(fs.statSync('/proc/'+pid).ino!==stat.ino)
  deny('live_proc_pid_recycled');
 return assess({pid,version,stable,liveUID:Number(uidLine[1])});
}
if(require.main===module){
 if(process.argv.length!==3||process.argv[2]!=='--check'){
  process.stderr.write('only --check is allowed; no apply/install/restart\n');
  process.exitCode=64;
 }else try{
  process.stdout.write(JSON.stringify(run())+'\n');
 }catch(e){
  process.stderr.write(String(e.message||e)+'\n');
  process.exitCode=78;
 }
}
module.exports=Object.freeze({SERVICE,assess,run});
