'use strict';
/**
 * Agent 3 Native v3 isolated Unix listener boundary — SOURCE ONLY.
 *
 * Reviewed root code must create and bind a SECOND dedicated AF_UNIX
 * HTTP server at the exact fixed pathname, separate from the existing
 * /run/prhm-agent-selfmaint-exec/exec.sock that exposes legacy routes.
 *
 * This module does NOT create/listen on a socket, install software,
 * change systemd users/groups/ACLs, read an approval key, or consume
 * any authorization. It cannot produce an approvable production action.
 *
 * The trusted Root owner MUST supply a native kernel SO_PEERCRED reader
 * that takes the accepted server-owned net.Socket and returns exactly
 * {pid,uid,gid} from the live connected AF_UNIX FD. A JS object, HTTP
 * body/header, process.env, IPC peer claim or custom boolean is NOT
 * an acceptable implementation. No production-native reader is wired.
 *
 * IMPORTANT: grants to this second socket must not grant the broker
 * access to the shared legacy Executor socket. The existing root-owned
 * Level-4 signed proof, consumed ledger and root rollback remain required.
 */
const {Server}=require('node:http');
const bridge=require('./native-v3-root-http-bridge.cjs');

const DEDICATED_SOCKET='/run/prhm-agent3-native-registry/registry.sock';
const LEGACY_SOCKET='/run/prhm-agent-selfmaint-exec/exec.sock';

function deny(code){throw Error('agent3_dedicated_unix_boundary_denied:'+code);}
function requireRoot(){
 if(typeof process.getuid!=='function'||process.getuid()!==0)
  deny('trusted_root_owner_required');
}
function exactNativeCredentialShape(value){
 if(value===null||typeof value!=='object'||Array.isArray(value))
  return false;
 const descriptors=Object.getOwnPropertyDescriptors(value);
 const ownKeys=Reflect.ownKeys(value).sort();
 if(ownKeys.length!==3||ownKeys.join('|')!=='gid|pid|uid')
  return false;
 return ['gid','pid','uid'].every(k=>
   descriptors[k] && Object.hasOwn(descriptors[k],'value') &&
   Number.isSafeInteger(descriptors[k].value) &&
   descriptors[k].value>=0);
}
function fixedRootServer(server){
 return server instanceof Server && server.listening===true &&
   server.address()===DEDICATED_SOCKET;
}
function bindDedicatedUnixBoundary({
 rootServer,basePost,rootCapabilities,
 readKernelPeerCredentials,expectedUid,expectedGid
}={}){
 requireRoot();
 if(!fixedRootServer(rootServer))
  deny('dedicated_root_unix_listener_required');
 if(typeof basePost!=='function'||
    !rootCapabilities||typeof rootCapabilities!=='object'||
    Array.isArray(rootCapabilities))
  deny('fixed_root_capabilities_required');
 if(typeof readKernelPeerCredentials!=='function')
  deny('kernel_peer_reader_required');
 if(!Number.isSafeInteger(expectedUid)||expectedUid<=0||
    !Number.isSafeInteger(expectedGid)||expectedGid<=0)
  deny('fixed_nonroot_broker_identity_required');
 // Read and capture exact identifiers ONCE during trusted boot.
 const pinnedUid=expectedUid;
 const pinnedGid=expectedGid;
 async function assertKernelPeer(socket){
  if(!fixedRootServer(rootServer))return false;
  try{
   // The injected callback is trusted owner code using a kernel getter;
   // it may not retrieve a UID from headers/body/environment.
   const creds=await readKernelPeerCredentials(socket);
   return fixedRootServer(rootServer) &&
     exactNativeCredentialShape(creds) &&
     creds.pid>0&&creds.uid===pinnedUid&&creds.gid===pinnedGid;
  }catch{
   return false;
  }
 }
 const bound=bridge.bindRootHttp({
  rootServer,basePost,rootCapabilities,
  assertNativePeer:assertKernelPeer
 });
 if(!bound||typeof bound.handleRequest!=='function'||
    !Array.isArray(bound.paths)||
    bound.paths.slice().sort().join('|')!==
    ['/v3/agent3-registry/execute','/v3/agent3-registry/request'].join('|'))
  deny('native_v3_only_dispatch_required');
 return Object.freeze({
  handleRequest:bound.handleRequest,
  paths:bound.paths,
  dedicated_socket:DEDICATED_SOCKET,
  legacy_socket_access_granted:false,
  peer_reader_production_attested:false,
  release_ready:false
 });
}
if(require.main===module){
 process.stderr.write(
  'source-only dedicated Native v3 Unix boundary; no listener, service or install\n'
 );
 process.exitCode=78;
}
module.exports=Object.freeze({
 DEDICATED_SOCKET,LEGACY_SOCKET,exactNativeCredentialShape,
 bindDedicatedUnixBoundary
});
