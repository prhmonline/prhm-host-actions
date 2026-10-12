'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONTRACT, createAction, validateRequest } = require('./honartik-config-center-enrollment-action-v1.cjs');
const UUID = 'd68bc57d-e236-4b51-8e46-24b5cc9d711a';
const request = () => ({ requestId: UUID });
const before = () => ({
  site: 'honartik', revision: 1, backendSha: CONTRACT.backendSha,
  configCenterRelease: CONTRACT.configCenterRelease,
  scriptGitSha: CONTRACT.scriptGitSha, scriptSha256: CONTRACT.scriptSha256,
  activeCredentialCount: 0, credentialFileExists: false, projectGitClean: true,
  scriptGitClean: true, consumerPresent: true, allowedScope: 'config:read'
});
const after = () => ({
  site: 'honartik', revision: 1, activeCredentialCount: 1,
  credentialFileExists: true, fileMode: '0600', fileOwner: 'honartik',
  credentialName: CONTRACT.credentialName, scopes: ['config:read'],
  configHttp: 200, secretsHttp: 403
});
const approved = () => ({
  ok:true, requestId:UUID, action:CONTRACT.action, operation:CONTRACT.operation,
  level:4, confirmation:'CONFIRM_LEVEL_4_CRITICAL', sourceSha:CONTRACT.scriptGitSha,
  consumedOnce:true
});
function harness(override = {}) {
  const calls = [];
  const data = { post: after() };
  const api = {
    withExclusiveLock: async (_, fn) => { calls.push('lock'); return fn(); },
    readPreflight: async () => { calls.push('read'); return before(); },
    consumeApprovedRequest: async () => { calls.push('approve'); return approved(); },
    runFixedEnrollment: async () => { calls.push('issue'); return 'issued'; },
    runFixedRollback: async () => { calls.push('revoke'); data.post={activeCredentialCount:0,credentialFileExists:false}; return 'revoked'; },
    readPostcondition: async () => { calls.push('post'); return data.post; },
    runFixedConsumerCheck: async () => { calls.push('yii'); return {exitCode:0,output:'CONFIG_CENTER_READONLY_PASS tenant=honartik revision=1 source=remote'}; },
    writeAudit: async event => { calls.push('audit:'+event.result); }
  };
  return { action:createAction({...api,...override}), calls, data };
}
test('preflight is read-only and returns bounded status',async()=>{
  const h=harness(); assert.deepEqual(await h.action.preflight(),{action:CONTRACT.action,site:'honartik',revision:1,status:'ready',rollback:'not_needed'});
  assert.deepEqual(h.calls,['read']);
});
test('exact approved operation succeeds, without returning credential material',async()=>{
  const h=harness(); const result=await h.action.apply(request());
  assert.equal(result.status,'success'); assert.equal(JSON.stringify(result).includes('ccm_'),false);
  assert.deepEqual(h.calls,['lock','read','approve','issue','post','yii','audit:success']);
});
test('wrong approval level is refused without issuer invocation',async()=>{
  const h=harness({consumeApprovedRequest:async()=>({...approved(),level:3})});
  assert.equal((await h.action.apply(request())).status,'denied'); assert.equal(h.calls.includes('issue'),false);
});
test('wrong source SHA binding is refused',async()=>{
  const h=harness({consumeApprovedRequest:async()=>({...approved(),sourceSha:'0'.repeat(40)})});
  assert.equal((await h.action.apply(request())).status,'denied'); assert.equal(h.calls.includes('issue'),false);
});
test('request must contain exactly one valid identifier',async()=>{
  for (const x of [null,{}, {requestId:'test'}, {...request(),command:'echo a'}, {requestId:'a'.repeat(100)}]) {
    assert.throws(()=>validateRequest(x)); const h=harness(); assert.equal((await h.action.apply(x)).status,'denied');assert.deepEqual(h.calls,[]);
  }
});
test('preexisting credential fails closed before approval',async()=>{
  const h=harness({readPreflight:async()=>({...before(),activeCredentialCount:1})});
  assert.equal((await h.action.apply(request())).status,'blocked');assert.equal(h.calls.includes('approve'),false);
});
test('dirty source code blocks issuance',async()=>{
  const h=harness({readPreflight:async()=>({...before(),scriptGitClean:false})});
  assert.equal((await h.action.apply(request())).status,'blocked');assert.equal(h.calls.includes('issue'),false);
});
test('unrecognized scope blocks issuance',async()=>{
  const h=harness({readPreflight:async()=>({...before(),allowedScope:'secrets:read'})});
  assert.equal((await h.action.apply(request())).status,'blocked');
});
test('denies success if secrets route does not return 403; rolls back',async()=>{
  const h=harness(); h.data.post={...after(),secretsHttp:200};
  const result=await h.action.apply(request());assert.equal(result.status,'failed');assert.equal(result.rollback,'verified');assert.ok(h.calls.includes('revoke'));
});
test('denies success if file is not 0600; rolls back',async()=>{
  const h=harness(); h.data.post={...after(),fileMode:'0644'};
  const result=await h.action.apply(request());assert.equal(result.status,'failed');assert.equal(result.rollback,'verified');
});
test('consumer check fails closed and triggers rollback',async()=>{
  const h=harness({runFixedConsumerCheck:async()=>({exitCode:1,output:'CONFIG_CENTER_READONLY_FAIL'})});
  const result=await h.action.apply(request());assert.equal(result.status,'failed');assert.equal(result.rollback,'verified');
});
test('audit write failure triggers rollback',async()=>{
  const h=harness({writeAudit:async()=>{throw new Error('internal-secret-should-never-appear')}});
  const result=await h.action.apply(request());assert.equal(result.status,'failed');assert.equal(result.rollback,'verified');assert.equal(JSON.stringify(result).includes('internal-secret'),false);
});
test('rollback failure is marked unverified without unsafe details',async()=>{
  const h=harness({runFixedRollback:async()=>{throw new Error('sensitive')}});
  h.data.post={...after(),secretsHttp:200};
  const result=await h.action.apply(request());assert.equal(result.status,'failed');assert.equal(result.rollback,'unverified');assert.equal(JSON.stringify(result).includes('sensitive'),false);
});
test('issuing function failure invokes bounded recovery',async()=>{
  const h=harness({runFixedEnrollment:async()=>{throw new Error('do-not-disclose')}});
  const result=await h.action.apply(request());assert.equal(result.status,'failed');assert.equal(result.rollback,'verified');assert.equal(JSON.stringify(result).includes('do-not-disclose'),false);
});
test('approval consumer failure never invokes issuance',async()=>{
  const h=harness({consumeApprovedRequest:async()=>{throw new Error('authorization-unavailable')}});
  const result=await h.action.apply(request());assert.equal(result.status,'blocked');assert.equal(h.calls.includes('issue'),false);
});
test('adapter cannot omit the locking or approval implementation',()=>{
  assert.throws(()=>createAction({}),/adapter_unavailable/);
});
