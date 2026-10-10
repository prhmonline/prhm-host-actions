'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const mod=require('./node1-backup-source-v1');
function good(){return {tools:Object.fromEntries(mod.C.requiredTools.map(x=>[x,true])),paths:Object.fromEntries(mod.C.volumes.map(x=>[x,true])),privateConfig:true,privateMariadbConfig:true,dedicatedClientVerified:true,repoExact:true,encryptionKeyVerified:true,vmInventoryVerified:true,runningVMs:[],capacityBytes:10*1024**3,isolatedSqlRestoreReady:true}}
test('only read-only preflight is exposed',()=>{assert.throws(()=>mod.main(['--execute']),/only_readonly_preflight_supported/);assert.throws(()=>mod.main([]),/only_readonly_preflight_supported/);});
test('fixed scopes/host/repository are bounded',()=>{assert.equal(mod.C.host,'server1.prhm.ir');assert.equal(mod.C.repo,'rclone:gdrive-backup:PRHM-Backups/node1');assert.deepEqual(mod.C.volumes,['/etc','/home','/usr/local/directadmin'])});
test('fully met preflight can pass',()=>{const s=mod.decideReadiness(good());assert.equal(s.ok,true);assert.equal(s.mutation,false)});
test('blocks running production VM without consistent snapshot pathway',()=>{const s=good();s.runningVMs=['prhm-production'];assert.equal(mod.decideReadiness(s).ok,false);assert.ok(mod.decideReadiness(s).reasons.includes('live_vm_snapshot_pipeline_not_implemented'))});
test('blocks absent isolated SQL recovery',()=>{const s=good();s.isolatedSqlRestoreReady=false;assert.ok(mod.decideReadiness(s).reasons.includes('isolated_database_replay_not_implemented'))});
test('blocks insecure/missing secrets and remote encryption',()=>{const s=good();s.privateConfig=false;s.encryptionKeyVerified=false;s.dedicatedClientVerified=false;let r=mod.decideReadiness(s);assert.equal(r.ok,false);assert.equal(r.reasons.length,3)});
test('blocks missing restic, rclone and insufficient scratch space',()=>{const s=good();s.tools['/usr/bin/restic']=false;s.tools['/usr/bin/rclone']=false;s.capacityBytes=1;let r=mod.decideReadiness(s);assert.equal(r.ok,false);assert.ok(r.reasons.includes('insufficient_local_scratch_capacity'))});
test('no arbitrary database command, remote exec or backup action is present',()=>{const s=require('node:fs').readFileSync(require.resolve('./node1-backup-source-v1'),'utf8');assert.doesNotMatch(s,/\bssh\b|\brsync\b|--all-databases|--execute'?\s*\)|systemctl start/)});
