'use strict';
/**
 * Issue #217: fixed, READ-ONLY Linux preflight for a future native root adapter.
 * Source-only. No production registration, signed L4 or installer mutation.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const {CONTRACT}=require('./honartik-universal-installer-l4-v1.cjs');
const {readTree}=require('./honartik-universal-installer-native-fs-v1.cjs');

const PREFIX=CONTRACT.installer_prefix;
const OLD=CONTRACT.existing_digest;
const NEW=CONTRACT.candidate_digest;
const CANDIDATE='/var/tmp/honartik-universal-integrated-candidate-linux.tar.gz';
const ARCHIVE_SHA='e49ed1ce6366f87fad8dc2e46fd69c323c3cafb3729e90cdaaebe5421898212c';
const OWNER=Object.freeze({
 agent:['/opt/prhm-agent-selfmaint/server.js','4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406'],
 executor:['/opt/prhm-agent-selfmaint-exec/server.js','410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0'],
 mcp:['/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js','bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'],
 policy:['/opt/prhm-company-control-plane/config/approval-policy.json','148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174']
});
function deny(code){throw Error('honartik217_preflight_'+code)}
function requireValue(ok,code){if(!ok)deny(code)}
function hash(bytes){return crypto.createHash('sha256').update(bytes).digest('hex')}
function checkParents(file){
 let p=path.dirname(file);
 while(true){
  const st=fs.lstatSync(p);
  requireValue(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0,'parent_untrusted');
  // Sticky /var/tmp is a documented staging exception, not an install root.
  const stickyTmp=p==='/var/tmp'&&(st.mode&0o1777)===0o1777;
  requireValue((st.mode&0o022)===0||stickyTmp,'parent_writable');
  if(p==='/')break;
  p=path.dirname(p);
 }
}
function rootRead(filename,maxBytes=16777216){
 requireValue(path.isAbsolute(filename),'relative_path');
 checkParents(filename);
 const a=fs.lstatSync(filename);
 requireValue(a.isFile()&&!a.isSymbolicLink()&&a.uid===0&&
   (a.mode&0o022)===0&&a.size>0&&a.size<=maxBytes,'file_untrusted');
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const b=fs.fstatSync(fd);
  requireValue(b.isFile()&&b.uid===a.uid&&b.dev===a.dev&&
   b.ino===a.ino&&b.size===a.size&&b.mode===a.mode,'file_race');
  const bytes=fs.readFileSync(fd);
  requireValue(bytes.length===a.size,'short_read');
  return bytes;
 }finally{fs.closeSync(fd)}
}
function parseManifest(bytes){
 let data;
 try{data=JSON.parse(bytes.toString('utf8'))}catch{deny('manifest_json')}
 requireValue(data&&typeof data==='object'&&!Array.isArray(data)&&
  data.digest===OLD&&data.entrypoint===PREFIX+'/deploy-project'&&
  /^[a-f0-9]{64}$/.test(data.previous||'')&&
  data.activated_as_legacy_entrypoint===false,'manifest_mismatch');
 return data;
}
function checkCurrent(){
 const link=PREFIX+'/current';
 checkParents(link);
 const st=fs.lstatSync(link);
 requireValue(st.isSymbolicLink()&&st.uid===0,'current_pointer_untrusted');
 const expected=PREFIX+'/versions/'+OLD;
 requireValue(fs.readlinkSync(link)===expected&&
   fs.realpathSync(link)===expected,'current_pointer_drift');
 const dir=fs.lstatSync(expected);
 requireValue(dir.isDirectory()&&!dir.isSymbolicLink()&&
   dir.uid===0&&(dir.mode&0o022)===0,'bundle_directory_untrusted');
 return expected;
}
function validateRegistry(){
 rootRead(PREFIX+'/deploy-project',65536);
 const out=cp.spawnSync(PREFIX+'/deploy-project',
   ['validate','honartik_back','production'],{
     cwd:'/',shell:false,encoding:'utf8',timeout:20000,maxBuffer:262144,
     env:{PATH:'/usr/sbin:/usr/bin:/bin',LANG:'C',LC_ALL:'C'}
   });
 requireValue(!out.error&&out.status===0,'registry_cli_error');
 let res;
 try{res=JSON.parse(out.stdout)}catch{deny('registry_cli_json')}
 requireValue(res.valid===true&&res.project===CONTRACT.project&&
   res.digest===CONTRACT.registry_digest,'registry_digest_drift');
 return res.digest;
}
function inspectLivePreimage(){
 requireValue(typeof process.getuid==='function'&&process.getuid()===0,'root_required');
 const dir=checkCurrent();
 const manifest=parseManifest(rootRead(PREFIX+'/installation.json',8192));
 const installed=readTree(dir);
 requireValue(installed.digest===OLD,'installed_bytes_drift');
 requireValue(hash(rootRead(CANDIDATE,64*1024*1024))===ARCHIVE_SHA,
   'candidate_archive_sha_drift');
 const owners={};
 for(const [name,entry] of Object.entries(OWNER)){
  const actual=hash(rootRead(entry[0]));
  requireValue(actual===entry[1],'owner_sha_drift');
  owners[name]=actual;
 }
 const registry=validateRegistry();
 return Object.freeze({
  action:CONTRACT.action,installed_bundle_digest:installed.digest,
  candidate_expected_digest:NEW,candidate_archive_sha256:ARCHIVE_SHA,
  signed_candidate_provenance_verified:false,
  previous_digest:manifest.previous,registered_config_digest:registry,
  owner_preimages:Object.freeze(owners),
  root_adapter_registered:false,signed_l4_consumed:false,
  installer_upgraded:false,application_deployed:false,read_only:true
 });
}
module.exports=Object.freeze({
 CONTRACT,hash,parseManifest,inspectLivePreimage,
 NATIVE_REGISTRATION_IMPLEMENTED:false,PRODUCTION_EXECUTION_AUTHORIZED:false
});
