'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const A=require('./prhm-action-registry-v2-approval-http-adapter-v1.cjs');
const F=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const release=require('./manifests/honartik-config-center-registry-release-v2.json');
const id='11111111-1111-4111-8111-111111111111';
const aid='22222222-2222-4222-8222-222222222222';
function fresh(){
 return {ready:true,
  owner_shas:Object.fromEntries(Object.entries(release.registry_owners).map(([k,v])=>[k,v.before_sha256])),
  runtime_git_pins_verified:true,root_runner_attested:true,durable_recovery_verified:true,
  dual_worker_discovery_verified:true,signed_route_published:true,at_ms:Date.now()};
}
function tokenFixture(){
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
 const pub=publicKey.export({type:'spki',format:'pem'});
 const kid=G.sha(publicKey.export({type:'spki',format:'der'})).slice(0,16);
 const now=Math.floor(Date.now()/1000),hash=F.ARGUMENTS_SHA;
 const claims={approval_id:aid,request_id:id,jti:aid,iss:'prhm-company-approval',
  action:G.ACTION,operation:G.OPERATION,project:'control_plane',
  environment:'production',tool:'host_action_v2_apply',principal_id:'mohammad',
  role:'mcp-operator',level:4,risk:'critical',decision:'accept',
  one_time_use:true,policy_version:G.POLICY_VERSION,policy_hash:'b'.repeat(64),
  arguments_sha256:hash,request_hash:hash,nbf:now-10,iat:now-10,exp:now+80};
 const header={alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',kid};
 const signed=[header,claims].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
 const token=signed+'.'+crypto.sign(null,Buffer.from(signed),privateKey).toString('base64url');
 const ledger={schema_version:'prhm.approval-consumption.v1',approval_id:aid,
  request_id:id,work_order_id:null,project_id:'control_plane',operation:G.OPERATION,
  request_hash:hash,consumed_at:new Date((now-2)*1000).toISOString(),
  consumer:F.CONSUMER,consumption_hash:null};
 ledger.consumption_hash=G.sha(Buffer.from(JSON.stringify(ledger)));
 return {token,ledger,publicKey:pub,nowSec:now};
}
function fixture(options={}){
 const proof=tokenFixture(),calls=[],secret=new Map();
 const trustedRequest=()=>({
  request_id:id,action:G.ACTION,project:'control_plane',environment:'production',
  operation:G.OPERATION,arguments_sha256:F.ARGUMENTS_SHA,
  level:4,status:'pending',expires_at:new Date(Date.now()+60000).toISOString()
 });
 const cap={
  verifyRootPreflight:async()=>{calls.push('preflight');return options.preflight||fresh()},
  getApprovalCredentials:async()=>({request:'ROOT_ONLY_REQUEST',decision:'ROOT_ONLY_DECISION'}),
  approvalHttp:async(method,url,auth,payload)=>{
   calls.push('http:'+url);
   if(url==='/v1/requests')return {request:{...trustedRequest(),...options.issued}};
   if(url==='/v1/requests/'+id+'/decision')return {
    approval:{execution_authorized:true,action:G.ACTION,arguments_sha256:F.ARGUMENTS_SHA,
     request_id:id,level:4,...options.approved},
    approval_token:proof.token
   };
   throw Error('unexpected_transport');
  },
  getTrustedRequest:async()=>({...trustedRequest(),...options.request}),
  sealApprovedToken:async(k,value)=>{calls.push('seal');secret.set(k,value);return true},
  loadSealedApprovedToken:async k=>{calls.push('unseal');return secret.get(k)},
  approvalBridge:async(route,payload)=>{
   calls.push('bridge:'+route);
   if(route==='/v1/validate')return {valid:options.invalid!==true};
   if(route==='/v1/consume')return {consumed:options.unconsumed!==true};
   throw Error('unexpected_bridge');
  },
  readConsumedEvidence:async()=>{calls.push('ledger');return {
   ledger:{...proof.ledger,...options.ledger},publicKey:proof.publicKey,nowSec:proof.nowSec
  }},
  launchPinnedRootRunner:async args=>{calls.push('launcher');
   assert.deepEqual(args.input,F.REQUEST);
   assert.equal(args.approvalToken,proof.token);
   return {ok:true,registry_visible:true,rollback:'not_needed',
    source_commit:F.REQUEST.source_commit,manifest_commit:F.REQUEST.manifest_commit,
    ...options.runner};
  }
 };
 return {cap,calls,secret,proof,handler:A.createHandlers(cap)};
}
const req=()=>({...F.REQUEST});
const confirm=()=>({...F.REQUEST,request_id:id,second_confirmation:F.CONFIRM});
const execute=()=>({...F.REQUEST,request_id:id});
test('fixed three HTTP routes preserve immutable five-field SHA and never expose token',async()=>{
 const f=fixture();
 const r=await f.handler.dispatch('POST',A.URL.request,req());
 assert.equal(r.request_id,id);assert.equal(r.arguments_sha256,F.ARGUMENTS_SHA);
 assert.equal(r.status,'pending');assert.equal(r.secret_exposed,false);
 const c=await f.handler.dispatch('POST',A.URL.confirm,confirm());
 assert.equal(c.status,'approved');assert.equal(c.secret_exposed,false);
 assert.equal(f.secret.get(id),f.proof.token);
 const e=await f.handler.dispatch('POST',A.URL.execute,execute());
 assert.equal(e.status,'registered');assert.equal(e.registry_visible,true);
 assert.equal(e.secret_exposed,false);
 assert.equal(JSON.stringify([r,c,e]).includes(f.proof.token),false);
 assert.deepEqual(f.calls.filter(x=>x==='bridge:/v1/validate'||x==='bridge:/v1/consume'),
  ['bridge:/v1/validate','bridge:/v1/consume']);
 assert.ok(f.calls.indexOf('preflight')<f.calls.indexOf('bridge:/v1/consume'));
 assert.ok(f.calls.indexOf('ledger')<f.calls.indexOf('launcher'));
});
test('action-only legacy payload and any forged extra HTTP path or body are denied',async()=>{
 const f=fixture();
 for(const body of [{action:G.ACTION},{...req(),project:'other'},
  {...req(),command:'echo leaked'},null]){
  await assert.rejects(f.handler.dispatch('POST',A.URL.request,body));
 }
 await assert.rejects(f.handler.dispatch('GET',A.URL.request,req()),/method_not_allowlisted/);
 await assert.rejects(f.handler.dispatch('POST','/v2/host-actions/request',req()),
  /endpoint_not_allowlisted/);
 assert.equal(f.calls.includes('http:/v1/requests'),false);
});
test('no L4 request, decision, or consume when live root preflight is stale or SHA drifts',async()=>{
 const scenarios=[
  {...fresh(),at_ms:Date.now()-100000},
  {...fresh(),ready:false},
  {...fresh(),root_runner_attested:false},
  {...fresh(),dual_worker_discovery_verified:false},
  {...fresh(),owner_shas:{...fresh().owner_shas,base:'0'.repeat(64)}}
 ];
 for(const preflight of scenarios){
  const f=fixture({preflight});
  await assert.rejects(f.handler.dispatch('POST',A.URL.request,req()),/registry_v2_http_/);
  assert.equal(f.calls.includes('http:/v1/requests'),false);
  f.secret.set(id,f.proof.token);
  await assert.rejects(f.handler.dispatch('POST',A.URL.execute,execute()),/registry_v2_http_/);
  assert.equal(f.calls.includes('bridge:/v1/consume'),false);
 }
});
test('confirm rejects mutated or expired request and never stores a token',async()=>{
 for(const request of [
  {arguments_sha256:'0'.repeat(64)},{status:'consumed'},
  {action:'other'},{level:3},
  {expires_at:new Date(Date.now()-10000).toISOString()}
 ]){
  const f=fixture({request});
  await assert.rejects(f.handler.dispatch('POST',A.URL.confirm,confirm()));
  assert.equal(f.secret.size,0);
  assert.equal(f.calls.some(x=>x.startsWith('http:')),false);
 }
});
test('approve response cannot swap action, SHA, request or execution authority',async()=>{
 for(const approved of [{arguments_sha256:'f'.repeat(64)},
  {request_id:'33333333-3333-4333-8333-333333333333'},
  {execution_authorized:false},{level:3},{action:'other'}]){
  const f=fixture({approved});
  await assert.rejects(f.handler.dispatch('POST',A.URL.confirm,confirm()),
   /approval_decision_binding_failed/);
  assert.equal(f.secret.size,0);
 }
});
test('invalid signature/ledger/consume result never reaches launcher',async()=>{
 for(const options of [{invalid:true},{unconsumed:true},
  {ledger:{consumption_hash:'0'.repeat(64)}}]){
  const f=fixture(options);
  await f.handler.dispatch('POST',A.URL.confirm,confirm());
  await assert.rejects(f.handler.dispatch('POST',A.URL.execute,execute()));
  assert.equal(f.calls.includes('launcher'),false);
 }
});
test('failed post-launch verification cannot be marked registered',async()=>{
 const f=fixture({runner:{registry_visible:false}});
 await f.handler.dispatch('POST',A.URL.confirm,confirm());
 await assert.rejects(f.handler.dispatch('POST',A.URL.execute,execute()),
  /root_runner_postcondition_unverified/);
});
test('trusted transport API requires all fixed capabilities; no generic shell or raw signer',()=>{
 assert.deepEqual(Object.keys(A.createHandlers(fixture().cap)),['dispatch']);
 for(const missing of A.CAPABILITIES){
  const cap={...fixture().cap};
  delete cap[missing];
  assert.throws(()=>A.createHandlers(cap),/trusted_transport_surface/);
 }
 for(const forbidden of ['exec','writeFile','sign','readToken','approve','consume','runShell'])
  assert.equal(Object.hasOwn(A,forbidden),false);
});
