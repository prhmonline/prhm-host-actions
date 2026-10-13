'use strict';
/**
 * PRHM Host Actions v2 shared registration gateway (SOURCE ONLY).
 *
 * This is an ordinary library, NOT an installed MCP action or an alternative
 * bootstrap. The existing signed Approval Center / Host Actions executor is
 * the only permitted caller. There is NO CLI apply mode, generic shell, SQL,
 * file-write API, credential endpoint, or request replay functionality.
 *
 * Contract for one future permanently registered "catalog" route:
 * 1. Git-reviewed manifest/immutable source + four exact current owner SHAs.
 * 2. Independently consumed, expiring, Ed25519 Level-4 approval whose typed
 *    argument hash binds action, project, sourceCommit and manifestSha256.
 * 3. Invoke the project's existing vetted atomic installer, not a parallel
 *    installer. Verify registry health and action discovery after installation.
 * 4. Installer rollback on failure; fail closed on unverified rollback.
 */
const crypto = require('node:crypto');
const ACTION = 'prhm_action_registry_install_v1';
const OPERATION = 'host_action.' + ACTION;
const OWNER_PATHS = Object.freeze({
  base: '/opt/prhm-agent-selfmaint/server.js',
  executor: '/opt/prhm-agent-selfmaint-exec/server.js',
  policy: '/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp: '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
});
const ASSET_ROOT = '/opt/prhm-agent-selfmaint-exec/actions/';
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const NAME = /^[a-z][a-z0-9_]{5,100}$/;
const PROJECT = /^[a-z][a-z0-9_-]{1,63}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function stop(reason) { throw new Error('registry_gateway_' + reason); }
function exactly(ok, reason) { if (!ok) stop(reason); }
function exactKeys(value, keys, reason) {
  exactly(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === keys.slice().sort().join('|'), reason);
}
function canonicalArgs(a) {
  exactKeys(a, ['action','project','source_commit','manifest_sha256'], 'args_schema');
  exactly(a.action === ACTION && PROJECT.test(a.project) &&
    COMMIT.test(a.source_commit) && SHA256.test(a.manifest_sha256), 'args_invalid');
  // Explicit insertion order matches the future typed Approval Center request.
  return JSON.stringify({
    action: ACTION, project: a.project, source_commit: a.source_commit,
    manifest_sha256: a.manifest_sha256,
  });
}
function approvalBindingSha(args) { return sha(Buffer.from(canonicalArgs(args))); }
function assertManifest(manifest) {
  exactKeys(manifest, ['schema_version','project','action','source_commit','risk',
    'approval_level','registry_owners','assets','rollback_required','health','git_path'], 'manifest_schema');
  exactly(manifest.schema_version === 'prhm.action-registry.release.v1' &&
    PROJECT.test(manifest.project) && NAME.test(manifest.action) &&
    manifest.action !== ACTION && COMMIT.test(manifest.source_commit) &&
    manifest.risk === 'critical' && manifest.approval_level === 4 &&
    typeof manifest.git_path === 'string' &&
    /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.json$/.test(manifest.git_path) &&
    !manifest.git_path.includes('..') &&
    manifest.rollback_required === true, 'manifest_security_contract');
  exactKeys(manifest.registry_owners, Object.keys(OWNER_PATHS), 'owner_set');
  const old = new Set(), next = new Set();
  for (const [key, target] of Object.entries(OWNER_PATHS)) {
    const rec = manifest.registry_owners[key];
    exactKeys(rec, ['path','before_sha256','after_sha256'], 'owner_schema');
    exactly(rec.path === target && SHA256.test(rec.before_sha256) &&
      SHA256.test(rec.after_sha256) && rec.before_sha256 !== rec.after_sha256,
      'owner_pin_or_path');
    old.add(rec.before_sha256); next.add(rec.after_sha256);
  }
  exactly(old.size === 4 && next.size === 4, 'owner_duplicate_digest');
  exactly(Array.isArray(manifest.assets) && manifest.assets.length > 0 &&
    manifest.assets.length <= 32, 'asset_count');
  const destinations = new Set();
  for (const entry of manifest.assets) {
    exactKeys(entry, ['path','sha256'], 'asset_schema');
    exactly(typeof entry.path === 'string' &&
      /^\/opt\/prhm-agent-selfmaint-exec\/actions\/[a-z0-9][a-z0-9_.-]{2,120}$/.test(entry.path) &&
      entry.path.startsWith(ASSET_ROOT) && !entry.path.includes('..') &&
      SHA256.test(entry.sha256) && !destinations.has(entry.path),
      'asset_untrusted_path_or_duplicate');
    destinations.add(entry.path);
  }
  exactKeys(manifest.health, ['services','tool'], 'health_schema');
  exactly(Array.isArray(manifest.health.services) &&
    manifest.health.services.length === 4 &&
    manifest.health.services.slice().sort().join('|') === [
      'prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service',
      'prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service'
    ].sort().join('|') && manifest.health.tool === manifest.action,
    'health_or_registry_discovery_missing');
  return Object.freeze({
    project:manifest.project, action:manifest.action,
    source_commit:manifest.source_commit,git_path:manifest.git_path,
    owners:Object.freeze({...manifest.registry_owners}),
    assets:Object.freeze(manifest.assets.map(x=>Object.freeze({...x}))),
    health:Object.freeze({tool:manifest.health.tool,
      services:Object.freeze(manifest.health.services.slice())})
  });
}
function attestRelease({manifestBytes, expectedManifestSha, sourceCommit, readOwner, readAsset, readGitBlob}) {
  exactly(Buffer.isBuffer(manifestBytes) && manifestBytes.length > 100 &&
    manifestBytes.length < 160000 && SHA256.test(expectedManifestSha) &&
    sha(manifestBytes) === expectedManifestSha, 'manifest_sha_mismatch');
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); }
  catch { stop('manifest_json_invalid'); }
  const normalized=assertManifest(manifest);
  exactly(normalized.source_commit === sourceCommit && COMMIT.test(sourceCommit),
    'source_commit_mismatch');
  exactly(typeof readOwner === 'function' && typeof readAsset === 'function' &&
    typeof readGitBlob === 'function', 'trusted_readers_missing');
  // Read the immutable Git object from the approved repository at the pinned
  // source commit, not HEAD or an untrusted filesystem copy.
  const gitBytes=readGitBlob(sourceCommit,manifest.git_path);
  exactly(Buffer.isBuffer(gitBytes) && gitBytes.equals(manifestBytes),
    'pinned_git_manifest_blob_mismatch');
  for (const [key, owner] of Object.entries(OWNER_PATHS)) {
    const bytes=readOwner(owner);
    exactly(Buffer.isBuffer(bytes) && sha(bytes) === manifest.registry_owners[key].before_sha256,
      'owner_sha_drift_' + key);
  }
  for (const file of manifest.assets) {
    const bytes=readAsset(file.path);
    exactly(Buffer.isBuffer(bytes) && sha(bytes) === file.sha256,
      'asset_sha_drift');
  }
  return Object.freeze({manifest_sha256:expectedManifestSha,
    source_commit:sourceCommit, normalized});
}
/**
 * Verify the *actual* Ed25519 JWS and the persisted once-only Approval Center
 * ledger. A boolean 'approved' or a caller-provided receipt is never enough.
 */
