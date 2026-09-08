'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const crypto=require('node:crypto');
const IMPL=path.join(__dirname,'agent-api-zdt-helper-forward-refresh-bridge-v1.js');
function load(){delete require.cache[require.resolve(IMPL)];return require(IMPL);}

test('exports fixed authenticated ZDT helper forward-refresh bridge contract',()=>{
 const m=load();
 assert.equal(m.SENTINEL,'zdt-v19-api-sha-forward-refresh-v1.sh');
 assert.equal(m.HELPER,'/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-existing-topology-rolling-refresh-v1.js');
 assert.equal(m.OLD_HELPER_SHA,'6b110621eb7dbff73d04ca0c16d9493d9ec58411dc806c1415efa93b6dac84ec');
 assert.equal(m.OLD_API_SHA,'c592835c75cfe3b02d613ba895d811340200bfd06f33d2a77373a28e267691eb');
 assert.equal(m.NEW_API_SHA,'02e7587d0319865bbb1767568edde18d1350aaa39bb0fedc92c5867fd639e3e2');
 assert.equal(typeof m.buildHelperCandidate,'function');
 assert.equal(typeof m.isSentinelRequest,'function');
});

test('candidate replaces one API SHA and preserves every other byte',()=>{
 const m=load();
 const before=['header',m.OLD_API_SHA,'footer'].join('\\n');
 const expected=crypto.createHash('sha256').update(before).digest('hex');
 const out=m.buildHelperCandidate(before,expected);
 assert.equal(out.content,['header',m.NEW_API_SHA,'footer'].join('\\n'));
 assert.equal(out.replacement_count,1);
 assert.match(out.sha256,/^[a-f0-9]{64}$/);
});

test('candidate fails closed on preimage drift, duplicate old pin, or preexisting new pin',()=>{
 const m=load();
 const H=s=>crypto.createHash('sha256').update(s).digest('hex');
 assert.throws(()=>m.buildHelperCandidate('wrong',m.OLD_HELPER_SHA),/helper_preimage_sha_mismatch/);
 const dup=m.OLD_API_SHA+'\\n'+m.OLD_API_SHA;
 assert.throws(()=>m.buildHelperCandidate(dup,H(dup)),/old_api_sha_count_2/);
 const mixed=m.OLD_API_SHA+'\\n'+m.NEW_API_SHA;
 assert.throws(()=>m.buildHelperCandidate(mixed,H(mixed)),/new_api_sha_already_present/);
});

test('sentinel is exact and rejects caller-controlled extra mutation fields',()=>{
 const m=load();
 assert.equal(m.isSentinelRequest({body:{target:'root_scripts',path:m.SENTINEL}}),true);
 assert.equal(m.isSentinelRequest({query:{target:'root_scripts',path:m.SENTINEL}}),true);
 assert.equal(m.isSentinelRequest({params:{target:'root_scripts',path:m.SENTINEL}}),true);
 assert.equal(m.isSentinelRequest({params:{target:'root_scripts','0':m.SENTINEL}}),true);
 assert.equal(m.isSentinelRequest({body:{target:'root_scripts',path:m.SENTINEL,command:'x'}}),false);
 assert.equal(m.isSentinelRequest({body:{target:'agent_api',path:m.SENTINEL}}),false);
 assert.equal(m.isSentinelRequest({body:{target:'root_scripts',path:'other.sh'}}),false);
});
