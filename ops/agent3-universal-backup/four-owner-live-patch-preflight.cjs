'use strict';
/**
 * Immutable live four-owner PATCH PREVIEW, never an installer.
 *
 * Read only. Requires root if run via CLI. Reads EXACTLY the four fixed
 * Control Plane owner files through O_NOFOLLOW descriptors, checks pinned
 * SHA-256 and metadata/races, checks the four fixed services via the existing
 * read-only collector, then obtains a deterministic in-memory proposal.
 *
 * NO files are written; no source bytes, keys, tokens or approval records
 * are printed. Critically: the proposal has NO VERIFIED EXECUTOR DISPATCH
 * and MUST NEVER be promoted directly as an installable manifest.
 */
const fs=require('node:fs');
const crypto=require('node:crypto');
const vm=require('node:vm');
const evidenceCollector=require('./four-owner-readonly-preflight.cjs');
const pinVerifier=require('./verify-pinned-owner-preimages.cjs');
const proposalBuilder=require('./four-owner-registration-patch-proposal.cjs');
const contract=require('./production-registration-contract.json');

const NAMES=Object.freeze(['base','executor','policy','mcp']);
const MAX_BYTES=20*1024*1024;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function deny(why){throw Error('agent3_live_patch_preflight_denied:'+why);}
function safeReadPinned(name){
 if(!NAMES.includes(name))deny('unlisted_owner');
 const filename=evidenceCollector.OWNERS[name];
 const st=fs.lstatSync(filename);
 if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(filename)!==filename||
    st.size<=0||st.size>MAX_BYTES||(st.mode&0o022)!==0)deny('unsafe_owner:'+name);
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const opened=fs.fstatSync(fd);
  if(opened.ino!==st.ino||opened.dev!==st.dev||opened.uid!==st.uid||
     opened.gid!==st.gid||opened.size!==st.size||
     (opened.mode&0o777)!==(st.mode&0o777))deny('owner_open_race:'+name);
  const bytes=fs.readFileSync(fd);
  const after=fs.fstatSync(fd);
  if(bytes.length!==opened.size||after.ino!==opened.ino||
     after.dev!==opened.dev||after.size!==opened.size||
     after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs)
   deny('owner_modified_during_read:'+name);
  if(sha(bytes)!==contract.preimage_sha256[name])deny('owner_pin_drift:'+name);
  return bytes;
 }finally{fs.closeSync(fd);}
}
function assess({evidence,ownerBytes,build=proposalBuilder.propose,verifyPin=pinVerifier.verify}){
 if(!evidence||!ownerBytes)deny('evidence_and_bytes_required');
 verifyPin({evidence,contract});
 if(Object.keys(ownerBytes).sort().join('|')!==NAMES.slice().sort().join('|'))
  deny('exact_owner_set_required');
 for(const k of NAMES){
  if(!Buffer.isBuffer(ownerBytes[k])||
     sha(ownerBytes[k])!==evidence.hashes[k])deny('bytes_not_bound_to_evidence:'+k);
 }
 const plan=build(ownerBytes);
 if(!plan||plan.action!==contract.action||
    plan.dispatcher_connected!==false||
    plan.execution_adapter_reviewed!==false||
    plan.ready_for_registration_manifest!==false||
    plan.registration_performed!==false||
    plan.approval_consumed!==false||
    plan.production_mutation!==false||
    !plan.candidate_buffers||!plan.after_sha256)
   deny('unsafe_proposal_status');
 if(Object.keys(plan.candidate_buffers).sort().join('|')!==NAMES.slice().sort().join('|')||
    Object.keys(plan.after_sha256).sort().join('|')!==NAMES.slice().sort().join('|'))
   deny('incomplete_postimage_set');
 for(const k of NAMES){
  const b=plan.candidate_buffers[k];
  if(!Buffer.isBuffer(b)||b.length<=0||
     sha(b)!==plan.after_sha256[k]||
     sha(b)===contract.preimage_sha256[k])deny('invalid_candidate:'+k);
  if(k==='policy'){
   const p=JSON.parse(b.toString('utf8'));
   if(p.operations?.[contract.operation]?.level!==4||
      !p.typed_scopes?.some(x=>x?.action===contract.action&&
       x?.risk==='critical'))deny('policy_postimage_missing');
  }else{
   new vm.Script(b.toString('utf8'),{filename:k+'.js'});
  }
 }
 return Object.freeze({
  ok:true,mode:'READ_ONLY_INCOMPLETE_PATCH_PREVIEW',
  action:contract.action,host:contract.host,owner_count:4,
  live_services_verified:4,
  before_sha256:Object.freeze({...evidence.hashes}),
  candidate_after_sha256:Object.freeze({...plan.after_sha256}),
  original_owner_bytes_disclosed:false,candidate_bytes_disclosed:false,
  execution_adapter_reviewed:false,dispatcher_connected:false,
  ready_for_registration_manifest:false,
  approval_requested:false,approval_consumed:false,
  registry_mutation:false,production_mutation:false,
  next_gate:'REVIEW_AND_BIND_TRUSTED_FIVE_FIELD_LEVEL4_EXECUTOR_BEFORE_MANIFEST'
 });
}
function run(){
 const evidence=evidenceCollector.collect();
 const ownerBytes=Object.fromEntries(NAMES.map(k=>[k,safeReadPinned(k)]));
 return assess({evidence,ownerBytes});
}
if(require.main===module){
 if(process.argv.length!==3||process.argv[2]!=='--check'){
  process.stderr.write('read-only --check only; no apply, register, stage or approval\n');
  process.exitCode=64;
 }else if(process.getuid?.()!==0){
  process.stderr.write('root-required-for-readonly-four-owner-evidence\n');
  process.exitCode=77;
 }else {
  try{process.stdout.write(JSON.stringify(run())+'\n');}
  catch(e){process.stderr.write(String(e.message||e)+'\n');process.exitCode=78;}
 }
}
module.exports=Object.freeze({NAMES,safeReadPinned,assess,run});
