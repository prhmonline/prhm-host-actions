#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const m=require('./deployhq-control-adapter-v1.js');

const FIXED={
  name:'PRHM Host Bootstrap - node1', hostname:'185.191.76.138', port:22022,
  username:'root', protocol_type:'ssh', server_path:'/root', branch:'main', auto_deploy:false
};
const temp=(id)=>({identifier:id,name:'TEMP Honartik iTicket V14 registration preflight f7116949',hostname:'185.191.76.138',port:22022,username:'root',protocol_type:'ssh',server_path:'/tmp/x',branch:'main',auto_deploy:false});
function req(app,method,path,body){return new Promise((resolve,reject)=>{const srv=http.createServer(app);srv.listen(0,'127.0.0.1',()=>{const {port}=srv.address();const r=http.request({host:'127.0.0.1',port,method,path,headers:{'content-type':'application/json'}},res=>{let b='';res.on('data',d=>b+=d);res.on('end',()=>{srv.close();resolve({status:res.statusCode,body:b?JSON.parse(b):null})})});r.on('error',e=>{srv.close();reject(e)});if(body!==undefined)r.write(JSON.stringify(body));r.end()})})}

test('fixed node1 contract is immutable',()=>{assert.deepEqual(m.FIXED_NODE1,FIXED)});
test('normalization omits secret-like fields',()=>{const n=m.normalizeServer({...FIXED,identifier:'x',password:'p',token:'t',secret:'s'});assert.equal(n.identifier,'x');assert.equal(n.password,undefined);assert.equal(n.token,undefined);assert.equal(n.secret,undefined)});
test('classifies exact duplicate idempotently',()=>{const c=m.classifyCanonical([{...FIXED,identifier:'canon'}]);assert.deepEqual(c,{state:'exact',identifier:'canon'})});
test('same-name wrong config fails closed',()=>{const c=m.classifyCanonical([{...FIXED,identifier:'bad',server_path:'/wrong'}]);assert.equal(c.state,'conflict')});
test('create-fixed creates one canonical and no deployment/command side effect',async()=>{let creates=0,lists=0;const deps={listServers:async()=>{lists++;return lists===1?[temp('t1')]:[temp('t1'),{...FIXED,identifier:'new1'}]},createFixedServer:async()=>{creates++;return {...FIXED,identifier:'new1'}},deleteCreatedServer:async()=>{},deploymentSnapshot:async()=>({count:5,last:'d5'}),commandSnapshot:async()=>({count:8,last:'c8'})};const app=m.createAdapter(deps);const r=await req(app,'POST','/v1/node1/create-fixed');assert.equal(r.status,201);assert.equal(r.body.ok,true);assert.equal(r.body.canonical_identifier,'new1');assert.equal(r.body.deployment_executed,false);assert.equal(r.body.command_executed,false);assert.equal(creates,1)});
test('request body cannot override fixed node1 fields',async()=>{let creates=0;const deps={listServers:async()=>[],createFixedServer:async()=>{creates++;return {...FIXED,identifier:'x'}},deleteCreatedServer:async()=>{},deploymentSnapshot:async()=>({count:0}),commandSnapshot:async()=>({count:0})};const r=await req(m.createAdapter(deps),'POST','/v1/node1/create-fixed',{hostname:'evil'});assert.equal(r.status,400);assert.equal(creates,0)});
test('unknown route fails closed without outbound mutation',async()=>{let calls=0;const deps={listServers:async()=>{calls++;return[]},createFixedServer:async()=>{calls++;},deleteCreatedServer:async()=>{},deploymentSnapshot:async()=>({count:0}),commandSnapshot:async()=>({count:0})};const r=await req(m.createAdapter(deps),'POST','/v1/proxy',{x:1});assert.equal(r.status,404);assert.equal(calls,0)});
test('temp Honartik target drift triggers rollback of newly created target only',async()=>{let lists=0,deleted=[];const deps={listServers:async()=>{lists++;return lists===1?[temp('t1')]:[temp('t2'),{...FIXED,identifier:'new1'}]},createFixedServer:async()=>({...FIXED,identifier:'new1'}),deleteCreatedServer:async(id)=>deleted.push(id),deploymentSnapshot:async()=>({count:1,last:'d1'}),commandSnapshot:async()=>({count:1,last:'c1'})};const r=await req(m.createAdapter(deps),'POST','/v1/node1/create-fixed');assert.equal(r.status,409);assert.deepEqual(deleted,['new1']);assert.equal(r.body.error,'honartik_targets_changed')});
test('redact removes bearer/token-like values recursively',()=>{const out=m.redact({a:'Bearer abcdefghijklmnop',token:'secret-value',nested:{password:'pw',safe:'ok'}});assert.equal(out.a,'[REDACTED]');assert.equal(out.token,'[REDACTED]');assert.equal(out.nested.password,'[REDACTED]');assert.equal(out.nested.safe,'ok')});


test('rollback delete is allowed only for an identifier created by this adapter process',async()=>{
 let lists=0,deleted=[];const deps={listServers:async()=>{lists++;return lists===1?[]:[{...FIXED,identifier:'11111111-1111-4111-8111-111111111111'}]},createFixedServer:async()=>({...FIXED,identifier:'11111111-1111-4111-8111-111111111111'}),deleteCreatedServer:async id=>deleted.push(id),deploymentSnapshot:async()=>({count:0}),commandSnapshot:async()=>({count:0})};
 const app=m.createAdapter(deps);const c=await req(app,'POST','/v1/node1/create-fixed');assert.equal(c.status,201);
 const bad=await req(app,'DELETE','/v1/node1/22222222-2222-4222-8222-222222222222');assert.equal(bad.status,403);assert.deepEqual(deleted,[]);
 const good=await req(app,'DELETE','/v1/node1/11111111-1111-4111-8111-111111111111');assert.equal(good.status,200);assert.deepEqual(deleted,['11111111-1111-4111-8111-111111111111']);
 const replay=await req(app,'DELETE','/v1/node1/11111111-1111-4111-8111-111111111111');assert.equal(replay.status,403);assert.deepEqual(deleted,['11111111-1111-4111-8111-111111111111']);
});
