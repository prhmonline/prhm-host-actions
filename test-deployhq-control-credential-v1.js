#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const m=require('./deployhq-control-adapter-v1.js');

test('credential paths are sourced only from CREDENTIALS_DIRECTORY',()=>{
 const p=m.credentialPaths({CREDENTIALS_DIRECTORY:'/run/credentials/prhm-deployhq-control.service'});
 assert.deepEqual(p,{email:'/run/credentials/prhm-deployhq-control.service/deployhq_email',apiKey:'/run/credentials/prhm-deployhq-control.service/deployhq_api_key'});
 assert.throws(()=>m.credentialPaths({}),/credentials_directory_missing/);
});
test('credential evidence exposes only presence length and 12-hex fingerprints',()=>{
 const e=m.credentialEvidence({email:Buffer.from('u@example.test'),apiKey:Buffer.from('1234567890123456789012345678901234567890')});
 assert.equal(e.credential_present,true); assert.equal(e.email_length,14); assert.equal(e.api_key_length,40);
 assert.match(e.email_fingerprint,/^[0-9a-f]{12}$/); assert.match(e.api_key_fingerprint,/^[0-9a-f]{12}$/);
 assert.equal(JSON.stringify(e).includes('u@example.test'),false); assert.equal(JSON.stringify(e).includes('1234567890'),false);
});
test('missing either credential disables client creation',()=>{
 assert.throws(()=>m.createDeployHQClient({email:'',apiKey:'x',request:async()=>{}}),/deployhq_credential_missing/);
 assert.throws(()=>m.createDeployHQClient({email:'x',apiKey:'',request:async()=>{}}),/deployhq_credential_missing/);
});
test('client uses fixed origin, fixed project servers path and basic auth',async()=>{
 let seen; const client=m.createDeployHQClient({email:'user@example.test',apiKey:'K'.repeat(40),request:async r=>{seen=r;return {status:200,json:{servers:[]}}}});
 const out=await client.listServers(); assert.deepEqual(out,[]);
 assert.equal(seen.origin,'https://mohammad-heidarypur.deployhq.com');
 assert.equal(seen.path,'/projects/prhm-host-actions/servers'); assert.equal(seen.method,'GET');
 assert.equal(seen.headers.accept,'application/json'); assert.match(seen.headers.authorization,/^Basic /);
 const decoded=Buffer.from(seen.headers.authorization.slice(6),'base64').toString('utf8'); assert.equal(decoded,'user@example.test:'+('K'.repeat(40)));
});
test('createFixedServer sends only fixed server contract',async()=>{
 let seen; const client=m.createDeployHQClient({email:'u',apiKey:'k',request:async r=>{seen=r;return {status:201,json:{identifier:'new1',...m.FIXED_NODE1}}}});
 const out=await client.createFixedServer(); assert.equal(out.identifier,'new1');
 assert.equal(seen.method,'POST'); assert.equal(seen.path,'/projects/prhm-host-actions/servers');
 assert.deepEqual(seen.body,{server:m.FIXED_NODE1});
});
test('client surface has no arbitrary request or deployment mutation primitive',()=>{
 const c=m.createDeployHQClient({email:'u',apiKey:'k',request:async()=>({status:200,json:{}})});
 assert.deepEqual(Object.keys(c).sort(),['commandSnapshot','deleteCreatedServer','deploymentSnapshot','listServers','createFixedServer'].sort());
 assert.equal(c.request,undefined); assert.equal(c.proxy,undefined); assert.equal(c.createDeployment,undefined); assert.equal(c.createCommand,undefined);
});
test('upstream error is redacted before rethrow',async()=>{
 const email='secret@example.test', key='Z'.repeat(40);
 const c=m.createDeployHQClient({email,apiKey:key,request:async()=>{throw new Error('failed '+email+' '+key+' Bearer abcdefghijklmnop')}});
 await assert.rejects(()=>c.listServers(),e=>{assert.equal(String(e).includes(email),false);assert.equal(String(e).includes(key),false);assert.equal(String(e).includes('abcdefghijklmnop'),false);return true});
});
