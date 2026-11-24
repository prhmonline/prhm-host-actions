'use strict';
/**
 * SOURCE ONLY — reviewed integration candidate for prhm-action-registry-gateway-v1.cjs.
 * There is no CLI apply path, no generic command/path/URL/SQL input and no
 * authority in this file to approve or consume a Level-4 receipt.
 *
 * The existing trusted registrar must perform Ed25519 verification, consume
 * the single-use receipt, attest owner/asset SHA and pass verified release.
 * This module provides deterministic bounded patches and transactional
 * callbacks. Its IO adapter must be owned by the existing trusted executor.
 */
const crypto=require('node:crypto');
const ACTION='moeinshow_ticket_qr_offline_qa_v1';
const OPERATION='host_action.'+ACTION;
const SOURCE_SHA='7e670bc6f11267d8b955f1b3671787adecc65c93';
const ASSET_ROOT='/opt/prhm-agent-selfmaint-exec/actions/';
const ASSETS=Object.freeze({
  helper:ASSET_ROOT+'moeinshow-ticket-qr-qa-v1.js',
  bundle:ASSET_ROOT+'moeinshow-ticket-qr-fixed-bundle-v1.cjs'
});
const FIXTURE_ROOT=ASSET_ROOT+'qa/moeinshow-ticket-qr-qa-v1/';
const OWNER_PATHS=Object.freeze({
  base:'/opt/prhm-agent-selfmaint/server.js',
  executor:'/opt/prhm-agent-selfmaint-exec/server.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'
});
const SHA256=/^[a-f0-9]{64}$/;
const sha=buf=>crypto.createHash('sha256').update(buf).digest('hex');
const gitBlob=buf=>crypto.createHash('sha1').update('blob '+buf.length+'\0').update(buf).digest('hex');
const fail=code=>{throw new Error('moeinshow_registry_'+code)};
const exact=(ok,code)=>{if(!ok)fail(code)};
function replaceOne(source,pattern,build,label){
  const hits=[...source.matchAll(new RegExp(pattern.source,pattern.flags.includes('g')?pattern.flags:pattern.flags+'g'))];
  exact(hits.length===1,'anchor_'+label+'_'+hits.length);
  return source.replace(pattern,typeof build==='function'?build:build);
}
function guardNoAction(source,label){
  exact(!source.includes(ACTION) && !source.includes(OPERATION),'already_registered_'+label);
}
function candidateBase(source) {
  guardNoAction(source,'base');
  const next=replaceOne(source,
    /(\bmcp_candidate_schema_compare_v1\s*:\s*\{\s*operation\s*:\s*['"]host_action\.mcp_candidate_schema_compare_v1['"][^\n]*\},)/,
    m=>m+'\n  '+ACTION+": { operation: '"+OPERATION+"', rollback: 'host-action-v2:moeinshow-ticket-qr-qa-v1:rollback-verified' },",
    'base_spec');
  // Host Actions v2 has a separate Level-3 classification set. The action
  // MUST be registered here as well as in Approval Center policy; otherwise
  // a high-risk QA request may be misclassified as critical/Level-4.
  return replaceOne(next,
    /const HOST_ACTION_V2_LEVEL3\s*=\s*new Set\((\[[^;]*?\])\);/,
    (full,listJson)=>{
      let names;
      try{names=JSON.parse(listJson)}catch{fail('level3_set_json')}
      exact(Array.isArray(names) && names.every(x=>typeof x==='string') &&
        !names.includes(ACTION),'level3_set_invalid');
      return 'const HOST_ACTION_V2_LEVEL3 = new Set('+JSON.stringify([...names,ACTION])+');';
    },'base_level3_set');
}
function candidateExecutor(source){
  guardNoAction(source,'executor');
  let out=replaceOne(source,
    /(\bmcp_candidate_schema_compare_v1\s*:\s*\{\s*operation\s*:\s*['"]host_action\.mcp_candidate_schema_compare_v1['"][^\n]*\},)/,
    m=>m+'\n  '+ACTION+": { operation: '"+OPERATION+"', kind: '"+ACTION+"' },",
    'executor_spec');
  out=replaceOne(out,/async function applyHostActionV2\(action\)\s*\{/,
    m=>m+"\n  if (action === '"+ACTION+"') return require('/opt/prhm-agent-selfmaint-exec/actions/moeinshow-ticket-qr-qa-v1.js').runFixed();",
    'executor_dispatch');
  return out;
}
function candidateMcp(source){
  guardNoAction(source,'mcp');
  return replaceOne(source,
    /const HostActionV2\s*=\s*z\.enum\(\[([\s\S]*?)\]\);/,
    (full,values)=>"const HostActionV2=z.enum(["+values.replace(/\s*$/,'')+(values.trim().endsWith(',')?'':',')+"'"+ACTION+"']);",
    'mcp_enum');
}
function candidatePolicy(source){
  guardNoAction(source,'policy');
  let p;
  try{p=JSON.parse(source)}catch{fail('policy_json')}
  exact(p.schema_version==='prhm.approval-policy.v1','policy_schema');
  exact(p.operations && typeof p.operations==='object' && !Array.isArray(p.operations),'policy_operations');
  exact(Array.isArray(p.typed_scopes),'policy_scopes');
  exact(typeof p.version==='string' && p.version.length>1,'policy_version');
  exact(!Object.hasOwn(p.operations,OPERATION),'operation_exists');
  p.operations[OPERATION]={
    level:3,risk:'high',requires_second_confirmation:true,one_time_use:true,
    requested_approver:'mohammad',expires_seconds:180,policy_version:p.version,
    rollback_reference:'host-action-v2:moeinshow-ticket-qr-qa-v1:rollback-verified'
  };
  p.typed_scopes.push({
    tool:'host_action_v2_apply_level3',project:'control_plane',environment:'production',
    action:ACTION,risk:'high',operation:OPERATION,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
  });
  return JSON.stringify(p,null,2)+'\n';
}
function ensureExactOwners(object){
  exact(object && typeof object==='object'&&!Array.isArray(object),'owner_map');
  exact(Object.keys(object).sort().join('|')===Object.keys(OWNER_PATHS).sort().join('|'),'owner_names');
}
function ensureRelease(release){
  exact(release && release.normalized && release.normalized.action===ACTION &&
    release.normalized.project==='moeinshow' &&
    release.source_commit===release.normalized.source_commit &&
    /^[a-f0-9]{40}$/.test(release.source_commit) &&
    /^[a-f0-9]{40}$/.test(release.manifest_commit) &&
    SHA256.test(release.manifest_sha256),'release_identity');
  ensureExactOwners(release.normalized.owners);
  for(const [key,path] of Object.entries(OWNER_PATHS)){
    const o=release.normalized.owners[key];
    exact(o.path===path&&SHA256.test(o.before_sha256)&&SHA256.test(o.after_sha256)&&
      o.before_sha256!==o.after_sha256,'release_owner_'+key);
  }
  const assets=release.normalized.assets;
  exact(Array.isArray(assets)&&assets.length===2,'release_asset_count');
  exact(assets.map(x=>x.path).sort().join('|')===Object.values(ASSETS).sort().join('|'),'release_asset_paths');
  for(const x of assets)exact(SHA256.test(x.sha256)&&typeof x.source_path==='string','release_asset_sha');
}
function candidateOwners(original){
  ensureExactOwners(original);
  const next={
    base:candidateBase(original.base),
    executor:candidateExecutor(original.executor),
    policy:candidatePolicy(original.policy),
    mcp:candidateMcp(original.mcp)
  };
  return next;
}
function verifyFixture(bundle){
  exact(bundle && bundle.schema==='prhm.moeinshow-qa-fixed-bundle.v1' &&
    bundle.action===ACTION && bundle.source_commit===SOURCE_SHA,'bundle_identity');
  exact(bundle.entries&&typeof bundle.entries==='object'&&!Array.isArray(bundle.entries),'bundle_entries');
  const keys=Object.keys(bundle.entries).sort();
  const needed=[
    'qa/moeinshow-ticket-qr-qa-v1/EmitSyntheticArtifacts.php',
    'qa/moeinshow-ticket-qr-qa-v1/manifest.json',
    'qa/moeinshow-ticket-qr-qa-v1/source/composer.json',
    'qa/moeinshow-ticket-qr-qa-v1/source/app/tests/contract/TicketQrContract.php',
    'qa/moeinshow-ticket-qr-qa-v1/source/app/views/admin-reserve/print-ticket-new.php',
    'qa/moeinshow-ticket-qr-qa-v1/source/app/views/admin-reserve/_print-ticket-mpdf.php',
    'qa/moeinshow-ticket-qr-qa-v1/source/app/modules/api/views/public/print-ticket-new.php',
    'qa/moeinshow-ticket-qr-qa-v1/source/scripts/verify-ticket-qr-offline.sh'
  ].sort();
  exact(keys.join('|')===needed.join('|'),'bundle_extra_or_missing_path');
  const fixture={};
  for(const key of needed){
    const x=bundle.entries[key];
    exact(x&&typeof x.text==='string'&&/^[a-f0-9]{40}$/.test(x.blob_sha),'bundle_item_'+key);
    const bytes=Buffer.from(x.text,'utf8');
    exact(gitBlob(bytes)===x.blob_sha,'bundle_git_blob_'+key);
    fixture[FIXTURE_ROOT+key.slice('qa/moeinshow-ticket-qr-qa-v1/'.length)]=bytes;
  }
  return fixture;
}
/**
 * Produce a deterministic, SHA-checked plan BEFORE any mutation.
 *
 * io is an injected trusted executor interface, not a user-controlled input.
 * All paths are literals; any mismatch fails closed before the first write.
 * The gateway must have attested the release and signed approval separately.
 */
async function preflight(release,io){
  ensureRelease(release);
  exact(io && ['readOwner','readStagedAsset','assertSafeTarget',
    'serviceHealthy','snapshot','writeOwnerAtomic','writeFixtureAtomic',
    'readInstalledAsset',
    'removeFixture','restoreSnapshot','verifySnapshot','restartServices',
    'discoverTool','audit'].every(k=>typeof io[k]==='function'),'trusted_io_missing');
  const current={},preimageHash={};
  for(const [key,p] of Object.entries(OWNER_PATHS)){
    await io.assertSafeTarget(p);
    const value=await io.readOwner(p);
    exact(Buffer.isBuffer(value)&&value.length>100,'owner_missing_'+key);
    const sum=sha(value);
    exact(sum===release.normalized.owners[key].before_sha256,'preimage_sha_'+key);
    current[key]=value.toString('utf8');
    preimageHash[key]=sum;
  }
  const modified=candidateOwners(current);
  for(const [key,body] of Object.entries(modified)){
    exact(sha(Buffer.from(body,'utf8'))===release.normalized.owners[key].after_sha256,'postimage_sha_'+key);
  }
  const stage={};
  for(const x of release.normalized.assets){
    await io.assertSafeTarget(x.path);
    const bytes=await io.readStagedAsset(x.path);
    exact(Buffer.isBuffer(bytes)&&sha(bytes)===x.sha256,'staged_asset_sha');
    stage[x.path]=bytes;
  }
  exact(stage[ASSETS.helper].includes(Buffer.from('moeinshow_ticket_qr_offline_qa_v1')),'helper_action');
  const bundleText=stage[ASSETS.bundle].toString('utf8');
  // The reviewed bundle is a static JSON literal wrapped in Object.freeze.
  // Parse JSON; never execute staged code in the privileged registrar.
  const marker='module.exports = Object.freeze(';
  const pos=bundleText.indexOf(marker);
  const close=bundleText.lastIndexOf(');');
  exact(pos>=0 && bundleText.indexOf(marker,pos+marker.length)<0 &&
    close>pos && bundleText.slice(close).trim()===');' &&
    bundleText.slice(0,pos).trim()==="'use strict';\n// Static, strictly pinned synthetic QA fixtures. No runtime network fetch.",
    'bundle_wrapper_untrusted');
  let bundle;
  try{bundle=JSON.parse(bundleText.slice(pos+marker.length,close))}
  catch{fail('bundle_json_invalid')}
  const fixtures=verifyFixture(bundle);
  for(const p of Object.keys(fixtures)) await io.assertSafeTarget(p);
  for(const s of release.normalized.health.services)exact(await io.serviceHealthy(s),'service_unhealthy');
  return Object.freeze({release,current,modified,stage,fixtures,
    originalHashes:Object.freeze(preimageHash)});
}
function createGatewayCallbacks(release,io){
  let context=null, snapshotId=null, changed=false;
  return Object.freeze({
    trustedInstaller:async ({release:r,approval})=>{
      exact(r===release && approval?.level===4 && approval?.risk==='critical' &&
        typeof approval.request_id==='string','approval_context');
      context=await preflight(release,io);
      // Persist a FULL, byte-preserving snapshot before making a single write.
      snapshotId=await io.snapshot('create_exact_backup',Object.freeze({
        paths:[...Object.values(OWNER_PATHS),...Object.values(ASSETS),...Object.keys(context.fixtures)]
      }));
      exact(typeof snapshotId==='string'&&snapshotId.length>10,'backup_not_verified');
      for(const [key,p] of Object.entries(OWNER_PATHS)){
        changed=true;await io.writeOwnerAtomic(p,Buffer.from(context.modified[key],'utf8'));
      }
      // Both fixed action assets must be installed, not just the fixture tree.
      // Otherwise discovery could succeed while execution fails at require().
      for(const [p,bytes] of Object.entries(context.stage)){
        changed=true;await io.writeFixtureAtomic(p,bytes);
      }
      for(const [p,bytes] of Object.entries(context.fixtures)){
        changed=true;await io.writeFixtureAtomic(p,bytes);
      }
      for(const x of release.normalized.assets){
        const installed=await io.readInstalledAsset(x.path);
        exact(Buffer.isBuffer(installed)&&sha(installed)===x.sha256,'installed_asset_sha');
      }
      await io.restartServices(Object.freeze(release.normalized.health.services.slice()));
      for(const [key,p] of Object.entries(OWNER_PATHS)){
        const actual=await io.readOwner(p);
        exact(Buffer.isBuffer(actual)&&sha(actual)===release.normalized.owners[key].after_sha256,'post_write_sha_'+key);
      }
      return {ok:true,installedAssets:release.normalized.assets.length,
        updatedOwners:4,rollback:'not_needed'};
    },
    trustedRollback:async ()=>{
      if(!changed)return {verified:true,noop:true};
      exact(typeof snapshotId==='string','rollback_no_backup');
      await io.restoreSnapshot(snapshotId);
      await io.restartServices(Object.freeze(release.normalized.health.services.slice()));
      const ok=await io.verifySnapshot(snapshotId);
      return {verified:ok===true};
    },
    verifyOriginalState:async ()=>{
      if(!changed)return true;
      if(!snapshotId)return false;
      return await io.verifySnapshot(snapshotId)===true;
    },
    readInstalledTool:async name=>name===ACTION && await io.discoverTool(ACTION)===true,
    audit:async event=>io.audit(event)
  });
}
function main(argv){
  if(argv.length!==1||argv[0]!=='--source-review-only')fail('direct_execution_forbidden');
  return {source_only:true,registered:false,action:ACTION};
}
if(require.main===module){
  try{console.log(JSON.stringify(main(process.argv.slice(2))))}
  catch(e){console.error(String(e.message||e));process.exitCode=1}
}
module.exports=Object.freeze({
  ACTION,OPERATION,SOURCE_SHA,OWNER_PATHS,ASSETS,FIXTURE_ROOT,
  sha,gitBlob,candidateBase,candidateExecutor,candidateMcp,candidatePolicy,
  candidateOwners,verifyFixture,ensureRelease,preflight,createGatewayCallbacks,main
});
