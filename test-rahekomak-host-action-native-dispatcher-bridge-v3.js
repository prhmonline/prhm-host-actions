'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const cp=require('node:child_process'),path=require('node:path');
const mod=require('./rahekomak-host-action-native-dispatcher-bridge-v3.js');
const reg=require('./rahekomak-host-action-registration-v3.js');
const tx=require('./rahekomak-host-action-typed-registration-bootstrap-v3.js');
function native(){
 const calls=[];
 const io=Object.fromEntries(['acquireExclusive','consumeSignedLevel4','hasReceipt',
 'statExact','readBytes','readSourceBlob','backupExact','replaceAtomic','removeExact',
 'reloadAndHealth','persistReceipt'].map(n=>[n,(...a)=>{calls.push({n,a});return null}]));
 return {io,calls};
}
test('exact 4+5 allowlist, pinned source and no self approval',()=>{
 assert.equal(mod.TARGETS.length,9);
 assert.deepEqual(mod.TARGETS,tx.paths());
 assert.deepEqual(mod.OWNERS,Object.values(reg.PATHS));
 assert.equal(mod.SOURCE_COMMIT,'4110de9f99a260b377875640ba1f71d69d3b5ea4');
 const m=mod.manifest();assert.equal(m.installed,false);
 assert.equal(m.approval_source,'external_trusted_native_dispatcher_only');
 assert.equal(m.deployment_authorized,false);
});
test('reject missing native issuer interfaces, never call any method',()=>{
 assert.throws(()=>mod.createNativeBridge(),/native_method_missing/);
 assert.throws(()=>mod.createNativeBridge({}),/native_method_missing/);
});
test('all external calls are pinned to immutable targets and source',()=>{
 const n=native(),b=mod.createNativeBridge(n.io);
 assert.throws(()=>b.statExact('/etc/shadow'),/unapproved_target/);
 assert.throws(()=>b.readBytes('/etc/passwd'),/unapproved_target/);
 assert.throws(()=>b.readSourceArtifact('outside.js',mod.SOURCE_COMMIT),/unapproved_source/);
 assert.throws(()=>b.readSourceArtifact(tx.NAMES[0],'f'.repeat(40)),/unapproved_source/);
 assert.deepEqual(n.calls,[]);
 const target=mod.TARGETS[0];b.statExact(target);
 assert.equal(n.calls[0].a[0],target);
});
test('reject unreviewed blobs, arbitrary writes, metadata and owner deletes',async()=>{
 const n=native(),b=mod.createNativeBridge(n.io);
 assert.throws(()=>b.readSourceArtifact(tx.NAMES[0],mod.SOURCE_COMMIT),/reviewed_source_blob_mismatch/);
 await assert.rejects(b.replaceAtomic('/etc/shadow',Buffer.from('x'),{mode:0o644,uid:0,gid:0}),/unapproved_target/);
 await assert.rejects(b.replaceAtomic(mod.TARGETS[0],Buffer.from('x'),{mode:0o666,uid:0,gid:0}),/invalid_replacement/);
 await assert.rejects(b.removeExact(mod.OWNERS[0]),/unapproved_removal/);
 await assert.rejects(b.backupExact(mod.TARGETS[4],Buffer.from('x'),'f'.repeat(64),'r'),/invalid_owner_backup/);
 assert.deepEqual(n.calls.map(x=>x.n),['readSourceBlob']);
 assert.deepEqual(n.calls[0].a[0],{repository:'prhmonline/prhm-host-actions',
  commit:mod.SOURCE_COMMIT,path:tx.NAMES[0]});
});
test('native signed approval proof cannot be made up by the bridge',async()=>{
 const n=native(),b=mod.createNativeBridge(n.io);
 await assert.rejects(b.consumeSignedLevel4({action:mod.ACTION,operation:mod.OPERATION,
 source_commit:mod.SOURCE_COMMIT,level:3,risk:'high',one_time:true}),/approval_binding_mismatch/);
 assert.equal(n.calls.length,0);
 const scope={action:mod.ACTION,operation:mod.OPERATION,source_commit:mod.SOURCE_COMMIT,
 level:4,risk:'critical',one_time:true};
 await b.consumeSignedLevel4(scope);
 assert.deepEqual(n.calls.map(x=>x.n),['consumeSignedLevel4']);
 assert.ok(Object.isFrozen(n.calls[0].a[0]));
});
test('no CLI installer or direct root mutation',()=>{
 const r=cp.spawnSync(process.execPath,[path.join(__dirname,
 'rahekomak-host-action-native-dispatcher-bridge-v3.js')],{encoding:'utf8'});
 assert.equal(r.status,64);
 assert.match(r.stderr,/Independent signed Level-4/);
 assert.equal(r.stdout,'');
});
