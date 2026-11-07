'use strict';
const test=require('node:test'), assert=require('node:assert/strict'),crypto=require('node:crypto');
const g=require('./prhm-action-registry-gateway-v1.cjs');
const SHA=a=>g.sha(Buffer.from(a));
const A={base:Buffer.from('base preimage'),executor:Buffer.from('executor preimage'),
 policy:Buffer.from('policy preimage'),mcp:Buffer.from('mcp preimage')};
const B={base:Buffer.from('base next'),executor:Buffer.from('executor next'),
 policy:Buffer.from('policy next'),mcp:Buffer.from('mcp next')};
const F={
 '/opt/prhm-agent-selfmaint-exec/actions/sample-action.cjs':Buffer.from("'use strict';\nmodule.exports = ()=>42;\n")
};
function manifest(project='honartik',action='honartik_config_center_readonly_enroll_v1'){
 return {
  schema_version:'prhm.action-registry.release.v1',project,action,
  git_path:'manifests/'+project+'-registration.json',
  source_commit:'a'.repeat(40),risk:'critical',approval_level:4,
  rollback_required:true,
  registry_owners:Object.fromEntries(Object.keys(g.OWNER_PATHS).map(k=>[
   k,{path:g.OWNER_PATHS[k],before_sha256:g.sha(A[k]),after_sha256:g.sha(B[k])}
  ])),
  assets:Object.entries(F).map(([path,bytes])=>({path,source_path:'sample-action.cjs',sha256:g.sha(bytes)})),
  health:{services:['prhm-agent-selfmaint.service',
   'prhm-agent-selfmaint-exec.service',
   'prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service'],tool:action}
 };
}
function release(project,action) {
 const m=manifest(project,action),bytes=Buffer.from(JSON.stringify(m));
 return g.attestRelease({manifestBytes:bytes,expectedManifestSha:g.sha(bytes),
  sourceCommit:m.source_commit,manifestCommit:'b'.repeat(40),
  readOwner:p=>A[Object.keys(g.OWNER_PATHS).find(x=>g.OWNER_PATHS[x]===p)],
  readAsset:p=>F[p],readGitBlob:()=>bytes,readGitSource:()=>F['/opt/prhm-agent-selfmaint-exec/actions/sample-action.cjs']});
}
test('canonical argument hash exactly matches live Agent 3 recursive JSON sort',()=>{
 const args={action:g.ACTION,project:'honartik',source_commit:'a'.repeat(40),
   manifest_commit:'b'.repeat(40),manifest_sha256:'1'.repeat(64)};
 const expected='3ba6ec4fb870e6255228968e72a7d7876a389271f59a15e7f9b905d4ad87be9d';
 assert.equal(g.approvalBindingSha(args),expected);
 const altered={manifest_sha256:args.manifest_sha256,source_commit:args.source_commit,
  project:args.project,manifest_commit:args.manifest_commit,action:args.action};
 assert.equal(g.approvalBindingSha(altered),expected);
 const nested={b:{z:1,a:2},a:[{y:3,x:4}]};
 assert.equal(g.canonicalJson(nested),'{"a":[{"x":4,"y":3}],"b":{"a":2,"z":1}}');
 assert.notEqual(g.sha(Buffer.from(JSON.stringify(args))),expected);
});
test('shared gateway supports independent Honartik and MoeinShow immutable manifests',()=>{
 const a=release('honartik','honartik_config_center_readonly_enroll_v1');
 const b=release('moeinshow','moeinshow_config_center_readonly_enroll_v1');
 assert.equal(a.normalized.project,'honartik');assert.equal(b.normalized.project,'moeinshow');
 assert.equal(a.normalized.action!==b.normalized.action,true);
});
test('wrong source commit fails closed',()=>{
 const m=manifest(),buf=Buffer.from(JSON.stringify(m));
 assert.throws(()=>g.attestRelease({manifestBytes:buf,expectedManifestSha:g.sha(buf),
  sourceCommit:'b'.repeat(40),manifestCommit:'c'.repeat(40),readOwner:()=>null,readAsset:()=>null,readGitBlob:()=>buf,readGitSource:()=>F['/opt/prhm-agent-selfmaint-exec/actions/sample-action.cjs']}),/source_or_manifest_commit_mismatch/);
});
test('unverified/mismatched git bytes fail closed',()=>{
 const m=manifest(),buf=Buffer.from(JSON.stringify(m));
 assert.throws(()=>g.attestRelease({manifestBytes:buf,expectedManifestSha:'f'.repeat(64),
  sourceCommit:m.source_commit,manifestCommit:'b'.repeat(40),readOwner:()=>null,readAsset:()=>null,readGitBlob:()=>buf,readGitSource:()=>F['/opt/prhm-agent-selfmaint-exec/actions/sample-action.cjs']}),/manifest_sha_mismatch/);
});
test('owner drift blocks registration before mutation',()=>{
 const m=manifest(),buf=Buffer.from(JSON.stringify(m));
 assert.throws(()=>g.attestRelease({manifestBytes:buf,expectedManifestSha:g.sha(buf),
  sourceCommit:m.source_commit,manifestCommit:'b'.repeat(40),readOwner:()=>Buffer.from('drift'),readAsset:()=>null,readGitBlob:()=>buf,readGitSource:()=>F['/opt/prhm-agent-selfmaint-exec/actions/sample-action.cjs']}),/owner_sha_drift/);
});
test('asset digest drift blocks registration',()=>{
 const m=manifest(),buf=Buffer.from(JSON.stringify(m));
 assert.throws(()=>g.attestRelease({manifestBytes:buf,expectedManifestSha:g.sha(buf),
  sourceCommit:m.source_commit,manifestCommit:'b'.repeat(40),
  readOwner:p=>A[Object.keys(g.OWNER_PATHS).find(x=>g.OWNER_PATHS[x]===p)],
  readAsset:()=>Buffer.from('bad'),readGitBlob:()=>buf,readGitSource:()=>F['/opt/prhm-agent-selfmaint-exec/actions/sample-action.cjs']}),/asset_sha_or_source_git_drift/);
});
test('project slug can not escape source or path',()=>{
 const m=manifest();m.project='../root';
 assert.throws(()=>g.assertManifest(m),/manifest_security_contract/);
});
test('unrecognized owner path fails closed',()=>{
 const m=manifest();m.registry_owners.policy.path='/etc/ssh/sshd_config';
 assert.throws(()=>g.assertManifest(m),/owner_pin_or_path/);
});
test('arbitrary asset path and nested parent traversal rejected',()=>{
 const m=manifest();m.assets[0].path='/opt/prhm-agent-selfmaint-exec/actions/../../root/pwn';
 assert.throws(()=>g.assertManifest(m),/asset_untrusted_path_or_duplicate/);
});
test('duplicate asset destination rejected',()=>{
 const m=manifest();m.assets.push({...m.assets[0]});
 assert.throws(()=>g.assertManifest(m),/asset_untrusted_path_or_duplicate/);
});
test('widened risk/scope or disabled rollback rejected',()=>{
 for (const [k,v] of [['approval_level',3],['risk','high'],['rollback_required',false]]) {
  const m=manifest();m[k]=v;assert.throws(()=>g.assertManifest(m),/manifest_security_contract/);
 }
});
test('missing either MCP replica health condition fails closed',()=>{
 const m=manifest();m.health.services.pop();assert.throws(()=>g.assertManifest(m),/health_or_registry_discovery_missing/);
});
test('future approval argument hash binds project, release SHA and action',()=>{
 const a={action:g.ACTION,project:'honartik',source_commit:'a'.repeat(40),manifest_commit:'b'.repeat(40),manifest_sha256:'1'.repeat(64)};
 const b={...a,project:'moeinshow'};
 assert.notEqual(g.approvalBindingSha(a),g.approvalBindingSha(b));
 assert.notEqual(g.approvalBindingSha(a),g.approvalBindingSha({...a,manifest_sha256:'2'.repeat(64)}));
});
function signedFixture(args,overrides={}) {
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
 const pub=publicKey.export({type:'spki',format:'pem'});
 const kid=g.sha(publicKey.export({type:'spki',format:'der'})).slice(0,16);
 const now=Math.floor(Date.now()/1000);
 const id='11111111-1111-4111-8111-111111111111';
 const request='22222222-2222-4222-8222-222222222222';
 const hash=g.approvalBindingSha(args);
 const claims={approval_id:id,request_id:request,jti:id,
  iss:'prhm-company-approval',action:g.ACTION,operation:g.OPERATION,
  project:'control_plane',environment:'production',tool:'host_action_v2_apply',
  principal_id:'mohammad',role:'mcp-operator',level:4,risk:'critical',
  decision:'accept',one_time_use:true,policy_version:g.POLICY_VERSION,
  policy_hash:'b'.repeat(64),arguments_sha256:hash,request_hash:hash,
  nbf:now-20,iat:now-20,exp:now+90,...overrides};
 const header={alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',kid};
 const prefix=[header,claims].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
 const signature=crypto.sign(null,Buffer.from(prefix),privateKey).toString('base64url');
 const ledger={schema_version:'prhm.approval-consumption.v1',
  approval_id:id,request_id:request,work_order_id:null,project_id:'control_plane',
  operation:g.OPERATION,request_hash:hash,consumed_at:new Date((now-5)*1000).toISOString(),
  consumer:'prhm-agent-selfmaint-exec-host-actions-v2',consumption_hash:null};
 ledger.consumption_hash=g.sha(Buffer.from(JSON.stringify(ledger)));
 return {token:prefix+'.'+signature,publicKey:pub,ledger,args,nowSec:now};
}
test('signed one-time Ed25519 registration binding verifies cryptographically',()=>{
 const args={action:g.ACTION,project:'honartik',source_commit:'a'.repeat(40),manifest_commit:'b'.repeat(40),manifest_sha256:'1'.repeat(64)};
 const fixture=signedFixture(args);
 assert.equal(g.verifyConsumedRegistrationApproval(fixture).request_id,fixture.ledger.request_id);
});
test('signed request identity is bound to the native pending ID as well as identical five fields',()=>{
 const args={action:g.ACTION,project:'honartik',source_commit:'a'.repeat(40),
  manifest_commit:'b'.repeat(40),manifest_sha256:'1'.repeat(64)};
 const f=signedFixture(args);
 const id=f.ledger.request_id;
 assert.equal(g.verifyConsumedRegistrationApproval({...f,expectedRequestId:id}).request_id,id);
 const alternate='33333333-3333-4333-8333-333333333333';
 // Same manifest and same canonical five-field hash is NOT authorization
 // to redeem another pending native request's signed JWS.
 assert.throws(()=>g.verifyConsumedRegistrationApproval({
  ...f,expectedRequestId:alternate
 }),/signed_request_id_mismatch/);
 assert.throws(()=>g.verifyConsumedRegistrationApproval({
  ...f,expectedRequestId:'not-uuid'
 }),/signed_request_id_mismatch/);
 const reissued=signedFixture(args,{request_id:alternate});
 assert.throws(()=>g.verifyConsumedRegistrationApproval({
  ...reissued,expectedRequestId:alternate
 }),/consumption_ledger_invalid_or_replayed/);
});
test('forged approval boolean, altered signature and wrong consumption hash rejected',()=>{
 const args={action:g.ACTION,project:'honartik',source_commit:'a'.repeat(40),manifest_commit:'b'.repeat(40),manifest_sha256:'1'.repeat(64)};
 const f=signedFixture(args);
 assert.throws(()=>g.verifyConsumedRegistrationApproval({...f,token:'approved'}),/signed_token/);
 const parts=f.token.split('.');parts[1]=Buffer.from(JSON.stringify({fraud:true})).toString('base64url');
 assert.throws(()=>g.verifyConsumedRegistrationApproval({...f,token:parts.join('.')}),/signed_token_invalid_signature/);
 assert.throws(()=>g.verifyConsumedRegistrationApproval({...f,ledger:{...f.ledger,consumption_hash:'0'.repeat(64)}}),/consumption_ledger_invalid/);
});
test('expired, wrong project or unconsumed L4 receipt cannot register',()=>{
 const args={action:g.ACTION,project:'honartik',source_commit:'a'.repeat(40),manifest_commit:'b'.repeat(40),manifest_sha256:'1'.repeat(64)};
 const expired=signedFixture(args,{exp:Math.floor(Date.now()/1000)-2});
 assert.throws(()=>g.verifyConsumedRegistrationApproval(expired),/signed_l4_binding/);
 const valid=signedFixture(args);
 assert.throws(()=>g.verifyConsumedRegistrationApproval({...valid,args:{...args,project:'moeinshow'}}),/signed_l4_binding/);
 assert.throws(()=>g.verifyConsumedRegistrationApproval({...valid,ledger:{...valid.ledger,consumer:'unconsumed'}}),/consumption_ledger_invalid/);
});
test('preinstall does not circularly require a tool it has not registered yet',()=>{
 const r=g.readiness({phase:'preinstall',release:release('honartik','honartik_config_center_readonly_enroll_v1'),
  registrarInstalled:true,approvalRouteInstalled:true,rollbackReady:true,
  servicesHealthy:true,registeredToolVisible:false});
 assert.equal(r.ready,true);
 assert.deepEqual(r.gaps,[]);
});
test('not-ready registrar names only actual missing preinstall gates',()=>{
 const r=g.readiness({phase:'preinstall',release:release('honartik','honartik_config_center_readonly_enroll_v1'),
  registrarInstalled:false,approvalRouteInstalled:false,rollbackReady:false,
  servicesHealthy:true,registeredToolVisible:false});
 assert.equal(r.ready,false);
 assert.deepEqual(r.gaps,['TRUSTED_REGISTRAR_NOT_INSTALLED','APPROVAL_ROUTE_NOT_REGISTERED',
  'ROLLBACK_NOT_VERIFIED']);
});
test('authorized gate requires consumed L4; active gate additionally requires tool discovery',()=>{
 const opts={release:release('honartik','honartik_config_center_readonly_enroll_v1'),
  registrarInstalled:true,approvalRouteInstalled:true,rollbackReady:true,
  servicesHealthy:true,registeredToolVisible:false};
 assert.deepEqual(g.readiness({...opts,phase:'authorized'}).gaps,['SIGNED_L4_RECEIPT_NOT_CONSUMED']);
 assert.deepEqual(g.readiness({...opts,phase:'active',approval:{verified:true}}).gaps,
   ['TARGET_TOOL_NOT_REGISTERED']);
});
test('request cannot invoke an installer without signed and consumed approval',async()=>{
 const r=release('honartik','honartik_config_center_readonly_enroll_v1');
 const args={action:g.ACTION,project:r.normalized.project,source_commit:r.source_commit,
  manifest_commit:r.manifest_commit,manifest_sha256:r.manifest_sha256};
 let called=0;
 await assert.rejects(g.executeAfterTrustedAuthorization({release:r,args,signedApprovalToken:'approved',
  trustedInstaller:async()=>{called++;return{ok:true}},
  trustedRollback:async()=>({verified:true}),verifyOriginalState:async()=>true,
  readInstalledTool:async()=>true,audit:async()=>{}}),/trusted_root_required|signed_token/);
 assert.equal(called,0);
});
test('shared gateway has no CLI install or caller-controlled command',()=>{
 assert.equal(typeof g.executeAfterTrustedAuthorization,'function');
 assert.equal(typeof g.spawn,'undefined');assert.equal(typeof g.exec,'undefined');
 assert.equal(g.ACTION,'prhm_action_registry_install_v1');
});
