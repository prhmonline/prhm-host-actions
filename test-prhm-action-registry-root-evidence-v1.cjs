'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const stream=require('node:stream');
const EventEmitter=require('node:events');
const E=require('./prhm-action-registry-root-evidence-v1.cjs');
const uuid='a8c1de40-17bf-41c0-b26a-56ad9d1b30a7';
const record={request_id:uuid,action:'honartik_config_center_readonly_enroll_v1',
 project:'honartik',source_commit:'868ec0251688e30f30691c91390589e80d4f34f9',
 manifest_commit:'e269cb8ee6f6dc1010620134a8a3ffe57d248535',
 manifest_sha256:'111c2c38b6ad48e69a6f72974855b38d0932790335931fc5b128a3c37c3f5e49',
 result:'registered',rollback:'not_needed'};
function fixture(){
 const files=new Map();
 const fpath=E.AUDIT_DIR+'/'+uuid+'.json';
 const dir={isDirectory:()=>true,isSymbolicLink:()=>false,ino:88,dev:77,
  uid:0,gid:0,mode:0o40700};
 let opens=0,fsyncs=0;
 const io={
  lstatSync:p=>{assert.equal(p,E.AUDIT_DIR);return dir},
  realpathSync:p=>p,
  openSync:(p,flags,mode)=>{
   opens++;
   if(p===E.AUDIT_DIR)return {kind:'dir',flags};
   assert.equal(p,fpath);assert.equal(mode,0o600);
   if(files.has(p)){let error=Error('EEXIST');error.code='EEXIST';throw error}
   const handle={kind:'file',path:p,bytes:Buffer.alloc(0),flags};
   files.set(p,handle);return handle;
  },
  writeSync:(fd,b,offset,length)=>{
   assert.equal(fd.kind,'file');fd.bytes=Buffer.from(b.subarray(offset,offset+length));
   return length;
  },
  fsyncSync:fd=>{fsyncs++;assert.ok(['file','dir'].includes(fd.kind))},
  fstatSync:fd=>fd.kind==='dir'?dir:{
   isFile:()=>true,isSymbolicLink:()=>false,uid:0,gid:0,
   mode:0o100600,size:fd.bytes.length},
  closeSync:()=>{}
 };
 return {io,files,stats:()=>({opens,fsyncs}),fpath};
}
test('canonical audit metadata is bounded, fixed-scope and has no secret fields',()=>{
 const p=E.auditPayload(record);
 assert.equal(p.name,uuid+'.json');assert.match(p.sha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(JSON.parse(p.bytes),{schema:'prhm.registry.audit.v1',...record});
 assert.ok(!p.bytes.toString().includes('approval_token'));
});
test('append-only audit uses O_EXCL + fsync file and directory; refuses replay',()=>{
 const f=fixture();
 const first=E.appendAudit(record,{io:f.io,getuid:()=>0});
 assert.equal(first.written,true);assert.equal(first.durable,true);
 assert.equal(first.request_id,uuid);assert.equal(f.stats().fsyncs,2);
 assert.ok(f.files.has(f.fpath));
 const h=f.files.get(f.fpath);
 assert.equal(h.flags&fs.constants.O_EXCL,fs.constants.O_EXCL);
 assert.equal(h.flags&fs.constants.O_NOFOLLOW,fs.constants.O_NOFOLLOW);
 assert.throws(()=>E.appendAudit(record,{io:f.io,getuid:()=>0}),/EEXIST/);
 assert.equal(f.stats().fsyncs,2);
});
test('root, private audit directory and strict fields are required before write',()=>{
 const f=fixture();
 assert.throws(()=>E.appendAudit(record,{io:f.io,getuid:()=>1000}),/audit_root_required/);
 assert.equal(f.stats().opens,0);
 for(const bad of [
  {...record,project:'other'}, {...record,source_commit:'f'.repeat(40)},
  {...record,manifest_sha256:'f'.repeat(64)}, {...record,action:'other'},
  {...record,approval_token:'secret'}, {...record,rollback:'unknown'},
  {...record,result:'failed',rollback:'verified'}
 ])assert.throws(()=>E.appendAudit(bad,{io:f.io,getuid:()=>0}),
   /audit_schema|audit_release_or_request_mismatch|audit_outcome_untrusted/);
 assert.equal(f.stats().opens,0);
});
test('failed outcome is recorded only with bounded sanitized failure code',()=>{
 const r={...record,result:'failed',rollback:'verified',failure_code:'service_restart_failed'};
 assert.equal(E.auditPayload(r).name,uuid+'.json');
 for(const value of ['X'.repeat(170),'line\nwithsecret']){
  assert.throws(()=>E.auditPayload({...r,failure_code:value}),/audit_outcome_untrusted/);
 }
});
test('root-owned directory cannot be group writable, symlink or switched',()=>{
 for(const mutation of [
  {mode:0o40777},{uid:1000},{isSymbolicLink:()=>true},
  {isDirectory:()=>false}
 ]){
  const f=fixture(),st=f.io.lstatSync(E.AUDIT_DIR);Object.assign(st,mutation);
  assert.throws(()=>E.appendAudit(record,{io:f.io,getuid:()=>0}),
    /audit_directory_untrusted/);
  assert.equal(f.stats().opens,0);
 }
});
test('read-only executor health identifies registration but never asserts MCP discovery',()=>{
 const payload=Buffer.from(JSON.stringify({ok:true,
  service:'prhm-agent-selfmaint-exec',
  host_actions_v2:['other_v1',record.action]}));
 const p=E.validateExecutorHealth(payload);
 assert.deepEqual(p,{executor_healthy:true,action_registered:true,
  mcp_discovery_verified:false});
 const absent=E.validateExecutorHealth(Buffer.from(JSON.stringify({
  ok:true,service:'prhm-agent-selfmaint-exec',host_actions_v2:['other_v1']})));
 assert.equal(absent.action_registered,false);
 for(const raw of [
  Buffer.from('not json'),Buffer.from(JSON.stringify({
   ok:false,service:'prhm-agent-selfmaint-exec',host_actions_v2:[record.action]})),
  Buffer.from(JSON.stringify({
   ok:true,service:'unknown',host_actions_v2:[record.action]}))
 ])assert.throws(()=>E.validateExecutorHealth(raw),/health_response_invalid|health_json_invalid|executor_health_untrusted/);
 assert.throws(()=>E.validateExecutorHealth(payload,'other_v1'),/executor_action_not_allowlisted/);
});
test('health probe only uses fixed Unix socket GET /health, never an arbitrary URL',async()=>{
 const calls=[];
 function request(opts,callback){
  calls.push(opts);const req=new EventEmitter();
  req.end=()=>{
   const res=new stream.PassThrough();res.statusCode=200;callback(res);
   res.end(JSON.stringify({ok:true,
    service:'prhm-agent-selfmaint-exec',host_actions_v2:[]}));
  };
  req.destroy=error=>req.emit('error',error);
  return req;
 }
 const got=await E.probeExecutorHealth({request});
 assert.equal(got.action_registered,false);
 assert.equal(got.mcp_discovery_verified,false);
 assert.deepEqual(calls.map(x=>[x.socketPath,x.path,x.method]),
  [[E.EXEC_SOCKET,'/health','GET']]);
});
