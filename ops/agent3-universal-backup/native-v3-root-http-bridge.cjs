'use strict';
/**
 * Native v3 HTTP-integration boundary for a FUTURE reviewed, root-owned
 * Executor. SOURCE ONLY. Nothing here starts a server, writes files,
 * authorizes a request, consumes Level-4 approvals or installs Registry.
 *
 * The existing authenticated root HTTP server must call handleRequest with
 * the server-created IncomingMessage. The caller cannot supply this through
 * JSON or MCP tools. Real AF_UNIX peer authentication MUST be provided by
 * the trusted root owner and derived exclusively from the native socket.
 *
 * One shared native executor instance is bound for the entire process,
 * preserving same-process in-flight execution guard across HTTP requests.
 * AsyncLocalStorage isolates each peer-auth check to its HTTP request.
 */
const {AsyncLocalStorage}=require('node:async_hooks');
const {IncomingMessage,Server}=require('node:http');
const {Socket}=require('node:net');
const native=require('./native-v3-root-route-binding.cjs');
function deny(code){throw Error('agent3_root_http_bridge_denied:'+code);}
function rootOnly(){
 if(typeof process.getuid!=='function'||process.getuid()!==0)
  deny('root_executor_only');
}
// Network sockets cannot be accepted even if the injected verifier is
// accidentally configured to return true. This negative guard does NOT
// establish AF_UNIX peer credentials: the trusted OS verifier is mandatory.
function eligibleNativeLocalSocket(socket){
 return socket instanceof Socket && socket.destroyed!==true &&
   socket.remoteAddress===undefined &&
   socket.remotePort===undefined &&
   socket.remoteFamily===undefined;
}
// An unattached Socket() is not proof of a local OS transport.
// The root process must provide the very Server instance accepting requests.
// Server.address() MUST identify a filesystem AF_UNIX listener, not TCP,
// abstract socket, or a caller-supplied path/UID from HTTP.
function rootUnixListener(server){
 const addr=server?.address?.();
 return server instanceof Server && typeof addr==='string' &&
   addr.startsWith('/') && addr.length>1 && !addr.includes('\\0');
}
function nativeServerSocket(server,socket){
 return rootUnixListener(server) &&
   eligibleNativeLocalSocket(socket) && socket.server===server;
}
function contextStillNative(ctx,server){
 const req=ctx?.request;
 return req instanceof IncomingMessage &&
   req.socket===ctx.socket &&
   req.method===ctx.method && req.url===ctx.url &&
   req.destroyed!==true && nativeServerSocket(server,ctx.socket);
}
function bindRootHttp({basePost,rootCapabilities,assertNativePeer,rootServer}={}){
 rootOnly();
 if(typeof basePost!=='function'||typeof assertNativePeer!=='function'||
    !rootCapabilities||typeof rootCapabilities!=='object'||
    Array.isArray(rootCapabilities)||!rootUnixListener(rootServer))
  deny('fixed_root_dependencies_required');
 const context=new AsyncLocalStorage();
 const route=native.bind({
  basePost,rootCapabilities,
  assertAuthenticatedTransport:async()=>{
   const ctx=context.getStore();
   if(!contextStillNative(ctx,rootServer))return false;
   // The trusted OS verifier must return literal true, and neither the
   // request nor its socket may change during asynchronous verification.
   // The bridge itself does NOT implement SO_PEERCRED or install a listener.
   const verified=await assertNativePeer(ctx.socket);
   return verified===true && contextStillNative(ctx,rootServer);
  }
 });
 if(!route||typeof route.handle!=='function'||!Array.isArray(route.paths))
  deny('native_v3_router_not_bound');
 async function handleRequest(serverRequest,body){
  rootOnly();
  if(!(serverRequest instanceof IncomingMessage))
   deny('server_created_http_request_required');
  if(!route.paths.includes(serverRequest.url))
   return Object.freeze({handled:false});
  if(serverRequest.method!=='POST')deny('post_only');
  if(serverRequest.destroyed===true ||
     !nativeServerSocket(rootServer,serverRequest.socket))
   deny('native_local_socket_required');
  // The only context passed into the trust callback is a native socket
  // owned by the authenticated root server, not a JSON peer assertion.
  // Keep the original native socket and fixed route identity pinned
  // throughout async callbacks; re-reading mutable req.socket is unsafe.
  const ctx=Object.freeze({
   request:serverRequest,socket:serverRequest.socket,
   method:serverRequest.method,url:serverRequest.url
  });
  return context.run(ctx,()=>
   route.handle({method:ctx.method,url:ctx.url,body}));
 }
 return Object.freeze({handleRequest,paths:route.paths});
}
if(require.main===module){
 process.stderr.write('source-only native HTTP bridge; no standalone listener or install\n');
 process.exitCode=78;
}
module.exports=Object.freeze({bindRootHttp});
