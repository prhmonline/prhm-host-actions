'use strict';
/**
 * SOURCE-ONLY compositional seam for Agent 3 Native v3 trusted Executor.
 * Binds the real (candidate) Linux SO_PEERCRED addon reader to a dedicated
 * Unix listener route, without granting broker access to any legacy socket.
 *
 * Does not load native binaries, listen, spawn a broker, mutate Production,
 * submit/consume a Level-4 approval or install an action. Source-only
 * composition cannot attest the required signed manifest, Root dispatcher,
 * native binary SHA, rollback, or systemd deployment.
 */
const kernel=require('./native-v3-kernel-peer-reader.cjs');
const boundary=require('./native-v3-dedicated-unix-boundary.cjs');
function deny(id){throw Error('agent3_native_v3_composition_denied:'+id);}
function bindSourceOnlyNativeV3({
 rootServer,nativeAddon,basePost,rootCapabilities,
 expectedUid,expectedGid
}={}){
 if(typeof process.getuid!=='function'||process.getuid()!==0)
  deny('root_executor_only');
 if(!rootServer||rootServer.address?.()!==boundary.DEDICATED_SOCKET)
  deny('only_dedicated_native_v3_unix_listener');
 if(!Number.isSafeInteger(expectedUid)||expectedUid<1||
    !Number.isSafeInteger(expectedGid)||expectedGid<1)
  deny('fixed_nonroot_identity_required');
 const credentialReader=kernel.bindKernelPeerReader({rootServer,nativeAddon});
 if(!credentialReader||credentialReader.release_ready!==false||
    typeof credentialReader.readKernelPeerCredentials!=='function')
  deny('unattested_kernel_reader');
 const routes=boundary.bindDedicatedUnixBoundary({
  rootServer,basePost,rootCapabilities,expectedUid,expectedGid,
  readKernelPeerCredentials:credentialReader.readKernelPeerCredentials
 });
 if(routes.release_ready!==false||
    routes.legacy_socket_access_granted!==false)
  deny('unattested_or_legacy_route');
 return Object.freeze({
  handleRequest:routes.handleRequest,
  paths:routes.paths,
  dedicated_socket:boundary.DEDICATED_SOCKET,
  kernel_reader_production_attested:false,
  root_dispatcher_installed:false,
  level4_signed_and_consumed:false,
  production_mutation:false,
  release_ready:false
 });
}
if(require.main===module){
 process.stderr.write('source-only kernel Native v3 composition; no listener, installer or approval\n');
 process.exitCode=78;
}
module.exports=Object.freeze({bindSourceOnlyNativeV3});
