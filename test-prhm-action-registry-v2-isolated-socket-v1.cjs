'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const cp=require('node:child_process');
const S=require('./prhm-action-registry-v2-isolated-socket-v1.cjs');
const P=require('./prhm-action-registry-v2-base-http-patch-v1.cjs');
const G=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const RELEASE=require('./manifests/honartik-config-center-registry-release-v2.json');
function io({socket=false,mode=0o40700,uid=0}={}){
 return {lstatSync:p=>{
  if(p===S.SOCKET_DIR)return {isDirectory:()=>true,isSymbolicLink:()=>false,
   uid,gid:0,mode};
  if(p===S.SOCKET&&socket)return {isDirectory:()=>false};
  const e=Error('ENOENT');e.code='ENOENT';throw e;
 },realpathSync:p=>p};
}
test('dedicated root cgroup and 0700 root-owned socket directory mandatory',()=>{
 const cgroup=()=> '0::/system.slice/'+S.UNIT+'\n';
 assert.equal(S.checkRuntime(io(),()=>0,cgroup),true);
 for(const opt of [{uid:1000},{mode:0o40755},{socket:true}]){
  assert.throws(()=>S.checkRuntime(io(opt),()=>0,cgroup),
   /registry_v2_socket_/);
 }
 assert.throws(()=>S.checkRuntime(io(),()=>1000,cgroup),/root_required/);
 assert.throws(()=>S.checkRuntime(io(),()=>0,
  ()=>'0::/system.slice/prhm-agent-selfmaint.service'),/separate_root_systemd_unit_required/);
});
async function request(socketPath,url,body,method='POST'){
 return await new Promise((resolve,reject)=>{
  const data=Buffer.from(typeof body==='string'?body:JSON.stringify(body));
  const q=http.request({socketPath,path:url,method,headers:{'content-type':'application/json',
   'content-length':data.length}},res=>{
    const chunks=[];
    res.on('data',x=>chunks.push(x));
    res.on('end',()=>{
     const text=Buffer.concat(chunks).toString();
     try{resolve({status:res.statusCode,headers:res.headers,value:JSON.parse(text)})}
     catch(e){reject(e)}
    });
  });
  q.on('error',reject);q.end(data);
 });
}
async function withServer(factory,run){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-registry-v2-socket-'));
 const sock=tmp+'/sock';
 const server=S.createIsolatedServer(factory);
 try{
  await new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen(sock,resolve);
  });
  await run(sock);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(tmp,{recursive:true,force:true});
 }
}
test('real AF_UNIX HTTP isolated route accepts only fixed paths, no TCP listener',async()=>{
 let hits=0;
 await withServer(()=>({dispatch:async(m,url,body)=>{
  hits++;
  assert.equal(m,'POST');
  assert.equal(url,'/v2/registry/honartik/request');
  assert.deepEqual(body,G.REQUEST);
  return {ok:true,status:'pending',secret_exposed:false,
   request_id:'11111111-1111-4111-8111-111111111111',
   action:G.REQUEST.action,arguments_sha256:G.ARGUMENTS_SHA};
 }}),async sock=>{
  const r=await request(sock,'/v2/registry/honartik/request',G.REQUEST);
  assert.equal(r.status,201);assert.equal(r.value.secret_exposed,false);
  assert.equal(r.headers['cache-control'],'no-store');
  assert.equal(JSON.stringify(r.value).includes('approval_token'),false);
  const legacy=await request(sock,'/v2/host-actions/request',{action:G.REQUEST.action});
  assert.equal(legacy.status,404);
  const wrong=await request(sock,'/v2/registry/other/execute',G.REQUEST);
  assert.equal(wrong.status,404);
  const get=await request(sock,'/v2/registry/honartik/request',G.REQUEST,'GET');
  assert.equal(get.status,404);
  assert.equal(hits,1);
 });
});
test('socket redacts internal errors and never exposes real or forged approval secrets',async()=>{
 await withServer(()=>({dispatch:async()=>{throw Error('SECRET_PRIVATE_TOKEN')}}),
 async sock=>{
  const r=await request(sock,'/v2/registry/honartik/confirm',
   {...G.REQUEST,request_id:'1',second_confirmation:G.CONFIRM});
  assert.equal(r.status,409);assert.equal(r.value.ok,false);
  assert.equal(JSON.stringify(r.value).includes('SECRET_PRIVATE_TOKEN'),false);
 });
 await withServer(()=>({dispatch:async()=>({
  ok:true,status:'approved',secret_exposed:false,approval_token:'LEAK'
 })}),async sock=>{
  const r=await request(sock,'/v2/registry/honartik/confirm',{...G.REQUEST});
  assert.equal(r.status,409);assert.equal(JSON.stringify(r.value).includes('LEAK'),false);
 });
});
test('unexpected nested response, keys or token-derived fields are never returned to clients',async()=>{
 await withServer(()=>({dispatch:async()=>({
  ok:true,status:'pending',secret_exposed:false,
  request_id:'11111111-1111-4111-8111-111111111111',
  action:G.REQUEST.action,arguments_sha256:G.ARGUMENTS_SHA,
  approval:{token:'SECRET_JWS'}
 })}),async sock=>{
  const r=await request(sock,'/v2/registry/honartik/request',G.REQUEST);
  assert.equal(r.status,409);
  assert.equal(JSON.stringify(r.value).includes('SECRET_JWS'),false);
 });
 const src=fs.readFileSync('./prhm-action-registry-v2-isolated-socket-v1.cjs','utf8');
 assert.ok(src.indexOf('process.umask(0o077)')<src.indexOf('server.listen(SOCKET'));
});
test('oversized HTTP request fails without ever invoking an L4 capability',async()=>{
 let called=0;
 await withServer(()=>{called++;return {dispatch:async()=>({ok:true,secret_exposed:false})}},
 async sock=>{
  const r=await request(sock,'/v2/registry/honartik/execute','a'.repeat(S.MAX_BODY+1));
  assert.equal(r.status,413);
  assert.equal(called,0);
 });
});
test('original base owner must remain unchanged; previously reviewed patch is disabled',()=>{
 const synthetic=Buffer.from("const HOST_ACTIONS_V2_BASE_MARKER = true;".repeat(90));
 assert.throws(()=>P.prepare(synthetic),/current_base_sha_drift/);
 const source=fs.readFileSync('./prhm-action-registry-v2-base-http-patch-v1.cjs','utf8');
 assert.ok(source.includes("fail('protected_owner_preimage_circularity_use_isolated_socket')"));
 assert.equal(RELEASE.registry_owners.base.before_sha256,P.PINNED_BEFORE);
 const sourceSocket=fs.readFileSync('./prhm-action-registry-v2-isolated-socket-v1.cjs','utf8');
 assert.ok(sourceSocket.includes('createIsolatedServer'));
 assert.equal(sourceSocket.includes('server.listen(0'),false);
});
test('standalone sidecar cannot bind outside reviewed systemd or without trusted provider',()=>{
 const p=cp.spawnSync(process.execPath,['prhm-action-registry-v2-isolated-socket-v1.cjs'],
  {cwd:__dirname,encoding:'utf8',timeout:7000});
 assert.equal(p.status,78);
 assert.match(p.stderr,/registry_v2_socket_root_required|registry_v2_socket_separate_root_systemd_unit_required/);
});
