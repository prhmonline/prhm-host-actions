'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const T=require('./prhm-action-registry-v2-root-approval-transport-v1.cjs');
const F=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const REQUEST='rootrequest0123456789abcdef',DECISION='rootdecision0123456789abcdef';
const ID='11111111-1111-4111-8111-111111111111';
const record=()=>({schema_version:'prhm.approval-request.v2',request_id:ID,
 action:F.REQUEST.action,project:'control_plane',
 arguments_sha256:F.ARGUMENTS_SHA,operation:'host_action.prhm_action_registry_install_v1',
 environment:'production',level:4,status:'pending',
 expires_at:new Date(Date.now()+120000).toISOString()});
function fakeHttp(responseFn=()=>({ok:true,request:record()})){
 const records=[];
 function requestFn(opts,handle){
  const req=new EventEmitter();
  let bytes=null;
  req.setTimeout=()=>{};
  req.end=x=>{
   bytes=x;
   records.push({opts,body:x?JSON.parse(x.toString('utf8')):undefined});
   const data=responseFn(opts,bytes?JSON.parse(bytes):undefined);
   const res=new EventEmitter();
   res.statusCode=data.status||200;
   res.resume=()=>{};
   handle(res);
   process.nextTick(()=>{
    if(data.status>=300)return;
    res.emit('data',Buffer.from(JSON.stringify(data.value??data)));
    res.emit('end');
   });
  };
  req.destroy=()=>{req.emit('error',Error('forced_destroy'))};
  return req;
 }
 return {requestFn,records};
}
const credentialReader=()=>({request:REQUEST,decision:DECISION});
function transport(r){
 return T.createTransport({
  requestFn:r.requestFn,
  credentialReader,
  getuid:()=>0
 });
}
test('root transport uses actual request GET endpoint, exact loopback port and bearer',async()=>{
 const fake=fakeHttp();
 const r=await transport(fake).getTrustedRequest(ID);
 assert.equal(r.request_id,ID);
 assert.equal(fake.records.length,1);
 assert.equal(fake.records[0].opts.host,'127.0.0.1');
 assert.equal(fake.records[0].opts.port,18133);
 assert.equal(fake.records[0].opts.method,'GET');
 assert.equal(fake.records[0].opts.path,'/v1/requests/'+ID);
 assert.equal(fake.records[0].opts.headers.authorization,'Bearer '+REQUEST);
 assert.equal(fake.records[0].body,undefined);
});
test('POST request and decision use distinct trusted tokens and no chosen URL',async()=>{
 const fake=fakeHttp();
 const c=transport(fake);
 await c.approvalHttp('POST','/v1/requests',REQUEST,{tool:'host_action_v2_apply'});
 await c.approvalHttp('POST','/v1/requests/'+ID+'/decision',
  DECISION,{decision:'accept',second_confirmation:F.CONFIRM});
 assert.equal(fake.records.length,2);
 assert.equal(fake.records[0].opts.headers.authorization,'Bearer '+REQUEST);
 assert.equal(fake.records[1].opts.headers.authorization,'Bearer '+DECISION);
 assert.deepEqual(fake.records[1].body,{
  decision:'accept',second_confirmation:F.CONFIRM});
});
test('validate and consume are only allowed over fixed AF_UNIX socket',async()=>{
 const fake=fakeHttp(()=>({ok:true,valid:true}));
 const c=transport(fake);
 const body={action:F.REQUEST.action,tool:'host_action_v2_apply',
  arguments_sha256:F.ARGUMENTS_SHA};
 await c.approvalBridge('/v1/validate',body);
 await c.approvalBridge('/v1/consume',body);
 assert.equal(fake.records[0].opts.socketPath,
  '/run/prhm-agent-approval/approval.sock');
 assert.equal(fake.records[1].opts.socketPath,
  '/run/prhm-agent-approval/approval.sock');
 assert.equal(fake.records[0].opts.host,undefined);
 assert.equal(fake.records[1].opts.port,undefined);
});
test('unknown URL, non-UUID path, authorization mismatch and foreign consume rejected',async()=>{
 const fake=fakeHttp();
 const c=transport(fake);
 const invalid=[
  ['GET','/v1/approvals/'+ID],
  ['POST','/v1/requests/'+ID],
  ['GET','/v1/requests/../../etc/passwd'],
  ['POST','http://evil.example/v1/requests'],
  ['DELETE','/v1/requests'],
  ['POST','/v1/requests/'+ID+'/decision?force=true']
 ];
 for(const [method,url] of invalid)
  await assert.rejects(c.approvalHttp(method,url,REQUEST),/registry_v2_approval_transport_/);
 await assert.rejects(c.approvalHttp('POST','/v1/requests','supplied_bearer',{}),
  /requested_bearer_not_root_bound/);
 await assert.rejects(c.approvalBridge('/v1/consume',
  {tool:'host_action_v2_apply',action:'other',arguments_sha256:F.ARGUMENTS_SHA}),
  /socket_payload_binding_invalid/);
 assert.equal(fake.records.length,0);
});
test('root-only credential reader rejects non-root/unsafe permissions/duplication',()=>{
 const body=Buffer.from(
  'APPROVAL_REQUEST_TOKEN='+REQUEST+'\nAPPROVAL_DECISION_TOKEN='+DECISION+'\n');
 function io({mode=0o100600,uid=0,override,fdChange}={}){
  const st={isFile:()=>true,isSymbolicLink:()=>false,
   uid,mode,dev:1,ino:2,size:body.length};
  return {lstatSync:()=>st,openSync:()=>100,
   fstatSync:()=>({...st,...fdChange}),
   readFileSync:()=>override||body,closeSync:()=>{}};
 }
 assert.deepEqual(T.readRootCredentials(io(),()=>0),credentialReader());
 assert.throws(()=>T.readRootCredentials(io(),()=>1000),/root_required/);
 assert.throws(()=>T.readRootCredentials(io({uid:1000}),()=>0),/credential_file_mode_or_owner_unsafe/);
 assert.throws(()=>T.readRootCredentials(io({mode:0o100644}),()=>0),/credential_file_mode_or_owner_unsafe/);
 assert.throws(()=>T.readRootCredentials(io({fdChange:{ino:3}}),()=>0),/credential_file_changed/);
 const dup=Buffer.from('APPROVAL_REQUEST_TOKEN='+REQUEST+
  '\nAPPROVAL_REQUEST_TOKEN='+REQUEST+'\nAPPROVAL_DECISION_TOKEN='+DECISION);
 assert.throws(()=>T.readRootCredentials(io({override:dup}),()=>0),
  /credential_bytes_invalid|credential_key_duplicate_or_invalid/);
});
test('client cannot escape root boundary even when passing fake request callbacks',()=>{
 assert.throws(()=>T.createTransport({
  requestFn:()=>{},credentialReader,getuid:()=>1000}),/root_required/);
 const fake=fakeHttp(()=>({ok:true,request:{...record(),
  arguments_sha256:'0'.repeat(64)}}));
 await assert.rejects(transport(fake).getTrustedRequest(ID),
  /registry_v2_five_field_/);
});
test('no HTTP redirection and failed/rejected Approval Center response is fail-closed',async()=>{
 const f=fakeHttp(()=>({status:302}));
 await assert.rejects(transport(f).approvalHttp('POST','/v1/requests',REQUEST,{}),
  /registry_v2_approval_transport_rejected/);
 const bad=fakeHttp(()=>({ok:false,error:'private_error'}));
 await assert.rejects(transport(bad).approvalHttp('POST','/v1/requests',REQUEST,{}),
  /registry_v2_approval_transport_rejected/);
});
test('transport has no approval authority, hidden credentials export or generic path access',()=>{
 for(const name of ['sign','execute','install','consume','writeFile','patch','runShell','fetch','listen']){
  assert.equal(Object.hasOwn(T,name),false);
 }
 assert.deepEqual(Object.keys(transport(fakeHttp())).sort(),
  ['getApprovalCredentials','approvalHttp','getTrustedRequest','approvalBridge'].sort());
});
