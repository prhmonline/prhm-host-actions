'use strict';
/**
 * Honartik Registry V2: existing THREE independent signed-stage manifests
 * describe one complete review closure (35 runtime objects plus one unit).
 *
 * This file is ONLY a Git/CI regression test. No host access, installation,
 * privilege elevation, L4 consumption, credentials, or runtime registration.
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const root=require('./manifests/honartik-shared-registry-v2-independent-root-launcher-stage-v2.json');
const sidecar=require('./manifests/honartik-shared-registry-v2-root-capabilities-stage-v1.json');
const unit=require('./manifests/honartik-shared-registry-v2-sidecar-unit-stage-v1.json');

const blob=bytes=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
const GIT_SHA=/^[0-9a-f]{40}$/;
const RUNTIME='/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2';
const UNIT='/etc/systemd/system/prhm-shared-registry-approval-v2.service';
const FILE=/^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/;
const sources=Object.freeze([...root.reviewed_code,...sidecar.files]);

test('three existing immutable manifests comprise 35 exact runtime assets and one isolated systemd unit',()=>{
 assert.equal(root.repo,'prhmonline/prhm-host-actions');
 assert.equal(sidecar.repo,root.repo);
 assert.equal(unit.repo,root.repo);
 assert.equal(root.project,'honartik');
 assert.equal(sidecar.project,root.project);
 assert.equal(unit.project,root.project);
 assert.equal(root.root,RUNTIME);
 assert.equal(sidecar.destination_root,RUNTIME);
 assert.equal(root.status,'REVIEWED_SOURCE_ONLY_NOT_STAGED');
 assert.equal(sidecar.status,'NOT_STAGED');
 assert.equal(unit.status,'NOT_STAGED');
 assert.equal(root.reviewed_code.length,28);
 assert.equal(sidecar.files.length,7);
 assert.equal(sources.length,35);
 assert.equal(new Set(sources.map(x=>x.source_path)).size,35);
 assert.equal(new Set(sources.map(x=>x.destination)).size,35);
 assert.equal(unit.dedicated_unit,'prhm-shared-registry-approval-v2.service');
 assert.equal(unit.destination,UNIT);
 assert.equal(unit.source_units[0].source_path,
  'systemd/prhm-shared-registry-approval-v2.service');
 assert.equal(unit.source_units[0].git_blob_sha1,
  'dc87ad2937b63ab965944cef081f55a6a0984cdd');
 for(const f of sources){
  assert.ok(FILE.test(f.source_path)&&!f.source_path.includes('..'),
   'invalid stage source path '+f.source_path);
  assert.equal(f.destination,RUNTIME+'/'+f.source_path);
  assert.match(f.git_blob_sha1,GIT_SHA);
  assert.match(f.source_commit,GIT_SHA);
 }
});

test('all 35 runtime files and reviewed isolated unit match historical Git blob and current branch',()=>{
 const assets=[...sources,unit.source_units[0]];
 for(const f of assets){
  const resolved=path.join(__dirname,f.source_path);
  const bytes=fs.readFileSync(resolved);
  assert.equal(blob(bytes),f.git_blob_sha1,
   'branch has stale, unreviewed, or modified bytes: '+f.source_path);
  const p=cp.spawnSync('git',['show',f.source_commit+':'+f.source_path],{
   cwd:__dirname,timeout:15000,maxBuffer:5000000
  });
  assert.equal(p.status,0,'missing immutable Git source: '+f.source_path);
  assert.equal(blob(p.stdout),f.git_blob_sha1,
   'historical SHA binding invalid: '+f.source_path);
 }
});

test('every literal relative CommonJS require from entire 35-file bundle is pinned',()=>{
 const paths=new Set(sources.map(x=>x.source_path));
 let dependencies=0;
 for(const f of sources){
  if(!f.source_path.endsWith('.cjs'))continue;
  const bytes=fs.readFileSync(path.join(__dirname,f.source_path),'utf8');
  for(const m of bytes.matchAll(/\brequire\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)){
   let required=path.posix.normalize(path.posix.join(
    path.posix.dirname(f.source_path),m[1]));
   if(!path.posix.extname(required))required+='.cjs';
   dependencies++;
   assert.ok(paths.has(required),
    'unreviewed runtime import '+f.source_path+' -> '+required);
  }
 }
 assert.ok(dependencies>=45,'suspiciously incomplete closure');
});

test('approved unit sources only the fixed trusted sidecar and declares immutable sandbox',()=>{
 const source=fs.readFileSync(path.join(__dirname,
  unit.source_units[0].source_path),'utf8');
 const values=Object.fromEntries(source.split('\n')
  .filter(x=>/^[a-zA-Z]+(?:[a-zA-Z]+)?=/.test(x))
  .map(x=>{const at=x.indexOf('=');return[x.slice(0,at),x.slice(at+1)]}));
 assert.equal(values.User,'root');
 assert.equal(values.Group,'root');
 assert.equal(values.ProtectSystem,'strict');
 assert.equal(values.ProtectHome,'yes');
 assert.equal(values.NoNewPrivileges,'yes');
 assert.equal(values.PrivateTmp,'yes');
 assert.equal(values.Restart,'no');
 assert.equal(values.ExecStart,'/usr/local/bin/prhm-node20 '+RUNTIME+
  '/prhm-action-registry-v2-isolated-socket-v1.cjs');
 assert.ok(sources.some(x=>x.source_path===
  'prhm-action-registry-v2-isolated-socket-v1.cjs'));
 assert.ok(!source.includes('\n[Install]\n'),
  'unit must not be auto-enabled by generic systemd target');
});

test('all three manifests preserve strict NO-GO until a new exact signed L4 installation',()=>{
 for(const flag of ['standalone_execution_authorized','root_staged',
  'approval_center_ledger_verified','sealed_mcp_bearer_verified',
  'signed_l4_issued','signed_l4_consumed','production_modified']){
  assert.equal(root[flag],false,'root source-only '+flag);
 }
 assert.equal(root.requires_external_signed_root_stage,true);
 assert.equal(root.host_preflight_verified,false);
 assert.equal(sidecar.requires_fresh_signed_l4,true);
 for(const flag of ['installation_authorized','production_mutation',
  'root_capabilities_installed','independent_sidecar_installed',
  'consumed_ledger_reader_installed','dual_mcp_discovery_verified',
  'real_recovery_verified']){
  assert.equal(sidecar[flag],false,'sidecar source-only '+flag);
 }
 assert.equal(unit.non_installable_without_signed_five_field_bootstrap,true);
 for(const flag of ['installed','enabled','service_started','production_mutation',
  'l4_requested','l4_consumed','authenticated_blue_green_discovery_attested']){
  assert.equal(unit[flag],false,'unit source-only '+flag);
 }
});
