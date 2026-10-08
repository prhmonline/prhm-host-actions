'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const api=require('./drtarjomeh-preflight-agent-api-route-v1.js');
const audited=require('./drtarjomeh-current-release-preflight-v1.js');
const valid=()=>({
  schema:'prhm.drtarjomeh.security-preflight.v1',audit_only:true,production_mutation:false,
  cutover_authorized:false,source_commit:'f22b1d17801239f7539f84e5aa8b91250c87dc58',
  expected_release:'20261006-224241-0e8686eed30f',pointer_identity:'MISMATCH',
  files:[],protected_env:{status:'MISSING',contents_read:false},
  gate:'BLOCKED_PENDING_RECONCILIATION_AND_LEVEL4_APPROVAL'
});
function response(){
  const r={statusCode:200,body:null};
  return {result:r,res:{status(code){r.statusCode=code;return this;},json(obj){r.body=obj;return this;}}};
}
test('pin is exactly the merged Git blob, not merely the filename',()=>{
  const src=fs.readFileSync(path.join(__dirname,'drtarjomeh-current-release-preflight-v1.js'));
  const digest=crypto.createHash('sha1').update(Buffer.from('blob '+src.length+'\0')).update(src).digest('hex');
  assert.equal(digest,'b69bcc0bab682bd741c66d93b86c82c2091db7c8');
  assert.equal(api.gitBlobSha(src),digest);
  assert.equal(api.SOURCE_GIT_BLOB,digest);
  assert.equal(api.SOURCE_COMMIT,'d2a56b13a7c076552461bea4d6ea7aaf8e02b683');
  assert.equal(api.EXPECTED_RELEASE,audited.EXPECTED_RELEASE);
  assert.equal(api.TOOL,'drtarjomeh_current_release_preflight_readonly_v1');
});
test('route is authenticated, registered only under fixed path, and zero-input',()=>{
  let args;
  const app={post(...a){args=a;}},auth=()=>{};
  api.registerDrtarjomehReadonlyPreflightRoute(app,{auth});
  assert.equal(args.length,3);
  assert.equal(args[0],api.ROUTE);
  assert.equal(args[1],auth);
  const out=response();
  api.handler({body:{path:'/etc/passwd'}},out.res,()=>{throw Error('should not run');});
  assert.equal(out.result.statusCode,400);
  assert.equal(out.result.body.error,'drtarjomeh_preflight_zero_input_required');
});
test('valid sanitized readonly result returned without mutation',()=>{
  const out=response();api.handler({body:{}},out.res,()=>api.validateEvidence(valid()));
  assert.equal(out.result.statusCode,200);
  assert.equal(out.result.body.audit_only,true);
  assert.equal(out.result.body.cutover_authorized,false);
});
test('invalid result and injected credential are never echoed to clients',()=>{
  const out=response();
  api.handler({body:{}},out.res,()=>api.validateEvidence({...valid(),protected_env:{contents_read:false,content:'FAKE_CREDENTIAL_SHOULD_NOT_LEAK'}}));
  assert.equal(out.result.statusCode,409);
  assert.equal(JSON.stringify(out.result.body).includes('FAKE_CREDENTIAL'),false);
});
test('result rejects success-looking grant and unsafe SHA',()=>{
  for(const change of [
    {cutover_authorized:true},
    {production_mutation:true},
    {audit_only:false},
    {gate:'APPROVED'},
    {pointer_identity:'MATCH',files:[]}
  ]) assert.throws(()=>api.validateEvidence({...valid(),...change}));
  const bad={...valid(),pointer_identity:'MATCH',files:Array(24).fill({path:'yii',status:'REGULAR',sha256:'bad',bytes:5})};
  assert.throws(()=>api.validateEvidence(bad));
});
test('metadata-only result remains valid even when file access is denied',()=>{
  assert.equal(api.validateEvidence(valid()).pointer_identity,'MISMATCH');
  assert.equal(api.validateEvidence({...valid(),pointer_identity:'UNAVAILABLE'}).files.length,0);
});
test('MCP adapter advertises readonly, sends only empty JSON and validates response',async()=>{
  const {registerDrtarjomehCurrentReleasePreflight,TOOL,ROUTE}=await import('./drtarjomeh-preflight-mcp-adapter-v1.mjs');
  let registration;
  const mcp={registerTool(name,config,handler){registration={name,config,handler};}};
  let seen;
  const agent={callAgent:async(p,verb,body)=>{seen={p,verb,body};return valid();}};
  registerDrtarjomehCurrentReleasePreflight(mcp,{agent});
  assert.equal(registration.name,TOOL);
  assert.deepEqual(registration.config.inputSchema,{});
  assert.equal(registration.config.annotations.readOnlyHint,true);
  assert.equal(registration.config.annotations.destructiveHint,false);
  const out=await registration.handler();
  assert.deepEqual(seen,{p:ROUTE,verb:'POST',body:{}});
  assert.equal(JSON.parse(out.content[0].text).production_mutation,false);
});
test('MCP adapter fails closed on missing immutable audit markers',async()=>{
  const {registerDrtarjomehCurrentReleasePreflight}=await import('./drtarjomeh-preflight-mcp-adapter-v1.mjs');
  let fn;registerDrtarjomehCurrentReleasePreflight(
    {registerTool(_n,_c,h){fn=h;}},{agent:{callAgent:async()=>({...valid(),audit_only:false})}}
  );
  await assert.rejects(fn,/preflight_result_contract_invalid/);
});
