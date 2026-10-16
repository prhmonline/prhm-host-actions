'use strict';
/*
 * Fixed-scope, read-only root evidence collector for Deploy Control L4.
 * No production installer, approval request, sudo command, service restart,
 * network, arbitrary path, environment or caller-selected SHA is accepted.
 * Outputs metadata only. Successful hashes NEVER authorize a cutover.
 */
const fs=require('node:fs');
const crypto=require('node:crypto');
const registration=require('./manifests/deploy-control-l4-fixed-action-source-registration-v1.json');
const runtime=require('./deploy-control-live-runtime-evidence-v1.cjs');
const tx=require('./deploy-control-l4-privileged-transaction-v1.cjs');
const HELPER=Object.freeze({
 path:'/opt/prhm-agent-selfmaint-exec/actions/installer-refresh-l4-binding-repair-state-v1.js',
 preimage_sha256:'b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e',
 postimage_sha256:'b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb'
});
const MAX_BYTES=4*1024*1024;
const SHA_RE=/^[a-f0-9]{64}$/;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const OWNER_PATHS=Object.freeze(Object.keys(registration.root_owner_preimages));
const ROOT_TARGETS=Object.freeze([
 ...OWNER_PATHS.map(path=>Object.freeze({
   path,expected_sha256:registration.root_owner_preimages[path],
   uid:runtime.checked[path][1],gid:runtime.checked[path][2],
   mode:runtime.checked[path][3],category:'root_owner'
 })),
 ...tx.LEGACY.map(({path,sha256})=>Object.freeze({
   path,expected_sha256:sha256,uid:0,gid:0,mode:0o440,category:'legacy_sudoers'
 })),
 Object.freeze({path:tx.STAGING.path,expected_sha256:tx.STAGING.sha256,
   uid:0,gid:0,mode:0o440,category:'staging_exception'}),
 Object.freeze({path:HELPER.path,expected_sha256:HELPER.preimage_sha256,
   uid:0,gid:0,mode:null,category:'reviewed_repair_helper'}),
 Object.freeze({path:tx.BACKUP.path,expected_sha256:tx.BACKUP.sha256,
   uid:0,gid:0,mode:null,category:'rollback_archive'})
]);
function readPinned(file){
 if(!ROOT_TARGETS.some(t=>t.path===file))throw Error('unreviewed_target_denied');
 const before=fs.lstatSync(file);
 if(!before.isFile()||before.isSymbolicLink()||before.size<1||before.size>MAX_BYTES)
   throw Error('unsafe_file_type_or_size');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
   const st=fs.fstatSync(fd);
   if(!st.isFile()||st.dev!==before.dev||st.ino!==before.ino||
      st.size!==before.size||st.uid!==before.uid||st.gid!==before.gid||
      st.mtimeMs!==before.mtimeMs)throw Error('source_changed_before_read');
   const bytes=fs.readFileSync(fd);
   const after=fs.fstatSync(fd);
   if(bytes.length!==st.size||after.dev!==st.dev||after.ino!==st.ino||
      after.size!==st.size||after.mtimeMs!==st.mtimeMs)
     throw Error('source_changed_during_read');
   return {sha256:hash(bytes),uid:st.uid,gid:st.gid,mode:st.mode&0o777};
 }finally{fs.closeSync(fd)}
}
function gatherEvidence(read=readPinned){
 if(typeof read!=='function')throw Error('read_only_adapter_required');
 if(OWNER_PATHS.length!==4||ROOT_TARGETS.length!==9||
    ROOT_TARGETS.some(t=>!SHA_RE.test(t.expected_sha256))||
    new Set(ROOT_TARGETS.map(t=>t.path)).size!==ROOT_TARGETS.length)
   throw Error('reviewed_target_manifest_invalid');
 const files=ROOT_TARGETS.map(t=>{
   let observed=null,problem=null;
   try{
     const x=read(t.path);
     if(!x||!SHA_RE.test(x.sha256)||!Number.isInteger(x.uid)||
        !Number.isInteger(x.gid)||!Number.isInteger(x.mode)||
        x.mode<0||x.mode>0o777)throw Error('unattested_observation');
     observed={sha256:x.sha256,uid:x.uid,gid:x.gid,mode:x.mode};
   }catch(e){problem=String(e.message||e).slice(0,100)}
   // The helper may legitimately be in either SHA-pinned reviewed state.
   // Presence of the postimage attests bytes only, NOT Level-4 authorization.
   const preimage_match=!!observed&&observed.sha256===t.expected_sha256;
   const postimage_match=t.category==='reviewed_repair_helper'&&
     !!observed&&observed.sha256===HELPER.postimage_sha256;
   const sha_match=preimage_match||postimage_match;
   const ownership_match=!!observed&&observed.uid===t.uid&&observed.gid===t.gid&&
     (t.mode===null?(observed.mode&0o022)===0:observed.mode===t.mode);
   return Object.freeze({category:t.category,path:t.path,expected_sha256:t.expected_sha256,
     observed_sha256:observed?.sha256||null,
     observed_uid:observed?.uid??null,observed_gid:observed?.gid??null,
     observed_mode:observed?.mode??null,sha_match,ownership_match,
     preimage_match,postimage_match,
     error:problem,match:sha_match&&ownership_match});
 });
 const fileMismatches=files.filter(x=>!x.match).map(x=>
   x.category==='reviewed_repair_helper'?'installer_refresh_helper_preimage_drift':
   x.category==='root_owner'?'root_owner_preimage_unverified_or_drift:'+x.path:
   x.category==='rollback_archive'?'rollback_archive_not_attested':
   'legacy_or_staging_boundary_drift:'+x.path);
 const helper=files.find(x=>x.path===HELPER.path);
 // The currently approved-to-review baseline helper is intentionally the OLD
 // fingerprint. The safer /run temporary-file helper is a future signed L4
 // remediation. Distinguish a verified preimage from an authorized postimage.
 const repairPending=helper?.match===true&&helper?.preimage_match===true;
 const postimageAlreadyPresent=helper?.match===true&&helper?.postimage_match===true;
 const blockers=[...fileMismatches,
   ...(repairPending?['installer_refresh_state_helper_repair_pending']:[]),
   ...(postimageAlreadyPresent?['installer_refresh_helper_postimage_signed_l4_not_attested']:[])];
 const helper_state=repairPending?'reviewed_preimage_repair_pending':
   postimageAlreadyPresent?'reviewed_postimage_signature_unattested':'missing_or_unreviewed_drift';
 // Fixed status labels explicitly prohibit any claim of host authorization.
 return Object.freeze({
   schema_version:'prhm.deploy-control-l4.fixed-readonly-root-evidence.v1',
   source_git_sha:registration.source_commit,
   files:Object.freeze(files),blockers:Object.freeze(blockers),
   // SHA-attested postimage is not a preimage nor proof of signed consent.
   file_preimage_attested:fileMismatches.length===0&&!postimageAlreadyPresent,
   reviewed_file_state_attested:fileMismatches.length===0,
   helper_reviewed_postimage_attested:postimageAlreadyPresent,
   root_owner_preimage_attested:files.filter(x=>x.category==='root_owner').every(x=>x.match),
   helper_state,helper_preimage_sha256:HELPER.preimage_sha256,
   helper_postimage_sha256:HELPER.postimage_sha256,
   helper_repair_pending:repairPending,
   issuer_health_attested:false,external_deploy_triggers_attested:false,
   effective_sudo_grants_attested:false,host_action_registered_attested:false,
   backup_restore_tested_on_host:false,signed_level4_verified:false,
   production_mutation:false,installation_authorized:false,
   may_install:false,read_only:true
 });
}
if(require.main===module){
 try{
   if(process.argv.length!==3||process.argv[2]!=='--read-only'||process.getuid?.()!==0)
     throw Error('root_read_only_flag_required');
   const report=gatherEvidence();
   process.stdout.write(JSON.stringify(report)+'\n');
   if(report.blockers.length)process.exitCode=2;
 }catch(e){
   process.stderr.write(JSON.stringify({ok:false,error:String(e.message).slice(0,120),
     read_only:true,production_mutation:false})+'\n');
   process.exitCode=3;
 }
}
module.exports=Object.freeze({ROOT_TARGETS,HELPER,readPinned,gatherEvidence});