const fs=require('node:fs'),path=require('node:path');
const APPROVAL_PUBLIC_KEY='/var/lib/prhm-company-approval/ed25519-public.pem';
const APPROVAL_CONSUMED_DIR='/var/lib/prhm-company-approval/consumed';
const POLICY_VERSION='2026-10-13.3-prhm-shared-action-registry-v1';
function decodeJws(token,publicKey){
  exactly(typeof token==='string'&&token.length>=120&&token.length<=16384,'signed_token_missing');
  const parts=token.split('.');
  exactly(parts.length===3&&parts.every(x=>/^[A-Za-z0-9_-]+$/.test(x)),'signed_token_format');
  let hdr,claims,signature;
  try{
    hdr=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
    signature=Buffer.from(parts[2],'base64url');
  }catch{stop('signed_token_json');}
  const key=crypto.createPublicKey(publicKey);
  const kid=sha(key.export({type:'spki',format:'der'})).slice(0,16);
  exactly(hdr&&hdr.alg==='EdDSA'&&hdr.typ==='PRHM-COMPANY-APPROVAL'&&
    hdr.kid===kid&&key.asymmetricKeyType==='ed25519'&&signature.length===64&&
    crypto.verify(null,Buffer.from(parts[0]+'.'+parts[1]),key,signature),'signed_token_invalid_signature');
  exactly(claims&&typeof claims==='object'&&!Array.isArray(claims),'signed_claims_invalid');
  return claims;
}
function verifyConsumedRegistrationApproval({token,publicKey,ledger,args,nowSec}){
  exactly(Number.isSafeInteger(nowSec)&&nowSec>0,'trusted_clock_invalid');
  const c=decodeJws(token,publicKey),digest=approvalBindingSha(args);
  exactly(UUID.test(c.approval_id||'')&&UUID.test(c.request_id||'')&&
    c.jti===c.approval_id&&c.iss==='prhm-company-approval'&&
    c.action===ACTION&&c.operation===OPERATION&&c.project==='control_plane'&&
    c.environment==='production'&&c.tool==='host_action_v2_apply'&&
    c.principal_id==='mohammad'&&c.role==='mcp-operator'&&
    c.level===4&&c.risk==='critical'&&c.decision==='accept'&&c.one_time_use===true&&
    c.policy_version===POLICY_VERSION&&SHA256.test(c.policy_hash||'')&&
    c.arguments_sha256===digest&&c.request_hash===digest&&
    Number.isSafeInteger(c.nbf)&&Number.isSafeInteger(c.iat)&&Number.isSafeInteger(c.exp)&&
    c.nbf<=nowSec&&c.iat<=nowSec&&c.exp>nowSec&&c.exp>c.iat,
    'signed_l4_binding_expiry_or_policy_mismatch');
  exactKeys(ledger,['schema_version','approval_id','request_id','work_order_id','project_id',
    'operation','request_hash','consumed_at','consumer','consumption_hash'],
    'consumption_ledger_schema');
  exactly(ledger.schema_version==='prhm.approval-consumption.v1'&&
    ledger.approval_id===c.approval_id&&ledger.request_id===c.request_id&&
    ledger.operation===OPERATION&&ledger.request_hash===digest&&
    ledger.consumer==='prhm-agent-selfmaint-exec-host-actions-v2'&&
    typeof ledger.consumed_at==='string'&&
    Number.isFinite(Date.parse(ledger.consumed_at))&&
    Date.parse(ledger.consumed_at)/1000<=nowSec&&
    SHA256.test(ledger.consumption_hash||'')&&
    sha(Buffer.from(JSON.stringify({...ledger,consumption_hash:null})))===ledger.consumption_hash,
    'consumption_ledger_invalid_or_replayed');
  return Object.freeze({action:ACTION,operation:OPERATION,level:4,
    risk:'critical',request_id:c.request_id,manifest_sha256:args.manifest_sha256,
    source_commit:args.source_commit,arguments_sha256:digest});
}
function trustedRead(file, maxBytes){
  const st=fs.lstatSync(file);
  exactly(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=maxBytes&&
    (st.mode&0o022)===0,'approval_file_not_trusted');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const ss=fs.fstatSync(fd);
    exactly(ss.ino===st.ino&&ss.dev===st.dev&&ss.size===st.size&&ss.uid===st.uid,
      'approval_file_race');
    return fs.readFileSync(fd);
  }finally{fs.closeSync(fd);}
}
function verifyLiveConsumedRegistrationApproval({token,args}){
  exactly(process.getuid?.()===0,'trusted_root_required');
  const dir=fs.lstatSync(APPROVAL_CONSUMED_DIR);
  exactly(dir.isDirectory()&&!dir.isSymbolicLink()&&
    fs.realpathSync(APPROVAL_CONSUMED_DIR)===APPROVAL_CONSUMED_DIR&&
    (dir.mode&0o022)===0,'approval_consumption_dir_unsafe');
  const publicKey=trustedRead(APPROVAL_PUBLIC_KEY,8192);
  const claims=decodeJws(token,publicKey);
  exactly(UUID.test(claims.approval_id||''),'approval_identifier_invalid');
  const data=trustedRead(path.join(APPROVAL_CONSUMED_DIR,claims.approval_id+'.json'),16384);
  let ledger;
  try{ledger=JSON.parse(data.toString('utf8'));}catch{stop('consumption_ledger_json');}
  return verifyConsumedRegistrationApproval({token,publicKey,ledger,args,
    nowSec:Math.floor(Date.now()/1000)});
}
/**
 * Use explicit phases. Requiring the new target tool during PREINSTALL would
 * create the exact circular bootstrap dependency this gateway solves.
 */
