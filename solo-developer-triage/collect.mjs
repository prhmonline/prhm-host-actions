import {readFile,open,stat,rename,chmod,chown,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const SCHEMA='prhm.solo.dev-triage-evidence.v1';
export const SOURCES=Object.freeze([
  Object.freeze({id:'cfpark',schema:'prhm.solo.qa-agent.queue.v1',file:'/var/lib/private/prhm-solo-qa/queue.json'}),
  Object.freeze({id:'multisite',schema:'prhm.solo.multisite-smoke.queue.v1',file:'/var/lib/private/prhm-sites-smoke/queue.json'}),
  Object.freeze({id:'honartik_plan',schema:'prhm.solo.honartik-guest-plan.queue.v1',file:'/var/lib/private/prhm-honartik-plan-qa/queue.json'})
]);
export const RUNTIME_DIR='/run/prhm-developer-triage';
export const STATE_DIR='/var/lib/private/prhm-developer-triage';
const fail=code=>{throw Object.assign(new Error(code),{code})};
const ID=/^[a-z0-9-]{1,80}$/;
const CODE=/^[a-z0-9_]{1,48}$/;
const allowed=new Set(['pass','warn','fail']);
export function sanitizeQueue(source,raw,now=Date.now()){
  if(!source||!SOURCES.some(x=>x.id===source.id&&x.schema===source.schema)||
    raw?.schema!==source.schema||!Array.isArray(raw.jobs)||raw.jobs.length>1024)
    fail('developer_source_schema_invalid');
  const recent=raw.jobs.slice(-96);
  const out=[];
  for(const job of recent){
    if(!job||!ID.test(job.id)||!['queued','running','succeeded','failed'].includes(job.status)||
      !Number.isSafeInteger(job.updated_at)||job.updated_at<0||
      !Array.isArray(job.checks)||job.checks.length>20)
      fail('developer_qa_job_invalid');
    const bad=[];
    for(const check of job.checks){
      if(!check||!CODE.test(check.id)||!allowed.has(check.result))
        fail('developer_qa_check_invalid');
      if(check.result!=='pass')bad.push({id:check.id,result:check.result});
    }
    if(job.updated_at>now+300000||job.updated_at<now-172800000)continue;
    if(job.status!=='failed'&&job.severity!=='critical'&&job.severity!=='warning'&&bad.length===0)
      continue;
    const severity=job.status==='failed'||job.severity==='critical'||bad.some(x=>x.result==='fail')?'critical':'warning';
    const fingerprint=createHash('sha256').update(JSON.stringify([source.id,job.id,severity,bad])).digest('hex');
    out.push({fingerprint,project:source.id,qa_job_id:job.id,severity,
      failed_checks:bad,updated_at:job.updated_at,status:job.status});
  }
  return out;
}
export async function gather({load,now=Date.now()}={}){
  if(typeof load!=='function')fail('developer_reader_not_provided');
  const records=[];
  for(const source of SOURCES){
    let raw;
    try{raw=await load(source)}catch(e){fail('developer_source_unavailable_'+source.id+'_'+String(e?.code||'unknown').toLowerCase().replace(/[^a-z0-9_]/g,''))}
    records.push(...sanitizeQueue(source,raw,now));
  }
  if(records.length>288)fail('developer_findings_capacity');
  return Object.freeze({schema:SCHEMA,generated_at:now,findings:records});
}
export async function readNoFollow(file){
  const h=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const meta=await h.stat();
    if(!meta.isFile()||meta.size>1024*1024)fail('developer_qa_file_invalid');
    return JSON.parse(await h.readFile({encoding:'utf8'}));
  }finally{await h.close()}
}
async function fsyncDir(dir){
  const h=await open(dir,constants.O_RDONLY);
  try{await h.sync()}finally{await h.close()}
}
async function main(){
  if(process.argv.length!==3||process.argv[2]!=='--export')fail('developer_export_mode_required');
  if(process.getuid?.()!==0)fail('developer_root_collector_required');
  try{await access(join(STATE_DIR,'STOP'));process.stdout.write('DEVELOPER_STOPPED\n');return}
  catch(e){if(e.code!=='ENOENT')throw e}
  const evidence=await gather({load:source=>readNoFollow(source.file)});
  let meta;
  try{meta=await stat(RUNTIME_DIR)}catch{fail('developer_runtime_dir_unavailable')}
  if(!meta.isDirectory())fail('developer_runtime_directory_invalid');
  const tmp=join(RUNTIME_DIR,'.evidence-'+randomUUID()+'.tmp');
  const dest=join(RUNTIME_DIR,'evidence.json');
  const h=await open(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
  try{
    await h.writeFile(JSON.stringify(evidence)+'\n','utf8');
    await h.sync();
  }finally{await h.close()}
  await chown(tmp,meta.uid,meta.gid);
  await chmod(tmp,0o400);
  await rename(tmp,dest);
  await fsyncDir(RUNTIME_DIR);
  process.stdout.write(JSON.stringify({status:'sanitized',sources:SOURCES.length,findings:evidence.findings.length})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(e=>{
    process.stderr.write('DEV_COLLECT_ERROR='+String(e?.code||'collector_failed').slice(0,72)+'\n');
    process.exitCode=2;
  });
