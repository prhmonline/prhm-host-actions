'use strict';
/**
 * U01 — SOURCE-ONLY, read-only attestation of the CURRENT root trust preimage.
 * No shell execution, writes, policy mutation, signing, approval, or L4 action.
 *
 * A root process can report its own files, but cannot authorize an alteration
 * of its own trust anchors. Independent Provider review and signed L4 remain
 * separate gates even when this preflight reports exact matching bytes.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const digest = '08889c18a570cc2bff408dfbe78b7e5f4f8da24f465b4fdd445640cd7f89d17d';
const FIXED = Object.freeze({
  action: 'prhm_action_registry_install_v1',
  requiredIndependentProviderRegistration: true,
  currentBundle: digest,
  previousBundle: '47e248686971fd373fd32ebe50f593deae6e98e0196ae7e7021508ecabb3c181',
  backupSha256: 'c61de39ba53aa41d6b1619c2991a944d0dcace16ae720497625a7bd8af0de052',
  engineSha256: '42a24579e3d7916ff7cf599310779c415eb5a8410242999cc0a9e6ab83083a35',
  expectedBundleFileCount: 28,
  previousBundleDir: '/usr/local/libexec/deploy-control/universal/versions/47e248686971fd373fd32ebe50f593deae6e98e0196ae7e7021508ecabb3c181',
  installation: '/usr/local/libexec/deploy-control/universal/installation.json',
  pointer: '/usr/local/libexec/deploy-control/universal/current',
  backup: '/usr/local/libexec/deploy-control/universal/current/universal/backup.py',
  engine: '/usr/local/libexec/deploy-control/universal/current/universal/engine.py',
  providerAnchor: '/var/lib/prhm-agent-selfmaint-exec/root-of-trust/provider-bootstrap-ed25519-public.pem',
  nativeRegistrar: '/opt/prhm-agent-selfmaint-exec/actions/prhm-action-registry-install-native-v1.cjs',
  ownerPreimages: Object.freeze({
    agentApi: Object.freeze({
      path: '/opt/prhm-agent-selfmaint/server.js',
      sha256: '57828b344aca1d1fb51e74cc2c64094edb03c5fd86fe68420d7185f0d12b6530',
      mode: 0o644
    }),
    executor: Object.freeze({
      path: '/opt/prhm-agent-selfmaint-exec/server.js',
      sha256: '4c136a210681ee07a45d96d38d91c1253afcce67feed0a9d062f9f14d0557169',
      mode: 0o755
    }),
    mcp: Object.freeze({
      path: '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
      sha256: '0c6a74757696a0d85840a0aec1bc53c91431481024f2be56e4ecb02f789073ef',
      mode: 0o600
    }),
    policy: Object.freeze({
      path: '/opt/prhm-company-control-plane/config/approval-policy.json',
      sha256: '26359a31efdfe0acde07cc9f4001afddee98efaa206e4528880068bf93c425f5',
      mode: 0o644
    }),
    approvalService: Object.freeze({
      path: '/opt/prhm-company-control-plane/approval/server.js',
      sha256: 'de2569e481cd57b105b6a778cee7b32b2575fc88957d993c70760101ba39d13b',
      mode: 0o644
    }),
    mediator: Object.freeze({
      path: '/opt/prhm-company-control-plane/root-scripts-stage-mediator-v1/control-plane-root-scripts-stage-mediator-v1.js',
      sha256: '26ec21a51e3b0cb5e5aafd8a70531efb84243409557f2af186d16e90b673b3ee',
      mode: 0o640
    })
  })
});
const LEGACY = Object.freeze({
  base: FIXED.previousBundle,
  backupOnlyCandidate: '77c3615ef73faae847008665b683fe2cf63191faca215f46724097051b6b2c29'
});
function safeFile(file, maxBytes=2_000_000) {
  try {
    const s=fs.lstatSync(file);
    if(!s.isFile() || s.isSymbolicLink() || s.nlink!==1 || s.size<1 || s.size>maxBytes)
      return {present:true,safe:false};
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try {
      const f=fs.fstatSync(fd);
      if(f.ino!==s.ino || f.dev!==s.dev || f.size!==s.size) return {present:true,safe:false};
      const bytes=fs.readFileSync(fd);
      if(bytes.length!==s.size) return {present:true,safe:false};
      return {present:true,safe:true,sha256:sha(bytes),uid:s.uid,mode:s.mode&0o777,
        bytes};
    } finally { fs.closeSync(fd); }
  } catch {
    return {present:false,safe:false};
  }
}

/**
 * Exact, bounded read-only implementation of universal.install.bundle_digest.
 * Walk all package files (including ignored __pycache__ subtrees to reject
 * symlinks), reject non-Python source content and verify exact file closure.
 * This establishes byte integrity, NOT independent Git or signer provenance.
 */
