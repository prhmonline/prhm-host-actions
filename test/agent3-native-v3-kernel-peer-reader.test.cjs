'use strict';
/**
 * Actual AF_UNIX accepted-socket, N-API SO_PEERCRED integration.
 * Builds native C solely in a disposable nonprivileged CI temp directory.
 * Does NOT deploy/install or use a production socket/path.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const http=require('node:http');
const {Socket}=require('node:net');
const reader=require('../ops/agent3-universal-backup/native-v3-kernel-peer-reader.cjs');
const source=path.resolve(__dirname,
 '../ops/agent3-universal-backup/native-linux-so-peercred-addon.c');
function headers(){
 const options=[
  path.resolve(path.dirname(process.execPath),'../include/node'),
  '/usr/include/node','/usr/local/include/node'
 ];
 const found=options.find(dir=>fs.existsSync(path.join(dir,'node_api.h')));
 assert.ok(found,'node_api.h unavailable: kernel test must not silently skip');
 return found;
}
function compile(dir){
 const output=path.join(dir,'peercred-ci.node');
 cp.execFileSync('cc',[
  '-std=c11','-O2','-Wall','-Wextra','-Werror',
  '-fPIC','-shared','-I'+headers(),source,'-o',output,'-lm'
 ],{stdio:['ignore','pipe','pipe'],timeout:25000});
 return require(output);
}
function requestUnix(sock,headers={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({
   socketPath:sock,path:'/v3/agent3-registry/request',
   method:'POST',headers
  },res=>{
   let body='';res.setEncoding('utf8');
   res.on('data',chunk=>{body+=chunk});
   res.on('end',()=>resolve({status:res.statusCode,body}));
  });
  req.on('error',reject);
  req.end(JSON.stringify({uid:0,gid:0,pid:1,authenticated:true}));
 });
}
function sendChild(sock){
 const code=[
  "const h=require('node:http');",
  "const req=h.request({socketPath:process.argv[1],method:'POST',",
  "path:'/v3/agent3-registry/request',headers:{'x-peer-uid':'0',",
  "'x-peer-gid':'0','x-peer-pid':'1'}},r=>{let b='';",
  "r.setEncoding('utf8');r.on('data',x=>b+=x);",
  "r.on('end',()=>process.stdout.write(JSON.stringify({status:r.statusCode,body:b})));});",
  "req.on('error',e=>{console.error(e.message);process.exitCode=1;});",
  "req.end(JSON.stringify({uid:0,gid:0,pid:1,authenticated:true}));"
 ].join('\n');
 const child=cp.spawn(process.execPath,['-e',code,sock],
  {stdio:['ignore','pipe','pipe']});
 const p=new Promise((resolve,reject)=>{
  let out='',err='';
  child.stdout.setEncoding('utf8');child.stdout.on('data',s=>out+=s);
  child.stderr.setEncoding('utf8');child.stderr.on('data',s=>err+=s);
  child.on('error',reject);
  child.on('close',code=>{
   if(code!==0)return reject(Error('child_test_failed:'+err));
   try{resolve(JSON.parse(out));}catch(e){reject(e);}
  });
 });
 return {pid:child.pid,result:p};
}
test('native addon rejects invalid descriptor, non-FD and fractional or listener FD',{
 skip:process.platform!=='linux'
},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent3-native-fd-'));
 try{
  const native=compile(dir);
  assert.equal(typeof native.readPeerCredentials,'function');
  assert.throws(()=>native.readPeerCredentials(-1),/peercred_integer_fd_required|peercred_socket_fd_required/);
  assert.throws(()=>native.readPeerCredentials('7'),/peercred_integer_fd_required/);
  assert.throws(()=>native.readPeerCredentials(3.5),/peercred_integer_fd_required/);
  const regularFd=fs.openSync(path.join(dir,'regular.txt'),'w');
  try{
   assert.throws(()=>native.readPeerCredentials(regularFd),
    /peercred_socket_fd_required/);
  }finally{fs.closeSync(regularFd);}
  assert.throws(()=>native.readPeerCredentials(),/peercred_exactly_one_fd_required/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('synchronous kernel SO_PEERCRED binds to accepted AF_UNIX server peer; forged identity ignored',{
 skip:process.platform!=='linux'
},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent3-native-v3-'));
 const sock=path.join(dir,'trusted.sock');
 let server;
 try{
  const native=compile(dir);
  let bound;
  server=http.createServer((req,res)=>{
   try{
    const creds=bound.readKernelPeerCredentials(req.socket);
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify(creds));
   }catch(e){
    res.writeHead(403);
    res.end(e.message);
   }
  });
  await new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen(sock,resolve);
  });
  bound=reader.bindKernelPeerReader({rootServer:server,nativeAddon:native});
  assert.equal(bound.production_attested,false);
  assert.equal(bound.release_ready,false);
  assert.throws(()=>bound.readKernelPeerCredentials(new Socket()),
   /server_accepted_live_socket_required/);
  const local=await requestUnix(sock,{
   'x-peer-uid':'0','x-peer-gid':'0','x-peer-pid':'1'
  });
  assert.equal(local.status,200);
  const p=JSON.parse(local.body);
  assert.deepEqual(p,{pid:process.pid,uid:process.getuid(),gid:process.getgid()});

  const child=sendChild(sock);
  assert.ok(child.pid>0&&child.pid!==process.pid);
  const received=await child.result;
  assert.equal(received.status,200);
  const cpCreds=JSON.parse(received.body);
  assert.equal(cpCreds.pid,child.pid);
  assert.equal(cpCreds.uid,process.getuid());
  assert.equal(cpCreds.gid,process.getgid());
  assert.notEqual(cpCreds.pid,1);
 }finally{
  if(server?.listening)await new Promise(resolve=>server.close(resolve));
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
test('kernel reader rejects direct TCP listener, unattached socket and untrusted C return',async()=>{
 const tcp=http.createServer();
 const fakeNative={readPeerCredentials:()=>({
  pid:1,uid:1001,gid:1002,approved:true
 })};
 await new Promise((resolve,reject)=>{
  tcp.once('error',reject);
  tcp.listen(0,'127.0.0.1',resolve);
 });
 try{
  assert.throws(()=>reader.bindKernelPeerReader({
   rootServer:tcp,nativeAddon:fakeNative
  }),/listening_unix_server_required/);
 }finally{await new Promise(resolve=>tcp.close(resolve));}
 assert.equal(reader.exactCreds({pid:12,uid:1001,gid:1002}),true);
 assert.equal(reader.exactCreds({
  pid:12,uid:1001,gid:1002,approved:true
 }),false);
 assert.equal(reader.exactCreds({pid:0,uid:1001,gid:1002}),false);
 assert.equal(reader.exactCreds({
  pid:12,uid:1001,get gid(){throw Error('getter');}
 }),false);
});
test('source-only modules never run as installers',()=>{
 const file=path.resolve(__dirname,
  '../ops/agent3-universal-backup/native-v3-kernel-peer-reader.cjs');
 const r=cp.spawnSync(process.execPath,[file,'--apply'],{
  encoding:'utf8',timeout:10000
 });
 assert.equal(r.status,78);
 assert.match(r.stderr,/source-only kernel peer reader/);
});
