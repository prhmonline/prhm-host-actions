'use strict';
/**
 * Bounded typed Agent 3 broker, not a network endpoint and NOT auto-installed.
 * The caller MUST provide a trusted platform authentication adapter; client
 * supplied actor IDs, approval strings, command lines and arbitrary paths never
 * cross the capability boundary. The service policy is snapshotted at startup.
 */
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {openConfinedRegularFile}=require('./agent3-confined-open');
const {createPlanner}=require('./universal-backup-policy');
const {createEncryptedBundle,verifyEncryptedBundle}=require('./agent3-encrypted-bundle.candidate');
const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const JOB=/^[a-f0-9]{64}$/;
function reject(reason){throw Error('broker_denied:'+reason);}
function exactly(o,fields){
 if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!fields.includes(k)))reject('request_schema');
}
function actor(raw){
 if(typeof raw!=='string'||!ID.test(raw))reject('actor');
 return raw;
}
function normalizePolicy(input){
 if(!input||!input.projects||typeof input.projects!=='object')reject('policy');
 const projects={};
 for(const [id,p] of Object.entries(input.projects)){
  if(!ID.test(id)||!p||!Array.isArray(p.readPaths)||!p.grants||typeof p.grants!=='object')reject('project');
  const actors={};
  for(const [a,caps] of Object.entries(p.grants)){
   actor(a);
   if(!Array.isArray(caps)||caps.some(x=>!['file.read','backup.create','backup.verify'].includes(x)))reject('capability');
   actors[a]=new Set(caps);
  }
  const allowed=new Set(p.readPaths);
  if(allowed.size!==p.readPaths.length)reject('read_paths');
  for(const name of allowed){
   if(typeof name!=='string'||name.startsWith('/')||name.includes('\\')||name.includes('\0')||
      name.split('/').some(x=>!x||x==='.'||x==='..'))reject('read_path');
  }
  projects[id]={root:p.root,destination:p.destination,grants:actors,readPaths:allowed,
    profiles:structuredClone(p.profiles)};
 }
 // Planner independently validates all source and destination paths.
 const registry={projects:Object.fromEntries(Object.entries(projects).map(([id,p])=>
  [id,{root:p.root,destination:p.destination,profiles:p.profiles}]))};
 const planner=createPlanner(registry);
 return {projects,planner};
}
async function appendAudit(file,record){
 if(typeof file!=='string'||!path.isAbsolute(file))reject('audit_path');
 const payload=Buffer.from(JSON.stringify(record)+'\n');
 const h=await fsp.open(file,fs.constants.O_WRONLY|fs.constants.O_APPEND|
    fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
 try{const st=await h.stat();if(!st.isFile()||(st.mode&0o077)!==0)reject('audit_permissions');
  await h.writeFile(payload);await h.sync();
 }finally{await h.close();}
}
function createPolicyBroker({registry,authenticate,keyProvider,auditSink}={}){
 if(typeof authenticate!=='function'||typeof keyProvider!=='function'||typeof auditSink!=='function')
  reject('trusted_adapters_required');
 const policy=normalizePolicy(registry);
 let serial=Promise.resolve();
 // Serialize operations within a process; backend lock prevents duplicate job writes
 // across processes. Actor identity comes exclusively from authenticated mediator.
 async function dispatch(input,transportIdentity){
  exactly(input,['project_id','operation','relative_path','profile_id','idempotency_key','job_id']);
  if(!ID.test(input.project_id||''))reject('project_id');
  if(!['file.read','backup.create','backup.verify'].includes(input.operation))reject('operation');
  const who=actor(await authenticate(transportIdentity));
  const p=policy.projects[input.project_id];
  if(!p||!p.grants[who]?.has(input.operation))reject('capability');
  const common={project_id:input.project_id,operation:input.operation};
  if(input.operation==='file.read'){
   exactly(input,['project_id','operation','relative_path']);
   if(!p.readPaths.has(input.relative_path))reject('file_not_allowlisted');
  }
  if(input.operation==='backup.create'){
   exactly(input,['project_id','operation','profile_id','idempotency_key']);
   if(!ID.test(input.profile_id||''))reject('profile');
  }
  if(input.operation==='backup.verify'){
   exactly(input,['project_id','operation','job_id']);
   if(!JOB.test(input.job_id||''))reject('job');
  }
  const audit={actor:who,project_id:input.project_id,operation:input.operation,
    request_id:crypto.randomUUID(),when:new Date().toISOString()};
  await auditSink({...audit,status:'requested'});
  try{
   let result;
   if(input.operation==='file.read'){
    const handle=await openConfinedRegularFile(p.root,input.relative_path);
    try{
     const st=await handle.stat();if(!st.isFile()||st.size<0||st.size>65536)reject('read_bounds');
     const bytes=await handle.readFile();
     if(bytes.length!==st.size)reject('source_changed');
     result={bytes:bytes.length,content:bytes.toString('utf8')};
    }finally{await handle.close();}
   }else if(input.operation==='backup.create'){
    const plan=policy.planner.planCreate({project_id:input.project_id,
       profile_id:input.profile_id,idempotency_key:input.idempotency_key});
    result=await createEncryptedBundle(plan,await keyProvider());
   }else{
    const bundle=path.join(await fsp.realpath(p.destination),input.job_id);
    const verified=await verifyEncryptedBundle(bundle,await keyProvider());
    result={verified:verified.verified,file_count:verified.file_count,encrypted:verified.encrypted};
   }
   await auditSink({...audit,status:'completed',success:true});
   return {...common,...result};
  }catch(e){
   try{await auditSink({...audit,status:'failed',error_code:String(e.message).slice(0,128)});}
   catch(e2){reject('audit_failure');}
   throw e;
  }
 }
 return Object.freeze({handle(input,transportIdentity){
   const result=serial.then(()=>dispatch(input,transportIdentity));
   serial=result.then(()=>undefined,()=>undefined);
   return result;
 }});
}
module.exports={createPolicyBroker,appendAudit};
