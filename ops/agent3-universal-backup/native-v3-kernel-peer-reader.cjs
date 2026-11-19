'use strict';
/**
 * SOURCE-ONLY Linux accepted-connection credential bridge.
 * Uses synchronous Linux native SO_PEERCRED on the FD from the very
 * net.Socket emitted by a trusted http.Server's 'connection' event.
 *
 * Does NOT compile/load an addon, create sockets or accounts, grant rights,
 * change Production, install Native v3, or authorize any Level-4 action.
 *
 * Production owner must separately pin/verify the native .node binary
 * against a reviewed source build, create the dedicated AF_UNIX listener,
 * bind the exact non-root service identity, and provide independent signed
 * approval/consumed-ledger enforcement with rollback.
 *
 * WARNING: socket._handle.fd is an undocumented Node.js interface.
 * This must be separately reviewed against the exact production runtime,
 * especially process reloads, FD reuse and concurrent connection teardown.
 * Fail-closed validation here is NOT production attestation.
 */
const {Server}=require('node:http');
const {Socket}=require('node:net');

function deny(code){throw Error('agent3_kernel_peer_reader_denied:'+code);}
function socketServerIsUnix(server){
 const address=server?.address?.();
 return server instanceof Server && server.listening===true &&
   typeof address==='string' && address[0]==='/' &&
   address.length>1 && !address.includes('\0');
}
function exactCreds(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const desc=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(value).sort().join('|')!=='gid|pid|uid')
  return false;
 return ['pid','uid','gid'].every(key=>
  Object.hasOwn(desc[key]||{},'value') &&
  Number.isSafeInteger(desc[key].value) &&
  desc[key].value>=0) && desc.pid.value>0;
}
function bindKernelPeerReader({rootServer,nativeAddon}={}){
 if(!socketServerIsUnix(rootServer))
  deny('listening_unix_server_required');
 if(!nativeAddon||typeof nativeAddon.readPeerCredentials!=='function')
  deny('trusted_native_addon_required');
 const accepted=new WeakSet();
 const onConnection=socket=>{
  if(socket instanceof Socket && socket.server===rootServer &&
     !socket.destroyed && socketServerIsUnix(rootServer))
    accepted.add(socket);
 };
 rootServer.on('connection',onConnection);
 function readKernelPeerCredentials(socket){
  if(!socketServerIsUnix(rootServer)||
     !(socket instanceof Socket)||socket.server!==rootServer||
     socket.destroyed||!accepted.has(socket))
    deny('server_accepted_live_socket_required');
  // Only the accepted native server socket is consulted. No HTTP arguments,
  // JSON, peer identity claims, headers or environment are read.
  const handle=socket._handle;
  const fd=handle?.fd;
  if(!Number.isSafeInteger(fd)||fd<0)
    deny('stable_native_fd_unavailable');
  try{
   const out=nativeAddon.readPeerCredentials(fd);
   if(!exactCreds(out))
    deny('invalid_native_kernel_credentials');
   // Synchronous primitive finishes before the JS event loop can execute
   // another connection-close callback. The socket must remain live.
   if(socket.destroyed||socket._handle!==handle||
      socket._handle?.fd!==fd||!accepted.has(socket))
    deny('accepted_socket_changed');
   return Object.freeze({pid:out.pid,uid:out.uid,gid:out.gid});
  }catch(e){
   if(String(e?.message||'').startsWith('agent3_kernel_peer_reader_denied:'))
    throw e;
   deny('native_kernel_peer_query_failed');
  }
 }
 return Object.freeze({
  readKernelPeerCredentials,
  production_attested:false,
  release_ready:false
 });
}
if(require.main===module){
 process.stderr.write('source-only kernel peer reader; no native loader, listener or install\n');
 process.exitCode=78;
}
module.exports=Object.freeze({bindKernelPeerReader,exactCreds});
