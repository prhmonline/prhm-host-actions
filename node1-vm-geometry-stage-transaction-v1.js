'use strict';
// Node1 SHA-pinned release staging transaction.
// Deliberately NOT a production installer. No service, Agent3 registry, SSH,
// keys, VM, DB, network or live paths are changed by this module.
// The included filesystem adapter can stage ONLY into an isolated temp fixture.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const bundle=require('./node1-vm-geometry-attested-bundle-v1');
const owner=require('./node1-vm-geometry-deploy-preflight-v1');
const FILES=bundle.FILES;
function deny(ok,code){if(!ok)throw Error(code)}
function sortedKeys(o){return Object.keys(o).sort().join('|')}
function checkSourceBytes(files){
 const proof=bundle.inspectFiles(files);
 deny(proof.exact_blobs_match,'source_blob_verification_failed');
 for(const f of FILES){const b=files[f.path];deny(b.length>0&&b.length<=1024*1024,'source_file_size_invalid')}
 return true;
}
function releasePlan(){
 return Object.freeze({
   schema_version:'prhm.node1-geometry-release-stage.v1',
   release_revision:bundle.SOURCE_REVISION,
   files:FILES,
   stage_only:true,production_activation:false,
   agent3_registration:false,
   requires_explicit_level4_for_deployment:true,
   no_git_history_reset:true,
   stop_on_unverified_owner:true,
   stop_on_missing_release_log:true,
   rollback_on_stage_failure:true
 });
}
function stageCandidate({sources,observedOwners,store}={}){
 deny(store&&['begin','writeExclusive','readBack','record','seal','rollback'].every(k=>typeof store[k]==='function'),'stage_adapter_incomplete');
 deny(sources&&typeof sources==='object'&&!Array.isArray(sources),'source_map_missing');
 // Source and active owner hashes are verified BEFORE touching the staging adapter.
 checkSourceBytes(sources);
 const ownerProof=owner.validateObserved(observedOwners);
 deny(ownerProof.ok,'installed_agent_owner_mismatch');
 let began=false;
 try {
   store.begin();began=true;
   for(const file of FILES){
     store.writeExclusive(file.path,sources[file.path],0o600);
     const bytes=store.readBack(file.path);
     deny(Buffer.isBuffer(bytes)&&bundle.gitBlobSha(bytes)===file.sha,'staged_blob_verify_failed:'+file.path);
   }
   store.record({event:'stage_preseal_verified',revision:bundle.SOURCE_REVISION,count:FILES.length});
   store.seal();
   store.record({event:'stage_sealed',revision:bundle.SOURCE_REVISION,count:FILES.length});
   return Object.freeze({schema_version:'prhm.node1-stage-result.v1',staged:true,
     source_revision:bundle.SOURCE_REVISION,verified_files:FILES.length,
     owner_baseline_verified:true,production_mutation:false,
     active_services_changed:false,agent3_registered:false,ready_for_production:false});
 }catch(err){
   if(began){try{store.rollback();}catch{throw Error('stage_rollback_failed')}}
   throw err;
 }
}
// Real disk writes are allowed ONLY in an ephemeral isolated TEST fixture.
function makeSandboxStore(root){
 deny(typeof root==='string'&&path.isAbsolute(root),'sandbox_root_invalid');
 const real=fs.realpathSync(root);
 deny(path.dirname(real)===fs.realpathSync(os.tmpdir())&&path.basename(real).startsWith('node1-release-sandbox-'),'non_sandbox_path_denied');
 const st=fs.lstatSync(real);
 deny(st.isDirectory()&&!st.isSymbolicLink()&&(st.mode&0o077)===0,'sandbox_permissions_invalid');
 const temp=path.join(real,'candidate-tmp'),final=path.join(real,'candidate-sealed');
 let phase='initial';
 const allow=rel=>{
   deny(FILES.some(f=>f.path===rel)&&/^[a-z0-9.-]+\.js$/.test(rel),'sandbox_file_not_allowlisted');
   return path.join(temp,rel);
 };
 return Object.freeze({
   begin(){
     deny(phase==='initial','sandbox_already_used');
     deny(!fs.existsSync(temp)&&!fs.existsSync(final),'sandbox_not_empty');
     fs.mkdirSync(temp,{mode:0o700});phase='begun';
   },
   writeExclusive(rel,bytes,mode){
     deny(phase==='begun','sandbox_not_writable');
     deny(Buffer.isBuffer(bytes)&&mode===0o600,'sandbox_write_invalid');
     const fd=fs.openSync(allow(rel),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,mode);
     try{fs.writeSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
   },
   readBack(rel){
     deny(phase==='begun','sandbox_read_invalid');
     const fd=fs.openSync(allow(rel),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
     try{
       const st=fs.fstatSync(fd);
       deny(st.isFile()&&st.size<=1024*1024,'staged_file_not_regular');
       return fs.readFileSync(fd);
     }finally{fs.closeSync(fd)}
   },
   record(entry){
     deny(phase==='begun'||phase==='sealed','sandbox_log_unavailable');
     deny(entry&&['stage_preseal_verified','stage_sealed'].includes(entry.event),'sandbox_log_event_invalid');
     const log=path.join(real,'release-events.jsonl');
     fs.appendFileSync(log,JSON.stringify(entry)+'\n',{encoding:'utf8',mode:0o600,flag:'a'});
     const logfd=fs.openSync(log,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
     try{fs.fsyncSync(logfd)}finally{fs.closeSync(logfd)}
   },
   seal(){
     deny(phase==='begun','sandbox_seal_invalid');
     fs.renameSync(temp,final);phase='sealed';
   },
   rollback(){
     if(phase!=='initial'){
       fs.rmSync(temp,{recursive:true,force:true});
       fs.rmSync(final,{recursive:true,force:true});
       phase='rolled_back';
     }
   },
   inspect(){return {phase,sealed:fs.existsSync(final),tempExists:fs.existsSync(temp),
     files:fs.existsSync(final)?fs.readdirSync(final).sort():[]}}
 });
}
module.exports={FILES,releasePlan,checkSourceBytes,stageCandidate,makeSandboxStore};
