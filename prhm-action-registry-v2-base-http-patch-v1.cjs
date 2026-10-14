'use strict';
/**
 * SOURCE-ONLY, SHA-bound deterministic patch for the already running base
 * Host Actions server. Returns a candidate Buffer, NEVER opens or writes a
 * live file. Authorized root transport must back up, stage, node --check,
 * diff, atomically replace from an independent signed L4 bootstrap, restart
 * and verify under its own durable journal.
 *
 * Requires a separate attested root capabilities factory before installation.
 * There is deliberately NO fallback to action-only /v2/host-actions routes.
 */
const crypto=require('node:crypto');
const PINNED_BEFORE='4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406';
const BASE_PATH='/opt/prhm-agent-selfmaint/server.js';
const ROUTE_ANCHOR="    if (req.method === 'POST' && req.url === '/v2/host-actions/request') {";
const MARKER='PRHM_REGISTRY_V2_FIXED_FIVE_FIELD_HTTP';
const ROOT='/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2/';
const ADAPTER=ROOT+'prhm-action-registry-v2-approval-http-adapter-v1.cjs';
const TRUSTED=ROOT+'prhm-action-registry-v2-trusted-base-capabilities-v1.cjs';
const SHA=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(code){throw Error('registry_v2_base_patch_'+code)}
function check(v,code){if(!v)fail(code)}
function compiledRoutes(){
 // These fixed routes use the existing, audited in-process readBody/send.
 // The trusted capabilities are not exported from the HTTP handler, and
 // secrets never appear in the HTTP response or error.
 return [
  '    // '+MARKER,
  "    if (req.method === 'POST' && (",
  "      req.url === '/v2/registry/honartik/request' ||",
  "      req.url === '/v2/registry/honartik/confirm' ||",
  "      req.url === '/v2/registry/honartik/execute')) {",
  "      const registryAdapter = require('"+ADAPTER+"');",
  "      const trustedRegistryHost = require('"+TRUSTED+"');",
  "      const capabilities = trustedRegistryHost.createRootCapabilities({",
  "        approvalHttp,approvalBridge,readEnvFile,approvalClientEnv:APPROVAL_CLIENT_ENV",
  "      });",
  "      const out = await registryAdapter.createHandlers(capabilities)",
  "        .dispatch(req.method,req.url,await readBody(req));",
  "      return send(res,out.status === 'pending' ? 201 : 200,out);",
  '    }',
  ''
 ].join('\n');
}
function prepare(live){
 check(Buffer.isBuffer(live)&&live.length>=1000&&live.length<=2000000,
  'expected_real_owner_bytes');
 check(SHA(live)===PINNED_BEFORE,'current_base_sha_drift');
 // HARD STOP: mounting new HTTP routes changes this protected owner before
 // the signed project-registry installer can attest its original preimage.
 // Such a patch would make the five-field route self-blocking (circular
 // bootstrap). Use the separately rooted Unix socket sidecar instead.
 fail('protected_owner_preimage_circularity_use_isolated_socket');
 const src=live.toString('utf8');
 check(Buffer.from(src,'utf8').equals(live),'base_encoding_drift');
 check(!src.includes(MARKER)&&!src.includes("'/v2/registry/honartik/"),
  'registration_route_already_present');
 check(src.split(ROUTE_ANCHOR).length===2,'base_route_anchor_not_unique');
 check(src.includes('const HOST_ACTIONS_V2_BASE_MARKER = true;')&&
  src.includes('const HOST_ACTION_V2_SPECS = Object.freeze({')&&
  src.includes("'/v2/host-actions/authorize-consume'"),
  'unexpected_host_actions_v2_base_shape');
 const candidate=Buffer.from(src.replace(ROUTE_ANCHOR,compiledRoutes()+ROUTE_ANCHOR));
 const next=SHA(candidate);
 check(next!==PINNED_BEFORE,'no_change');
 return Object.freeze({
  preimage_sha256:PINNED_BEFORE,candidate_sha256:next,
  path:BASE_PATH,candidate,mutation:false,
  staged:false,approved:false,root_capability_factory:TRUSTED,
  request_route:'/v2/registry/honartik/request',
  confirm_route:'/v2/registry/honartik/confirm',
  execute_route:'/v2/registry/honartik/execute'
 });
}
module.exports=Object.freeze({PINNED_BEFORE,BASE_PATH,ROUTE_ANCHOR,
 MARKER,ADAPTER,TRUSTED,compiledRoutes,prepare});
