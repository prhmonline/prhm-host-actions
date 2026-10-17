'use strict';
/**
 * NONROOT CI-ONLY native SO_PEERCRED binary provenance + reproducibility audit.
 * No installation, permissions, sockets, privileged action, or Production path.
 *
 * The digest is specific to this CI toolchain and Node headers: it MUST NOT
 * be used as a universal binary SHA or claimed to attest production runtime.
 * Root may not execute the compilation. All outputs live in mkdtemp(0700).
 */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..','..');
const relativeSource='ops/agent3-universal-backup/native-linux-so-peercred-addon.c';
const source=path.resolve(root,relativeSource);
const flags=Object.freeze([
 '-std=c11','-O2','-Wall','-Wextra','-Werror','-fPIC','-shared',
 '-fstack-protector-strong','-D_FORTIFY_SOURCE=2',
 '-Wl,-z,relro','-Wl,-z,now'
]);
function deny(code){throw Error('agent3_native_addon_build_audit_denied:'+code);}
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function output(executable,args,cwd=root){
 return cp.execFileSync(executable,args,{
  cwd,timeout:30000,maxBuffer:3*1024*1024,
  encoding:'utf8',stdio:['ignore','pipe','pipe']
 });
}
function headerDir(){
 const candidates=[
  path.resolve(path.dirname(process.execPath),'../include/node'),
  '/usr/include/node','/usr/local/include/node'
 ];
 const found=candidates.find(d=>fs.existsSync(path.join(d,'node_api.h')));
 if(!found)deny('node_api_headers_required');
 return found;
}
function preflight(){
 if(process.platform!=='linux')deny('linux_only');
 if(typeof process.getuid!=='function'||process.getuid()===0)
  deny('must_run_unprivileged');
 if(process.versions.node.split('.')[0]!=='20')
  deny('node20_required');
 if(!fs.statSync(source).isFile())deny('source_file_required');
 const tracked=cp.execFileSync('git',['show','HEAD:'+relativeSource],{
  cwd:root,timeout:15000,maxBuffer:1024*1024,
  stdio:['ignore','pipe','pipe']
 });
 const onDisk=fs.readFileSync(source);
 if(!tracked.equals(onDisk))deny('git_source_worktree_drift');
 const head=output('git',['rev-parse','--verify','HEAD']).trim();
 if(!/^[0-9a-f]{40}$/.test(head))deny('invalid_git_commit');
 return Object.freeze({head,source_sha256:sha(onDisk),headers:headerDir()});
}
function compile(temp,name,headers){
 const dest=path.join(temp,name,'peercred.node');
 const dir=path.dirname(dest);
 fs.mkdirSync(dir,{mode:0o700});
 const args=[...flags,'-I'+headers,source,'-o',dest,'-lm'];
 output('cc',args);
 if(!fs.statSync(dest).isFile())deny('compiled_binary_missing');
 return Object.freeze({path:dest,sha256:sha(fs.readFileSync(dest))});
}
function audit(){
 const info=preflight();
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'agent3-napi-audit-'));
 try{
  const a=compile(temp,'rebuild1',info.headers);
  const b=compile(temp,'rebuild2',info.headers);
  if(a.sha256!==b.sha256)deny('unreproducible_native_binary');
  const addon=require(a.path);
  if(!addon||typeof addon.readPeerCredentials!=='function')
   deny('native_symbol_missing');
  let failClosed=false;
  try{addon.readPeerCredentials(-1);}
  catch(e){failClosed=/peercred_/.test(String(e.message));}
  if(!failClosed)deny('native_negative_test_failed');
  const compiler=output('cc',['--version']).split('\n')[0].trim();
  const headerHash=sha(fs.readFileSync(path.join(info.headers,'node_api.h')));
  return Object.freeze({
   schema:'prhm.agent3.native-addon-reproducible-ci-review.v1',
   mode:'NONROOT_EPHEMERAL_CI_ONLY',
   git_head:info.head,
   source_sha256:info.source_sha256,
   binary_sha256_in_this_toolchain:a.sha256,
   reproducible_twice:true,
   node_version:process.versions.node,
   napi_version:process.versions.napi,
   node_header_sha256:headerHash,
   compiler_identification:compiler.slice(0,140),
   platform:process.platform,
   arch:process.arch,
   addon_exports_checked:true,
   kernel_peer_credential_integration_tested_here:false,
   production_binary_attested:false,
   production_node_fd_api_attested:false,
   root_listener_installed:false,
   signed_level4_consumed:false,
   production_mutation:false,
   release_ready:false
  });
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
if(require.main===module){
 if(process.argv.length!==3||process.argv[2]!=='--ci'){
  process.stderr.write('strict --ci mode only; no apply, install, deploy or root build\n');
  process.exitCode=64;
 }else{
  try{process.stdout.write(JSON.stringify(audit())+'\n');}
  catch(e){
   process.stderr.write(String(e.message||e)+'\n');
   process.exitCode=78;
  }
 }
}
module.exports=Object.freeze({flags,sha,preflight,audit});
