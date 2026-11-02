import {open,readFile,rename,mkdir,stat,access} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';

export const SCHEMA='prhm.solo.ops-auditor.queue.v1';
const MAX_RECORDS=1024;
const MAX_ATTEMPTS=2;
const STATES=new Set(['queued','running','succeeded','failed']);
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
function validate(data){
  if(data?.schema!==SCHEMA||!Array.isArray(data.jobs)||data.jobs.length>MAX_RECORDS)
    fail('auditor_queue_corrupt');
  const seen=new Set();
  for(const job of data.jobs){
    if(!job||typeof job.id!=='string'||!/^[a-z0-9-]{1,80}$/.test(job.id)||
      seen.has(job.id)||!STATES.has(job.status)||!Number.isInteger(job.attempts)||
      job.attempts<0||job.attempts>MAX_ATTEMPTS)
      fail('auditor_queue_corrupt');
    seen.add(job.id);
  }
  return data;
}
export class DurableAuditQueue{
  constructor({file,stopFile,now=Date.now}={}){
    if(typeof file!=='string'||!file.startsWith('/')||
       typeof stopFile!=='string'||!stopFile.startsWith('/'))fail('auditor_paths_invalid');
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
    if(state.jobs.length>=MAX_RECORDS)fail('auditor_queue_capacity_exceeded');
    state.jobs.push({id,status:'queued',attempts:0,created_at:this.now(),
      updated_at:this.now(),lease_expires_at:null,summary:null,error_code:null,evidence_count:0});
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
  async complete(id,{status,summary=null,errorCode=null,evidenceCount=0}={}){
    if(!['succeeded','failed'].includes(status))fail('auditor_final_status_invalid');
    const state=await this.snapshot(),job=state.jobs.find(j=>j.id===id);
    if(!job||job.status!=='running')fail('auditor_job_not_running');
    job.status=status;job.updated_at=this.now();
    job.lease_expires_at=null;
    job.summary=summary===null?null:String(summary).slice(0,160);
    job.evidence_count=Number.isInteger(evidenceCount)&&evidenceCount>=0&&evidenceCount<=8?evidenceCount:0;
    job.error_code=errorCode===null?null:String(errorCode).replace(/[^a-z0-9_]/g,'').slice(0,64);
    await atomicWrite(this.file,state);
    return structuredClone(job);
  }
}
export function makeBucketId(now=Date.now(),intervalMs=900_000){
  if(!Number.isSafeInteger(now)||now<0||intervalMs!==900_000)fail('auditor_bucket_invalid');
  return 'ops-health-'+Math.floor(now/intervalMs);
}
