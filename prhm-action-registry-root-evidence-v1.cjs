'use strict';
/**
 * Production-safe metadata audit + executor read-only registration probe.
 *
 * This module is NOT a privileged route or a runner launcher. Fixed targets,
 * no shell, no arbitrary action, no credential or JWS storage. Root-only
 * audit uses exclusive per-request files with fsync for power-loss recovery.
 * Executor registration is NOT sufficient for MCP tool discovery.
 */
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const g=require('./prhm-action-registry-gateway-v1.cjs');
const release=require('./manifests/honartik-config-center-registry-release-v1.json');
const AUDIT_DIR='/var/lib/prhm-agent-selfmaint-exec/registry-audit-v1';
const EXEC_SOCKET='/run/prhm-agent-selfmaint-exec/exec.sock';
const TARGET=release.action;
const SOURCE=release.source_commit;
const MANIFEST='e269cb8ee6f6dc1010620134a8a3ffe57d248535';
const MANIFEST_SHA='111c2c38b6ad48e69a6f72974855b38d0932790335931fc5b128a3c37c3f5e49';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function check(ok,code){if(!ok)throw Error('registry_root_evidence_'+code)}
function exact(x,keys,code){
 check(x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).sort().join('|')===keys.slice().sort().join('|'),code);
}
function auditPayload(rec) {
 check(rec&&typeof rec==='object','audit_record_missing');
 const common=['request_id','action','project','source_commit','manifest_commit','manifest_sha256','result','rollback'];
 const good=rec.result==='registered';
 exact(rec,good?common:common.concat('failure_code'),'audit_schema');
 check(UUID.test(rec.request_id||'')&&rec.action===TARGET&&
  rec.project==='honartik'&&rec.source_commit===SOURCE&&
  rec.manifest_commit===MANIFEST&&rec.manifest_sha256===MANIFEST_SHA,
  'audit_release_or_request_mismatch');
 check(good?
    rec.rollback==='not_needed':
    rec.result==='failed'&&rec.rollback==='verified'&&
    typeof rec.failure_code==='string'&&rec.failure_code.length>0&&
    rec.failure_code.length<=160&&
    /^[a-zA-Z0-9_:. -]+$/.test(rec.failure_code),
  'audit_outcome_untrusted');
 const body={schema:'prhm.registry.audit.v1',...rec};
 const bytes=Buffer.from(g.canonicalJson(body)+'\n');
 check(bytes.length<2048,'audit_too_large');
 return Object.freeze({name:rec.request_id+'.json',bytes,sha256:sha(bytes)});
}
function appendAudit(record,{io=fs,dir=AUDIT_DIR,getuid=()=>process.getuid?.()}={}){
 check(getuid()===0,'audit_root_required');
 const p=auditPayload(record);
 const st=io.lstatSync(dir);
 check(st.isDirectory()&&!st.isSymbolicLink()&&io.realpathSync(dir)===dir&&
  st.uid===0&&st.gid===0&&(st.mode&0o777)===0o700,'audit_directory_untrusted');
 const file=path.join(dir,p.name);
 let fd;
 try {
  fd=io.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  const written=io.writeSync(fd,p.bytes,0,p.bytes.length);
  check(written===p.bytes.length,'audit_partial_write');
  io.fsyncSync(fd);
  const meta=io.fstatSync(fd);
  check(meta.isFile()&&!meta.isSymbolicLink()&&
   meta.uid===0&&meta.gid===0&&(meta.mode&0o777)===0o600&&
   meta.size===p.bytes.length,'audit_file_untrusted');
 }finally{if(fd!==undefined)io.closeSync(fd)}
 const dfd=io.openSync(dir,fs.constants.O_RDONLY|
   fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{
  const final=io.fstatSync(dfd);
  check(final.isDirectory()&&final.ino===st.ino&&final.dev===st.dev,
    'audit_dir_replaced');
  io.fsyncSync(dfd);
 }finally{io.closeSync(dfd)}
 return Object.freeze({written:true,request_id:record.request_id,
  record_sha256:p.sha256,durable:true});
}
function validateExecutorHealth(bytes,target=TARGET){
 check(target===TARGET,'executor_action_not_allowlisted');
 check(Buffer.isBuffer(bytes)&&bytes.length>30&&bytes.length<=32768,'health_response_invalid');
 let obj;try{obj=JSON.parse(bytes.toString('utf8'))}catch{throw Error('registry_root_evidence_health_json_invalid')}
 check(obj&&obj.ok===true&&obj.service==='prhm-agent-selfmaint-exec'&&
  Array.isArray(obj.host_actions_v2)&&
  obj.host_actions_v2.length<=200&&
  obj.host_actions_v2.every(x=>typeof x==='string'&&x.length<150),
  'executor_health_untrusted');
 return Object.freeze({executor_healthy:true,
   action_registered:obj.host_actions_v2.includes(TARGET),
   mcp_discovery_verified:false});
}
async function probeExecutorHealth({request=http.request}={}){
 check(typeof request==='function','health_transport_missing');
 const bytes=await new Promise((resolve,reject)=>{
  const req=request({socketPath:EXEC_SOCKET,path:'/health',method:'GET',
   timeout:5000,headers:{Accept:'application/json'}},res=>{
   if(res.statusCode!==200){res.resume();reject(Error('registry_root_evidence_health_http_status'));return}
   const parts=[];let total=0;
   res.on('data',c=>{
    total+=c.length;
    if(total>32768){req.destroy(Error('registry_root_evidence_health_too_large'));return}
    parts.push(c);
   });
   res.on('end',()=>resolve(Buffer.concat(parts)));
   res.on('error',reject);
  });
  req.on('timeout',()=>req.destroy(Error('registry_root_evidence_health_timeout')));
  req.on('error',reject);
  req.end();
 });
 return validateExecutorHealth(bytes);
}
module.exports=Object.freeze({AUDIT_DIR,EXEC_SOCKET,auditPayload,appendAudit,
 validateExecutorHealth,probeExecutorHealth});
