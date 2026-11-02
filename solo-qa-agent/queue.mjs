import {open,readFile,rename,mkdir,stat,access} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';

export const SCHEMA='prhm.solo.qa-agent.queue.v1';
const MAX_RECORDS=1024;
const MAX_ATTEMPTS=2;
const STATES=new Set(['queued','running','succeeded','failed']);
const FINAL=new Set(['succeeded','failed']);
const fail=c=>{throw Object.assign(new Error(c),{code:c})};

async function fsyncDirectory(dir){
  const handle=await open(dir,'r');
  try{await handle.sync()}finally{await handle.close()}
}
async function atomicWrite(file,data){
  const parent=dirname(file);
  await mkdir(parent,{recursive:true,mode:0o700});
  const tmp=join(parent,'.queue-'+randomUUID()+'.tmp');
  const handle=await open(tmp,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(data)+'\n','utf8');await handle.sync()}
  finally{await handle.close()}
  await rename(tmp,file);
  await fsyncDirectory(parent);
}
async function archiveFinal(file,job){
  const dir=join(dirname(file),'archive');
  await mkdir(dir,{recursive:true,mode:0o700});
  const record=JSON.stringify(job)+'\n';
  const target=join(dir,job.id+'.json');
  let fd;
  try{fd=await open(target,'wx',0o600)}
  catch(e){
    if(e.code!=='EEXIST')throw e;
    if(await readFile(target,'utf8')!==record)fail('qa_archive_integrity_error');
    return;
  }
  try{await fd.writeFile(record,'utf8');await fd.sync()}
  finally{await fd.close()}
  await fsyncDirectory(dir);
}
async function compact(file,state){
  if(state.jobs.length<MAX_RECORDS)return;
  const n=state.jobs.length-512;
  const removable=state.jobs.filter(j=>FINAL.has(j.status)).slice(0,n);
  if(removable.length!==n)fail('qa_queue_unarchivable_capacity');
  for(const job of removable)await archiveFinal(file,job);
  const ids=new Set(removable.map(j=>j.id));
  state.jobs=state.jobs.filter(j=>!ids.has(j.id));
}
function validate(data){
  if(data?.schema!==SCHEMA||!Array.isArray(data.jobs)||data.jobs.length>MAX_RECORDS)
    fail('qa_queue_corrupt');
  const seen=new Set();
  for(const job of data.jobs){
    if(!job||typeof job.id!=='string'||!/^[a-z0-9-]{1,80}$/.test(job.id)||
      seen.has(job.id)||!STATES.has(job.status)||!Number.isInteger(job.attempts)||
      job.attempts<0||job.attempts>MAX_ATTEMPTS)
      fail('qa_queue_corrupt');
    seen.add(job.id);
  }
  return data;
}
export class DurableAuditQueue{
  constructor({file,stopFile,now=Date.now}={}){
    if(typeof file!=='string'||!file.startsWith('/')||
       typeof stopFile!=='string'||!stopFile.startsWith('/'))fail('qa_paths_invalid');
    this.file=file;this.stopFile=stopFile;this.now=now;
  }
  async snapshot(){
    try{return validate(JSON.parse(await readFile(this.file,'utf8')))}
    catch(e){if(e.code==='ENOENT')return {schema:SCHEMA,jobs:[]};throw e}
  }
  async stopped(){
    try{await access(this.stopFile);return true}
    catch(e){if(e.code==='ENOENT')return false;throw e}
  }
  async schedule(id){
    if(await this.stopped())return {stopped:true};
    const state=await this.snapshot();
    if(state.jobs.some(j=>j.id===id))return {duplicate:true};
    await compact(this.file,state);
    if(state.jobs.length>=MAX_RECORDS)fail('qa_queue_capacity_exceeded');
    state.jobs.push({id,status:'queued',attempts:0,created_at:this.now(),
      updated_at:this.now(),lease_expires_at:null,summary:null,error_code:null,evidence_count:0,checks:[],severity:'none'});
    await atomicWrite(this.file,state);return {enqueued:true};
  }
  async claim({leaseMs=120_000}={}){
    if(await this.stopped())return null;
    const state=await this.snapshot(),now=this.now();
    for(const job of state.jobs){
      if(job.status==='running'&&Number(job.lease_expires_at)<=now){
        job.status=job.attempts>=MAX_ATTEMPTS?'failed':'queued';
        job.error_code='lease_expired_recovered';
        job.updated_at=now;
      }
    }
    const job=state.jobs.find(j=>j.status==='queued');
    if(!job){await atomicWrite(this.file,state);return null}
    job.attempts+=1;job.status='running';job.updated_at=now;
    job.lease_expires_at=now+leaseMs;
    await atomicWrite(this.file,state);
    return structuredClone(job);
  }
  async complete(id,{status,summary=null,errorCode=null,evidenceCount=0,checks=[],severity='none'}={}){
    if(!['succeeded','failed'].includes(status))fail('qa_final_status_invalid');
    const state=await this.snapshot(),job=state.jobs.find(j=>j.id===id);
    if(!job||job.status!=='running')fail('qa_job_not_running');
    job.status=status;job.updated_at=this.now();
    job.lease_expires_at=null;
    job.summary=summary===null?null:String(summary).slice(0,160);
    job.evidence_count=Number.isInteger(evidenceCount)&&evidenceCount>=0&&evidenceCount<=12?evidenceCount:0;
    job.checks=Array.isArray(checks)?checks.slice(0,12).filter(x=>x&&/^[a-z0-9_]{1,48}$/.test(x.id)&&['pass','warn','fail'].includes(x.result)).map(x=>({id:x.id,result:x.result})):[];
    job.severity=['none','warning','critical'].includes(severity)?severity:'critical';
    job.error_code=errorCode===null?null:String(errorCode).replace(/[^a-z0-9_]/g,'').slice(0,64);
    await atomicWrite(this.file,state);
    return structuredClone(job);
  }
}
export function makeBucketId(now=Date.now(),intervalMs=1_800_000){
  if(!Number.isSafeInteger(now)||now<0||intervalMs!==1_800_000)fail('qa_bucket_invalid');
  return 'qa-cfpark-'+Math.floor(now/intervalMs);
}
