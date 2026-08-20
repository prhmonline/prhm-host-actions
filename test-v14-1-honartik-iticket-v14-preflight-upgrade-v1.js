'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ROOT=__dirname;
const UP=path.join(ROOT,'bootstrap-host-actions-v14-1-honartik-iticket-preflight-upgrade-v1.js');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

test('upgrade is bound to the exact old installed state and corrected V14 artifacts',()=>{
  const up=require(UP);
  assert.equal(up.UPGRADE_VERSION,'1.14.1-honartik-iticket-v14-preflight-upgrade-v1');
  assert.equal(up.OLD.agentServer,'7171a63ac5a7e72cd7c0af7d0c90e7d16abd17ed1af623441c44387444e77b23');
  assert.equal(up.OLD.registry,'faec4810f1a8059f7c9bf7cb02a277d3e515b8f15bbc52dde8ddce347aa7155f');
  assert.equal(up.OLD.agentRoute,'a2c69c0066c514b938eb304bb38325199f81a269320829d0508d9b80323e4c92');
  assert.equal(up.OLD.mcpPlugin,'963529d9ebec49e64ea98798ca0dbf2cd8542f4fb648213a05cb3351f83d28a2');
  assert.equal(up.OLD.payload,'1cd8e33bdecaa2ebffc086c778e7938cb33b57b31e6abab21a183972259a0059');
  assert.equal(Object.prototype.hasOwnProperty.call(up.OLD,'hostActionsV2'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(up.NEW,'hostActionsV2'),false);
  assert.equal(up.NEW.agentRoute,sha(fs.readFileSync(path.join(ROOT,'honartik-iticket-v14-preflight-readonly-routes.js'))));
  assert.equal(up.NEW.payload,sha(fs.readFileSync(path.join(ROOT,'bootstrap-host-actions-v14-honartik-iticket-dark-backend-batch1.js'))));
  assert.equal(path.basename(up.SOURCES.agentRoute),'honartik-iticket-v14-preflight-readonly-routes.js');
  assert.equal(path.basename(up.SOURCES.payload),'bootstrap-host-actions-v14-honartik-iticket-dark-backend-batch1.js');
});

test('state classifier accepts only exact old or exact upgraded installation markers',()=>{
  const up=require(UP);
  const oldMarker={schema_version:'prhm.readonly-adapter-install.v1',version:up.ADAPTER_VERSION,tool:up.TOOL,installed_sha256:{...up.OLD}};
  assert.equal(up.classifyHashes({...up.OLD},oldMarker),'upgrade_required');
  const newMarker={...oldMarker,installed_sha256:{...up.NEW}};
  assert.equal(up.classifyHashes({...up.NEW},newMarker),'already_upgraded');
  const drift={...up.OLD,payload:'0'.repeat(64)};
  const driftMarker={...oldMarker,installed_sha256:{...drift}};
  assert.throws(()=>up.classifyHashes(drift,driftMarker),/installed_state_drift/);
  assert.throws(()=>up.classifyHashes({...up.OLD},{...oldMarker,installed_sha256:{...up.OLD,payload:'f'.repeat(64)}}),/installed_marker_sha_mismatch:payload/);
  const markerWithHistoricalHostActions={...oldMarker,installed_sha256:{...up.OLD,hostActionsV2:'1'.repeat(64)}};
  assert.equal(up.classifyHashes({...up.OLD,hostActionsV2:'2'.repeat(64)},markerWithHistoricalHostActions),'upgrade_required');
});

test('upgrader mutation surface is limited to route payload marker and Agent API restart',()=>{
  const src=fs.readFileSync(UP,'utf8');
  assert.match(src,/SERVICES=Object\.freeze\(\['prhm-agent-api\.service'\]\)/);
  assert.doesNotMatch(src,/prhm-agent-mcp\.service/);
  assert.doesNotMatch(src,/atomicWrite\(PATHS\.(agentServer|mcpRegistry|mcpPlugin|hostActionsV2)/);
  assert.match(src,/atomicWrite\(PATHS\.agentRoute/);
  assert.match(src,/atomicWrite\(PATHS\.payload/);
  assert.match(src,/atomicWrite\(PATHS\.marker/);
  assert.doesNotMatch(src,/https?:\/\//);
  assert.match(src,/host_actions_v2_changed_during_upgrade/);
});

test('preflight is read-only and rollback restores all three mutable files',()=>{
  const up=require(UP);
  const pre=up.preflight.toString();
  assert.doesNotMatch(pre,/atomicWrite|restart|backupFile/);
  const src=fs.readFileSync(UP,'utf8');
  assert.match(src,/restoreBackup\(backups\.marker\)/);
  assert.match(src,/restoreBackup\(backups\.payload\)/);
  assert.match(src,/restoreBackup\(backups\.agentRoute\)/);
  assert.match(src,/systemctl\('restart','prhm-agent-api\.service'\)/);
});

test('marker upgrade preserves adapter identity and records bounded provenance',()=>{
  const up=require(UP);
  const oldMarker={schema_version:'prhm.readonly-adapter-install.v1',version:up.ADAPTER_VERSION,tool:up.TOOL,installed_at:'2026-08-20T00:00:00.000Z',backup_dir:'/old',installed_sha256:{...up.OLD},control_plane_mutation:true};
  const m=up.buildUpgradedMarker(oldMarker,{...up.NEW},'/backup','2026-08-20T17:00:00.000Z');
  assert.equal(m.schema_version,'prhm.readonly-adapter-install.v1');
  assert.equal(m.version,up.ADAPTER_VERSION);
  assert.equal(m.tool,up.TOOL);
  assert.equal(m.installed_at,oldMarker.installed_at);
  assert.deepEqual(m.installed_sha256,up.NEW);
  assert.equal(m.last_upgrade.version,up.UPGRADE_VERSION);
  assert.equal(m.last_upgrade.backup_dir,'/backup');
  assert.deepEqual(m.last_upgrade.from,{agentRoute:up.OLD.agentRoute,payload:up.OLD.payload});
  assert.deepEqual(m.last_upgrade.to,{agentRoute:up.NEW.agentRoute,payload:up.NEW.payload});
});
