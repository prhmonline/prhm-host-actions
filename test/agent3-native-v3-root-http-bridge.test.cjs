'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const child=require('node:child_process');
const {IncomingMessage,Server}=require('node:http');
const rootServer=new Server();
Object.defineProperty(rootServer,'listening',{value:true});
Object.defineProperty(rootServer,'address',{value:()=>'/run/prhm-root-http-test.sock'});
const {Socket}=require('node:net');
const {AsyncLocalStorage}=require('node:async_hooks');
const file=path.resolve(__dirname,'../ops/agent3-universal-backup/native-v3-root-http-bridge.cjs');
const REQUEST='/v3/agent3-registry/request';
const EXECUTE='/v3/agent3-registry/execute';
function fixture(uid=0){
 const events=[];
 const mock={
  bind(opts){
   events.push(['bind']);
   return Object.freeze({
    paths:Object.freeze([REQUEST,EXECUTE]),
    async handle(envelope){
     events.push(['start',envelope.url]);
     const first=await opts.assertAuthenticatedTransport();
     await new Promise(resolve=>setImmediate(resolve));
     const second=await opts.assertAuthenticatedTransport();
     if(first!==true||second!==true)
      throw Error('peer_auth_not_confirmed');
     events.push(['finish',envelope.url]);
     return {handled:true,response:{source_only:true,url:envelope.url}};
    }
   });
  }
 };
 const m={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{
  module:m,
  require:name=>{
   if(name==='node:async_hooks')return {AsyncLocalStorage};
   if(name==='node:http')return {IncomingMessage,Server};
   if(name==='node:net')return {Socket};
   if(name==='./native-v3-root-route-binding.cjs')return mock;
   throw Error('unexpected_require:'+name);
  },
  process:{getuid:()=>uid,stderr:{write(){}}},
  Object,Array,Error
 },{filename:'root-http-bridge-fixture.cjs',timeout:1800});
 return {bridge:m.exports,events};
}
function request(url=REQUEST,method='POST'){
 const req=new IncomingMessage(new Socket());
 req.socket.server=rootServer;
 req.method=method;
 req.url=url;
 return req;
}
test('one root-owned binding reused across multiple incoming HTTP requests',async()=>{
 const f=fixture();let calls=0;
 const bound=f.bridge.bindRootHttp({rootServer,basePost:async()=>({}),
  rootCapabilities:Object.freeze({readOnlyFixture:true}),
  assertNativePeer:socket=>{calls++;return socket instanceof Socket;}
 });
 const req1=request(REQUEST),req2=request(EXECUTE);
 const [r1,r2]=await Promise.all([
  bound.handleRequest(req1,{manifest_sha256:'a'.repeat(64)}),
  bound.handleRequest(req2,{manifest_sha256:'b'.repeat(64)})
 ]);
 assert.equal(r1.response.url,REQUEST);
 assert.equal(r2.response.url,EXECUTE);
 assert.equal(calls,4);
 assert.equal(f.events.filter(x=>x[0]==='bind').length,1);
});
test('request peer identity is captured per async context, never from body or headers',async()=>{
 const f=fixture();const req1=request(),req2=request(EXECUTE);
 const seen=[];
 const bound=f.bridge.bindRootHttp({rootServer,basePost:()=>({}),rootCapabilities:{},
  assertNativePeer:socket=>{seen.push(socket);return socket===req1.socket||socket===req2.socket;}
 });
 req1.headers={'x-peer-uid':'0'};
 await Promise.all([bound.handleRequest(req1,{uid:0,authenticated:true}),
  bound.handleRequest(req2,{uid:0,authenticated:true})]);
 assert.equal(seen.length,4);
 assert.equal(seen.filter(x=>x===req1.socket).length,2);
 assert.equal(seen.filter(x=>x===req2.socket).length,2);
});
test('caller-constructed plain objects and unrelated routes cannot impersonate a root HTTP request',async()=>{
 const f=fixture();let peerCalls=0;
 const bound=f.bridge.bindRootHttp({rootServer,basePost:()=>({}),rootCapabilities:{},
  assertNativePeer:()=>{peerCalls++;return true;}
 });
 await assert.rejects(bound.handleRequest({url:REQUEST,method:'POST',
  socket:{serverAuthenticated:true}},{}),/server_created_http_request_required/);
 assert.equal((await bound.handleRequest(request('/v2/host-actions/request'),{})).handled,false);
 await assert.rejects(bound.handleRequest(request(REQUEST,'GET'),{}),/post_only/);
 assert.equal(peerCalls,0);
});
test('denied or missing live peer verification fails closed with no false approval',async()=>{
 const f=fixture();
 assert.throws(()=>f.bridge.bindRootHttp({rootServer,basePost:()=>({}),rootCapabilities:{}}),
  /fixed_root_dependencies_required/);
 const bound=f.bridge.bindRootHttp({rootServer,basePost:()=>({}),rootCapabilities:{},
  assertNativePeer:()=>false
 });
 await assert.rejects(bound.handleRequest(request(),{approved:true}),
  /peer_auth_not_confirmed/);
});
test('TCP, forged socket and destroyed native socket fail before calling peer verifier',async()=>{
 const f=fixture();let peerCalls=0;
 const bound=f.bridge.bindRootHttp({rootServer,basePost:async()=>({}),
  rootCapabilities:{},assertNativePeer:()=>{peerCalls++;return true;}
 });
 for(const [field,value] of [
  ['remoteAddress','127.0.0.1'],['remotePort',32768],
  ['remoteFamily','IPv4']
 ]){
  const req=request();
  Object.defineProperty(req.socket,field,{value,configurable:true});
  await assert.rejects(bound.handleRequest(req,{}),/native_local_socket_required/);
 }
 const forged=request();
 forged.socket={destroyed:false,remoteAddress:undefined,remotePort:undefined};
 await assert.rejects(bound.handleRequest(forged,{}),/native_local_socket_required/);
 const stale=request();stale.socket.destroy();
 await assert.rejects(bound.handleRequest(stale,{}),/native_local_socket_required/);
 assert.equal(peerCalls,0);
 assert.equal(f.events.filter(x=>x[0]==='start').length,0);
});
test('local-looking socket is not trusted without independent OS peer verifier',async()=>{
 const f=fixture();let calls=0;
 const bound=f.bridge.bindRootHttp({rootServer,basePost:()=>({}),rootCapabilities:{},
  assertNativePeer:()=>{calls++;return false;}
 });
 await assert.rejects(bound.handleRequest(request(),{}),/peer_auth_not_confirmed/);
 assert.equal(calls,2);
});
test('async peer verification rejects replacement socket and rewritten request route',async()=>{
 const f=fixture();
 const req=request();
 const original=req.socket;
 let calls=0;
 const bound=f.bridge.bindRootHttp({rootServer,basePost:()=>({}),rootCapabilities:{},
  assertNativePeer:async socket=>{
   calls++;
   assert.equal(socket,original);
   await Promise.resolve();
   req.socket=new Socket();
   return true;
  }
 });
 await assert.rejects(bound.handleRequest(req,{}),/peer_auth_not_confirmed/);
 assert.equal(calls,1);
 assert.equal(f.events.filter(x=>x[0]==='finish').length,0);

 const f2=fixture();
 const req2=request();
 const bound2=f2.bridge.bindRootHttp({rootServer,basePost:()=>({}),rootCapabilities:{},
  assertNativePeer:async()=>{
   await Promise.resolve();
   req2.url=EXECUTE;
   return true;
  }
 });
 await assert.rejects(bound2.handleRequest(req2,{}),/peer_auth_not_confirmed/);
 assert.equal(f2.events.filter(x=>x[0]==='finish').length,0);
});
test('closed peer and nonliteral asynchronous verifier response fail closed',async()=>{
 const f=fixture();const req=request();
 const bound=f.bridge.bindRootHttp({rootServer,basePost:()=>({}),rootCapabilities:{},
  assertNativePeer:async socket=>{socket.destroy();return true;}
 });
 await assert.rejects(bound.handleRequest(req,{}),/peer_auth_not_confirmed/);
 const other=fixture();
 const bound2=other.bridge.bindRootHttp({rootServer,basePost:()=>({}),rootCapabilities:{},
  assertNativePeer:async()=>({verified:true})
 });
 await assert.rejects(bound2.handleRequest(request(),{}),/peer_auth_not_confirmed/);
 assert.equal(other.events.filter(x=>x[0]==='finish').length,0);
});
test('binding rejects missing, inactive or TCP HTTP listeners before native routing',()=>{
 const f=fixture();
 const args={basePost:()=>({}),rootCapabilities:{},assertNativePeer:()=>true};
 const inactive=new Server();
 const tcp=new Server();
 Object.defineProperty(tcp,'listening',{value:true});
 Object.defineProperty(tcp,'address',{value:()=>({address:'127.0.0.1',port:8123,family:'IPv4'})});
 for(const invalid of [undefined,inactive,tcp,{},{
   address:()=>'/run/forged.sock',listening:true
 }])
  assert.throws(()=>f.bridge.bindRootHttp({...args,rootServer:invalid}),
   /fixed_root_dependencies_required/);
 assert.equal(f.events.length,0);
});
test('foreign accepted socket and listener switch fail before peer verifier',async()=>{
 const f=fixture();let verifies=0;
 const bound=f.bridge.bindRootHttp({rootServer,basePost:()=>({}),
  rootCapabilities:{},assertNativePeer:()=>{verifies++;return true;}
 });
 const foreign=request();
 foreign.socket.server=new Server();
 await assert.rejects(bound.handleRequest(foreign,{}),/native_local_socket_required/);
 assert.equal(verifies,0);
 const serverAddress=rootServer.address;
 try{
  rootServer.address=()=>({address:'127.0.0.1',port:8100,family:'IPv4'});
  await assert.rejects(bound.handleRequest(request(),{}),/native_local_socket_required/);
  assert.equal(verifies,0);
 }finally{rootServer.address=serverAddress;}
});
test('root-only source has no listener, installer or independent approval function',()=>{
 const f=fixture(1001);
 assert.throws(()=>f.bridge.bindRootHttp({rootServer,basePost:()=>({}),rootCapabilities:{},
  assertNativePeer:()=>true}),/root_executor_only/);
 const trusted=fixture();
 assert.equal(typeof trusted.bridge.install,'undefined');
 assert.equal(typeof trusted.bridge.listen,'undefined');
 assert.equal(typeof trusted.bridge.issueApproval,'undefined');
 const p=child.spawnSync(process.execPath,[file,'--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(p.status,78);
 assert.match(p.stderr,/no standalone listener or install/);
});