function readiness({phase='preinstall',release,approval,registrarInstalled,
                    approvalRouteInstalled,rollbackReady,servicesHealthy,
                    registeredToolVisible}) {
  exactly(['preinstall','authorized','active'].includes(phase),'invalid_readiness_phase');
  const gaps=[];
  if (!release) gaps.push('GIT_RELEASE_NOT_ATTESTED');
  if (registrarInstalled !== true) gaps.push('TRUSTED_REGISTRAR_NOT_INSTALLED');
  if (approvalRouteInstalled !== true) gaps.push('APPROVAL_ROUTE_NOT_REGISTERED');
  if (rollbackReady !== true) gaps.push('ROLLBACK_NOT_VERIFIED');
  if (servicesHealthy !== true) gaps.push('SERVICE_HEALTH_UNVERIFIED');
  if (phase!=='preinstall'&&!approval) gaps.push('SIGNED_L4_RECEIPT_NOT_CONSUMED');
  if (phase==='active'&&registeredToolVisible !== true)
    gaps.push('TARGET_TOOL_NOT_REGISTERED');
  return Object.freeze({phase,ready:gaps.length===0,gaps:Object.freeze(gaps)});
}
async function executeAfterTrustedAuthorization({release, signedApprovalToken, args, trustedInstaller,
    readInstalledTool, audit}) {
  // This method MUST be called only by the previously installed root-owned
  // trusted executor after independent signature verification and consumption.
  exactly(release && release.normalized && release.manifest_sha256 === args?.manifest_sha256 &&
    release.normalized.project === args?.project && release.source_commit === args?.source_commit,
    'unbound_release');
  const approval=verifyLiveConsumedRegistrationApproval({token:signedApprovalToken,args});
  exactly(typeof trustedInstaller === 'function' &&
    typeof readInstalledTool === 'function' && typeof audit === 'function',
    'trusted_executor_capabilities_missing');
  // Existing SHA-bound atomic installer owns backups, restart and rollback.
  const result = await trustedInstaller({release,approval});
  exactly(result && result.ok === true && result.rollback === 'not_needed' &&
    result.installedAssets === release.normalized.assets.length &&
    result.updatedOwners === 4, 'installer_postcondition_missing');
  exactly(await readInstalledTool(release.normalized.action) === true,
    'registry_discovery_missing');
  await audit(Object.freeze({
    request_id:approval.request_id, action:release.normalized.action,
    project:release.normalized.project, source_commit:release.source_commit,
    manifest_sha256:release.manifest_sha256, result:'registered'
  }));
  return Object.freeze({ok:true,project:release.normalized.project,
    action:release.normalized.action,source_commit:release.source_commit,
    rollback:'not_needed',registry_visible:true});
}
module.exports=Object.freeze({ACTION,OPERATION,OWNER_PATHS,ASSET_ROOT,
  sha,canonicalArgs,approvalBindingSha,assertManifest,attestRelease,
  POLICY_VERSION,decodeJws,verifyConsumedRegistrationApproval,verifyLiveConsumedRegistrationApproval,
  readiness,executeAfterTrustedAuthorization});
