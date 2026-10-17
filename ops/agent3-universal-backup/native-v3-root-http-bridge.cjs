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
const {IncomingMessage}=require('node:http');
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
function bindRootHttp({basePost,rootCapabilities,assertNativePeer}={}){
 rootOnly();
 if(typeof basePost!=='function'||typeof assertNativePeer!=='function'||
    !rootCapabilities||typeof rootCapabilities!=='object'||
    Array.isArray(rootCapabilities))
  deny('fixed_root_dependencies_required');
 const context=new AsyncLocalStorage();
 const route=native.bind({
  basePost,rootCapabilities,
  assertAuthenticatedTransport:()=>{
   const req=context.getStore();
   if(!(req instanceof IncomingMessage)||req.destroyed===true||
      !eligibleNativeLocalSocket(req.socket))return false;
   // assertNativePeer MUST be an already-reviewed native socket credential
   // verifier; boolean flags from headers/body/request are NOT accepted.
   return assertNativePeer(req.socket);
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
     !eligibleNativeLocalSocket(serverRequest.socket))
   deny('native_local_socket_required');
  // The only context passed into the trust callback is a native socket
  // owned by the authenticated root server, not a JSON peer assertion.
  return context.run(serverRequest,()=>
   route.handle({method:serverRequest.method,url:serverRequest.url,body}));
 }
 return Object.freeze({handleRequest,paths:route.paths});
}
if(require.main===module){
 process.stderr.write('source-only native HTTP bridge; no standalone listener or install\n');
 process.exitCode=78;
}
module.exports=Object.freeze({bindRootHttp});