function bundleSourceDigest(sourceRoot) {
  const base=path.join(sourceRoot,'universal');
  const sources=[];
  let visited=0;
  function walk(dir,parts) {
    const entries=fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for(const entry of entries) {
      visited++;
      if(visited>2000) throw Error('source_inventory_limit');
      const nextParts=[...parts,entry.name],full=path.join(dir,entry.name);
      const st=fs.lstatSync(full);
      if(st.isSymbolicLink()) throw Error('source_symlink_forbidden');
      if(st.isDirectory()) { walk(full,nextParts);continue; }
      if(!st.isFile()) throw Error('source_special_file_forbidden');
      if(nextParts.includes('__pycache__')) continue;
      if(!entry.name.endsWith('.py')||st.nlink!==1||st.size>2_000_000)
        throw Error('source_non_python_or_unsafe_file');
      sources.push({rel:'universal/'+nextParts.join('/'),file:full});
    }
  }
  walk(base,[]);
  sources.sort((a,b)=>a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
  if(!sources.some(x=>x.rel==='universal/cli.py'))
    throw Error('source_cli_missing');
  const hasher=crypto.createHash('sha256');
  for(const source of sources) {
    hasher.update(source.rel,'utf8').update(Buffer.from([0]));
    hasher.update(fs.readFileSync(source.file)).update(Buffer.from([0]));
  }
  return Object.freeze({digest:hasher.digest('hex'),fileCount:sources.length});
}

function snapshotLive() {
  const manifest=safeFile(FIXED.installation);
  let installed={};
  if(manifest.safe) {
    try {
      const parsed=JSON.parse(manifest.bytes.toString('utf8'));
      installed={digest:parsed.digest,previous:parsed.previous};
    } catch {}
  }
  let currentPointerValid=false;
  try {
    currentPointerValid=fs.lstatSync(FIXED.pointer).isSymbolicLink() &&
      path.resolve(path.dirname(FIXED.pointer),fs.readlinkSync(FIXED.pointer)) ===
      path.join(path.dirname(FIXED.pointer),'versions',FIXED.currentBundle);
  } catch {}
  const owners={};
  for(const [name,meta] of Object.entries(FIXED.ownerPreimages)) {
    const file=safeFile(meta.path);
    owners[name]={present:file.present,safe:file.safe,sha256:file.sha256,
      uid:file.uid,mode:file.mode,
      registrarMentioned:file.safe && file.bytes.includes(Buffer.from(FIXED.action))};
  }
  const anchor=safeFile(FIXED.providerAnchor,4096);
  const native=safeFile(FIXED.nativeRegistrar,500_000);
  const backup=safeFile(FIXED.backup);
  const engine=safeFile(FIXED.engine);
  let currentSource=null,previousSource=null;
  try { currentSource=bundleSourceDigest(FIXED.pointer); } catch {}
  try { previousSource=bundleSourceDigest(FIXED.previousBundleDir); } catch {}
  const policy=safeFile(FIXED.ownerPreimages.policy.path);
  let policyRegistration=false;
  if(policy.safe) {
    try {
      const v=JSON.parse(policy.bytes.toString('utf8'));
      policyRegistration=Object.hasOwn(v.operations||{},
        'host_action.'+FIXED.action) &&
        Array.isArray(v.typed_scopes) &&
        v.typed_scopes.some(x=>x&&x.action===FIXED.action&&
          (x.level===4||x.risk==='critical'));
    } catch {}
  }
  return {installed,manifestSafe:manifest.safe,currentPointerValid,
    backupSha256:backup.safe?backup.sha256:null,
    engineSha256:engine.safe?engine.sha256:null,
    currentSource,previousSource,owners,
    providerAnchorSafe:anchor.safe&&anchor.uid===0&&(anchor.mode&0o022)===0,
    nativeRegistrarSafe:native.safe&&native.uid===0&&(native.mode&0o022)===0&&
      native.bytes.includes(Buffer.from(FIXED.action)),
    policyRegistration};
}
function classify(s) {
  const gates={
    exactCurrentBundle:s.installed?.digest===FIXED.currentBundle &&
      s.installed?.previous===FIXED.previousBundle,
    safeInstallationManifest:s.manifestSafe===true,
    correctCurrentPointer:s.currentPointerValid===true,
    exactBackup:s.backupSha256===FIXED.backupSha256,
    exactEngine:s.engineSha256===FIXED.engineSha256,
    currentBundleBytesVerified:s.currentSource?.digest===FIXED.currentBundle &&
      s.currentSource?.fileCount===FIXED.expectedBundleFileCount,
    previousBundleBytesVerified:s.previousSource?.digest===FIXED.previousBundle &&
      s.previousSource?.fileCount===FIXED.expectedBundleFileCount
  };
  for(const [name,pin] of Object.entries(FIXED.ownerPreimages)) {
    const current=s.owners?.[name];
    gates['owner_'+name]=Boolean(current && current.present && current.safe &&
      current.sha256===pin.sha256 && current.uid===0 && current.mode===pin.mode);
  }
  gates.providerTrustAnchorPresent=s.providerAnchorSafe===true;
  gates.rootOwnedNativeRegistrarPresent=s.nativeRegistrarSafe===true;
  gates.apiRegistered=s.owners?.agentApi?.registrarMentioned===true;
  gates.executorRegistered=s.owners?.executor?.registrarMentioned===true;
  gates.mcpRegistered=s.owners?.mcp?.registrarMentioned===true;
  gates.level4PolicyRegistered=s.policyRegistration===true;
  const blockers=Object.keys(gates).filter(k=>!gates[k]);
  return Object.freeze({
    schema:'prhm.u01.current-root-trust-readiness.v1',
    liveReadOnly:true,
    installedBundle:s.installed?.digest||null,
    legacyBackupOnlyCandidateIsObsolete:s.installed?.digest!==LEGACY.base,
    gates,blockers,
    sourcePreimageExact:Object.keys(gates).filter(k=>k.startsWith('owner_'))
      .every(k=>gates[k]) && gates.exactCurrentBundle && gates.correctCurrentPointer &&
      gates.exactEngine && gates.currentBundleBytesVerified && gates.previousBundleBytesVerified,
    nativeRegistrationReadyForIndependentReview:blockers.length===0,
    rootOfTrustMutationAuthorized:false,
    signedProviderBootstrapAccepted:false,
    level4ApprovalIssued:false,
    approvalOrDispatchRequested:false,
    productionChanged:false
  });
}
module.exports=Object.freeze({FIXED,LEGACY,classify,snapshotLive,safeFile,bundleSourceDigest,
  ROOT_ACTION_REGISTERED_BY_THIS_MODULE:false,PRODUCTION_AUTHORIZED:false});
if(require.main===module) {
  if(process.argv.length!==2) {
    process.stderr.write('No arguments: read-only U01 preflight only.\n');
    process.exitCode=64;
  } else {
    const result=classify(snapshotLive());
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    process.exitCode=result.blockers.length===0?0:2;
  }
}
