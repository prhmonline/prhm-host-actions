'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const h=require('./shared-registrar-native-host-hooks-v1.cjs');
test('exact SHA and fixed four-service order are non-bypassable',()=>{
 assert.equal(h.fixedRef('a'.repeat(40)),'a'.repeat(40));
 for(const invalid of ['HEAD','main','a'.repeat(39),'A'.repeat(40),'a'.repeat(40)+'^{}','../main',''])assert.throws(()=>h.fixedRef(invalid),/git_ref_not_exact_sha/);
 const valid=['prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service',
  'prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service'];
 assert.deepEqual(h.checkedServices(valid),valid);
 assert.throws(()=>h.checkedServices(valid.slice(0,3)),/service_set_not_fixed/);
 assert.throws(()=>h.checkedServices([...valid].reverse()),/service_set_not_fixed/);
 assert.throws(()=>h.checkedServices([...valid.slice(0,3),'other.service']),/service_set_not_fixed/);
});
test('never bootstraps or issues a root approval from a source-only module',()=>{
 assert.equal(typeof h.createTrustedHooks,'function');
 assert.equal(typeof h.install,'undefined');
 assert.equal(typeof h.apply,'undefined');
 assert.equal(typeof h.issueSignedL4,'undefined');
 assert.equal(typeof h.allowArbitraryCommand,'undefined');
 assert.equal(Object.isFrozen(h),true);
});
test('on a disposable runner without prepared trust stores, construction fails closed',()=>{
 // This test is run only on disposable hosted GitHub runner.
 if(process.env.GITHUB_ACTIONS!=='true')return;
 assert.throws(()=>h.createTrustedHooks(),/registrar_host_hook_/);
});
