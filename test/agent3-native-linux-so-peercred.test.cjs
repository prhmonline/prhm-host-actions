'use strict';
/*
 * Linux-only integration test. Builds its own unprivileged N-API fixture
 * in an isolated temporary directory; nothing is installed on the host.
 * Verifies SO_PEERCRED on an actual accepted AF_UNIX HTTP connection.
 *
 * This does NOT prove that the production root listener has a reviewed
 * kernel-backed verifier, that this test fixture can be used in production,
 * or that any privileged registration/deployment is authorized.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const http=require('node:http');
const {Socket}=require('node:net');
const {AsyncLocalStorage}=require('node:async_hooks');
const vm=require('node:vm');

const source=path.join(__dirname,'fixtures/agent3-linux-so-peercred-fixture.c');
const bridgeSource=path.resolve(__dirname,'../ops/agent3-universal-backup/native-v3-root-http-bridge.cjs');
const route='/v3/agent3-registry/request';

function readHeadersDir(){
 const candidates=[
  path.resolve(path.dirname(process.execPath),'../include/node'),
  '/usr/include/node','/usr/local/include/node'
 ];
 const resolved=candidates.find(p=>fs.existsSync(path.join(p,'node_api.h')));
 assert.ok(resolved,'node_api.h is required: do not silently skip kernel test');
 return resolved;
}
function compileNativeFixture(temp){
 const binary=path.join(temp,'agent3-peercred-fixture.node');
 cp.execFileSync('cc',[
  '-std=c11','-O2','-Wall','-Wextra','-Werror',
  '-fPIC','-shared','-I'+readHeadersDir(),source,'-o',binary
 ],{timeout:25000,stdio:['ignore','pipe','pipe']});
 return require(binary);
}
function simulatedUnprivilegedBridge(){
 const module={exports:{}};
 const nativeRoute={
  bind({assertAuthenticatedTransport}){
   return Object.freeze({
    paths:Object.freeze([route]),
    async handle(){
     if(await assertAuthenticatedTransport()!==true)
      throw Error('kernel_peer_credentials_rejected');
     return {handled:true,response:{source_only:true}};
    }
   });
  }
 };
 vm.runInNewContext(fs.readFileSync(bridgeSource,'utf8'),{
  module,
  require(name){
   if(name==='node:async_hooks')return {AsyncLocalStorage};
   if(name==='node:http')return {IncomingMessage:http.IncomingMessage,Server:http.Server};
   if(name==='node:net')return {Socket};
   if(name==='./native-v3-root-route-binding.cjs')return nativeRoute;
   throw Error('unexpected_import:'+name);
  },
  // The fixture evaluates root-gated code without being root. This facade
  // is a TEST ONLY and cannot authorize or connect to production services.
  process:{getuid:()=>0,stderr:{write(){}}},
  Error,Object,Array
 },{filename:'agent3-linux-peercred-unprivileged-fixture.cjs',timeout:1800});
 return module.exports;
}
function sendUnix(socketPath,headers={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({socketPath,path:route,method:'POST',headers},res=>{
   let body='';res.setEncoding('utf8');
   res.on('data',part=>{body+=part;});
   res.on('end',()=>resolve({status:res.statusCode,body}));
  });
  req.on('error',reject);
  req.end('{"uid":0,"gid":0,"pid":1,"authenticated":true}');
 });
}

test('real kernel SO_PEERCRED gates AF_UNIX request regardless of forged HTTP identity', {
 skip:process.platform!=='linux'
},async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-peercred-test-'));
 let server;
 try{
  const addon=compileNativeFixture(temp);
  assert.equal(typeof addon.readPeerCredentials,'function');
  assert.throws(()=>addon.readPeerCredentials(-1),/peercred_invalid_fd/);
  assert.throws(()=>addon.readPeerCredentials('4'),/peercred_integer_fd_required/);

  const sock=path.join(temp,'root.sock');
  let allowedUid=process.getuid();
  const observed=[];
  let bridge;
  server=http.createServer((req,res)=>{
   bridge.handleRequest(req,{approved:true,uid:0}).then(()=>{
    res.writeHead(200);res.end('accepted');
   }).catch(e=>{
    res.writeHead(403);res.end(e.message);
   });
  });
  await new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen(sock,resolve);
  });
  bridge=simulatedUnprivilegedBridge().bindRootHttp({
   rootServer:server,rootCapabilities:Object.freeze({ci_only:true}),
   basePost:async()=>({}),
   assertNativePeer(socket){
    // Internal fd access is used ONLY by this test. This is not a
    // reviewed stable production Node-to-native descriptor interface.
    const fd=socket?._handle?.fd;
    const c=addon.readPeerCredentials(fd);
    observed.push(c);
    return c.pid===process.pid &&
      c.uid===allowedUid && c.gid===process.getgid();
   }
  });
  const forged={'x-peer-uid':'0','x-peer-gid':'0','x-peer-pid':'1'};
  const accepted=await sendUnix(sock,forged);
  assert.deepEqual(accepted,{status:200,body:'accepted'});
  assert.deepEqual(observed[0],{
   pid:process.pid,uid:process.getuid(),gid:process.getgid()
  });

  // Changing only the server-owned expected identity must deny the
  // exact same forged claims. The HTTP client cannot alter SO_PEERCRED.
  allowedUid=process.getuid()+1;
  const rejected=await sendUnix(sock,forged);
  assert.equal(rejected.status,403);
  assert.match(rejected.body,/kernel_peer_credentials_rejected/);
  assert.equal(observed.length,2);
  assert.equal(observed[1].uid,process.getuid());
  assert.equal(observed[1].pid,process.pid);
 }finally{
  if(server?.listening)
   await new Promise(resolve=>server.close(resolve));
  fs.rmSync(temp,{recursive:true,force:true});
 }
});
