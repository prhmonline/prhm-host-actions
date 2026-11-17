import {readFile,open,rename,mkdir,access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SCHEMA as EVIDENCE_SCHEMA,RUNTIME_DIR} from './collect.mjs';

export const STATE_SCHEMA='prhm.solo.developer-triage.v1';
const ROOT='/var/lib/prhm-developer-triage';
const MAX_PROPOSALS=1024;
const fail=c=>{throw Object.assign(new Error(c),{code:c})};
const CODE=/^[a-z0-9_]{1,48}$/;
const JOB=/^[a-z0-9-]{1,80}$/;
const HASH=/^[a-f0-9]{64}$/;
const PROJECTS=new Set(['cfpark','multisite','honartik_plan']);
function recommendation(project,codes){
  if(project==='honartik_plan'&&codes.some(c=>/seat_math|seat_markup|login_return|showtime/.test(c)))
    return 'inspect_guest_plan_regression';
  if(codes.some(c=>/http|site|frontend|dashboard|login_page/.test(c)))
    return 'investigate_public_endpoint_regression';
  if(codes.some(c=>/git_clean|git_main_branch|git_sha/.test(c)))
    return 'verify_git_integrity';
  return 'triage_qa_regression';
}
export function validateEvidence(data){
  if(data?.schema!==EVIDENCE_SCHEMA||!Array.isArray(data.findings)||
      data.findings.length>288)fail('developer_evidence_invalid');
  const seen=new Set();
  return data.findings.map(item=>{
    if(!item||!HASH.test(item.fingerprint)||!PROJECTS.has(item.project)||
       !JOB.test(item.qa_job_id)||!['critical','warning'].includes(item.severity)||
       !Array.isArray(item.failed_checks)||item.failed_checks.length>20||
       !Number.isSafeInteger(item.updated_at)||item.updated_at<0)
      fail('developer_evidence_invalid');
    for(const v of item.failed_checks){
      if(!v||!CODE.test(v.id)||!['fail','warn'].includes(v.result))
        fail('developer_evidence_invalid');
    }
    if(seen.has(item.fingerprint))fail('developer_evidence_duplicate');
    seen.add(item.fingerprint);
    return item;
  });
}
export async function atomicWrite(file,data){
  const dir=dirname(file);
  await mkdir(dir,{recursive:true,mode:0o700});
  const temp=join(dir,'.dev-'+randomUUID());
  const handle=await open(temp,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(data)+'\n');await handle.sync()}
  finally{await handle.close()}
  await rename(temp,file);
  const dirHandle=await open(dir,'r');
  try{await dirHandle.sync()}finally{await dirHandle.close()}
}
export async function runOnce({evidence,loadState,saveState,stopped,now=Date.now()}={}){
  if(typeof loadState!=='function'||typeof saveState!=='function'||
     typeof stopped!=='function')fail('developer_dependencies_missing');
  if(await stopped())return {status:'stopped',processed:0};
  const findings=validateEvidence(evidence);
  const state=await loadState();
  if(state?.schema!==STATE_SCHEMA||!Array.isArray(state.proposals)||
     state.proposals.length>MAX_PROPOSALS)fail('developer_state_corrupt');
  const known=new Set();
  for(const proposal of state.proposals){
    if(!HASH.test(proposal?.fingerprint)||known.has(proposal.fingerprint))
      fail('developer_state_corrupt');
    known.add(proposal.fingerprint);
  }
  let added=0;
  for(const item of findings){
    if(known.has(item.fingerprint))continue;
    if(state.proposals.length>=MAX_PROPOSALS)fail('developer_triage_capacity');
    if(await stopped())return {status:'stopped',processed:0};
    const suggestion=recommendation(item.project,item.failed_checks.map(x=>x.id));
    state.proposals.push({
      id:'dev-'+item.fingerprint.slice(0,20),
      fingerprint:item.fingerprint,
      project:item.project,
      qa_job_id:item.qa_job_id,
      severity:item.severity,
      check_codes:item.failed_checks.map(x=>x.id),
      action_code:suggestion,
      status:'awaiting_human_review',
      source_repository:null,
      source_commit:null,
      code_changes_made:false,
      pull_request_created:false,
      deployment_performed:false,
      created_at:now
    });
    known.add(item.fingerprint);
    added++;
  }
  if(added)await saveState(state);
  return {status:added?'proposals_created':'idle',new_proposals:added,
    total_proposals:state.proposals.length,code_changes_made:false,
    pull_requests_created:false,production_mutations:0};
}
async function main(){
  if(process.argv.length!==3||!['--once','--status'].includes(process.argv[2]))
    fail('developer_mode_required');
  if(process.env.SOLO_DEVELOPER_STATE_DIR!==ROOT)
    fail('developer_state_path_not_allowed');
  const file=join(ROOT,'proposals.json');
  const stop=join(ROOT,'STOP');
  const stopped=async()=>{try{await access(stop);return true}
    catch(e){if(e.code==='ENOENT')return false;throw e}};
  const loadState=async()=>{try{return JSON.parse(await readFile(file,'utf8'))}
    catch(e){if(e.code==='ENOENT')return {schema:STATE_SCHEMA,proposals:[]};throw e}};
  const state=await loadState();
  if(process.argv[2]==='--status'){
    if(state.schema!==STATE_SCHEMA||!Array.isArray(state.proposals))
      fail('developer_state_corrupt');
    process.stdout.write(JSON.stringify({schema:state.schema,stopped:await stopped(),
      total:state.proposals.length,recent:state.proposals.slice(-5).map(x=>({
        id:x.id,project:x.project,qa_job_id:x.qa_job_id,
        severity:x.severity,action_code:x.action_code,status:x.status
      }))})+'\n');return;
  }
  if(await stopped()){process.stdout.write('{"status":"stopped","processed":0}\n');return}
  const evidence=JSON.parse(await readFile(join(RUNTIME_DIR,'evidence.json'),'utf8'));
  const report=await runOnce({evidence,loadState,
    saveState:value=>atomicWrite(file,value),stopped});
  process.stdout.write(JSON.stringify(report)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(e=>{
    process.stderr.write('DEV_TRIAGE_ERROR='+String(e?.code||'triage_failed').slice(0,72)+'\n');
    process.exitCode=2;
  });
