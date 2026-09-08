'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const mod=require('./imotion-directadmin-da-api-v1.js');

test('fixed identity and allowlisted endpoints only',()=>{
 assert.equal(mod.USERNAME,'imotion');assert.equal(mod.PRIMARY_DOMAIN,'imotion.ir');assert.equal(mod.ACCOUNT_EMAIL,'admin@imotion.ir');
 assert.deepEqual(mod.ALLOWED_ENDPOINTS,[
 '/CMD_API_ACCOUNT_USER','/CMD_API_SELECT_USERS','/CMD_API_SHOW_ALL_USERS','/CMD_API_SHOW_USER_CONFIG','/CMD_API_DOMAIN_OWNERS','/CMD_API_SHOW_RESELLER_IPS'
 ]);
 assert.throws(()=>mod.assertEndpoint('/CMD_API_ADMIN_STATS'),/not_allowlisted/);
});

test('IP selection prefers server/shared and never owned',()=>{
 assert.equal(mod.selectCreateIp([{ip:'203.0.113.20',status:'free'},{ip:'203.0.113.10',status:'server'},{ip:'203.0.113.11',status:'owned',value:'other'}]),'203.0.113.10');
 assert.equal(mod.selectCreateIp([{ip:'203.0.113.20',status:'free'},{ip:'203.0.113.11',status:'owned'}]),'203.0.113.20');
 assert.throws(()=>mod.selectCreateIp([{ip:'203.0.113.11',status:'owned',value:'other'}]),/no_create_ip_available/);
});

test('custom create payload is fixed, unlimited within account, no SSH, no notification',()=>{
 const p=mod.buildCreatePayload({ip:'203.0.113.10',password:'A'.repeat(32)+'1!'});
 assert.equal(p.username,'imotion');assert.equal(p.domain,'imotion.ir');assert.equal(p.email,'admin@imotion.ir');
 assert.equal(p.notify,'no');assert.equal(p.ssh,'OFF');assert.equal(p.ssl,'ON');assert.equal(p.php,'ON');assert.equal(p.dnscontrol,'ON');assert.equal(p.login_keys,'ON');
 for(const k of ['ubandwidth','uquota','uinode','uvdomains','unsubdomains','unemails','unemailf','unemailml','unemailr','umysql','udomainptr','uftp'])assert.equal(p[k],'ON',k);
 assert.equal(p.passwd,p.passwd2);
 assert.equal(Object.isFrozen(p),true);
});

test('create payload rejects caller-selected username/domain implicitly by having no such inputs',()=>{
 assert.equal(mod.buildCreatePayload.length,1);
 const p=mod.buildCreatePayload({ip:'203.0.113.10',password:'B'.repeat(32)+'2!'});
 assert.equal(p.username,'imotion');assert.equal(p.domain,'imotion.ir');
});

test('delete payload can target only imotion',()=>{
 assert.deepEqual(mod.buildDeletePayload(),{confirmed:'Confirm',delete:'yes',select0:'imotion'});
 assert.throws(()=>mod.buildDeletePayload('admin'),/not_allowlisted/);
});

test('legacy response success parser is fail-closed',()=>{
 assert.equal(mod.isSuccessResponse('error=0&text=ok'),true);
 assert.equal(mod.isSuccessResponse({error:0,text:'ok'}),true);
 assert.equal(mod.isSuccessResponse('error=1&text=bad'),false);
 assert.equal(mod.isSuccessResponse({error:1}),false);
 assert.equal(mod.isSuccessResponse('text=missing'),false);
});

test('public evidence redacts generated password and credential-bearing URL',()=>{
 const p=mod.buildCreatePayload({ip:'203.0.113.10',password:'C'.repeat(32)+'3!'});
 const e=mod.publicCreateEvidence(p);
 assert.equal(e.payload.passwd,'[REDACTED]');assert.equal(e.payload.passwd2,'[REDACTED]');
 const x=mod.sanitize({api_url:'https://admin:key@example:2222',message:'https://admin:key@example:2222/CMD'});
 assert.equal(x.api_url,'[REDACTED]');assert.equal(x.message,'[REDACTED]');
});
