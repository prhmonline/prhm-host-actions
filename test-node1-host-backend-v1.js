'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),os=require('node:os'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const m=require('./node1-host-backend-v1');
const R='20261008T160100Z';
test('actual host backend constructs inertly and no CLI activation',()=>{
 const b=m.createBackend(R);
 assert.equal(typeof b.invoke,'function');
 assert.equal(typeof b.exportToFile,'function');
 assert.equal(typeof b.artifact,'function');
 assert.equal(typeof b.runtimePreflight,'function');
 assert.equal(b.remoteIdentityVerified(),false);
});
test('production QEMU preflight stays blocked without independent proof',()=>{
 const b=m.createBackend(R);
 const p={runId:R,domain:'prhm-production'};
 assert.deepEqual(b.runtimePreflight(p),{libvirt_backup_api_supported:false,guest_agent_responsive:false,qemu_output_writable:false,selinux_context_verified:false,stage_path_exclusive:false});
 assert.throws(()=>b.runtimePreflight({runId:R,domain:'unknown'}),/preflight_plan_invalid/);
});
test('staging path cannot traverse or switch run ID',()=>{
 assert.equal(m.assertStage(R,m.STAGE+'/'+R+'/x'),'/'+'var/lib/prhm-backup/node1/staging/'+R+'/x');
 assert.throws(()=>m.assertStage(R,'/etc/passwd'),/stage_path_rejected/);
 assert.throws(()=>m.assertStage(R,m.STAGE+'/'+R+'/../bad'),/stage_path_rejected/);
 assert.throws(()=>m.assertStage(R,m.STAGE+'/other/vm/a'),/stage_path_rejected/);
});
test('backend rejects an unvalidated arbitrary binary before process invocation',()=>{
 const b=m.createBackend(R);
 assert.throws(()=>b.invoke({bin:'/bin/sh',args:['-c','touch /tmp/haha'],mutating:true}),/binary_not_allowlisted/);
 assert.throws(()=>b.invoke({bin:'/usr/bin/virsh',args:['destroy','prhm-production'],mutating:true}),/virsh_operation_rejected/);
 assert.throws(()=>b.invoke({bin:'/usr/bin/virsh',args:['domstate','prhm-production'],mutating:true}),/spec_tampering/);
});
test('backend rejects malformed XML before touching disk',()=>{
 const b=m.createBackend(R),dir=m.STAGE+'/'+R+'/vm/prhm-production';
 assert.throws(()=>b.createOutput({dir,xml:dir+'/backup.xml',body:'evil',exclusive:true,mode:0o600,symlinks:false}),/xml_invalid/);
 assert.throws(()=>b.createOutput({dir,xml:dir+'/backup.xml',body:'evil',exclusive:false,mode:0o600,symlinks:false}),/unsafe_xml_flags/);
});
test('backend excludes file metadata outside fixed run scope',()=>{
 const b=m.createBackend(R);
 assert.throws(()=>b.artifact('/etc/shadow'),/stage_path_rejected/);
 assert.throws(()=>b.artifact(m.STAGE+'/'+R+'/../etc'),/stage_path_rejected/);
 assert.throws(()=>b.artifact(m.STAGE+'/'+R+'/unapproved.txt'),/artifact_not_allowlisted/);
});
test('strict secret gate rejects non-existent or publicly readable secret',()=>{
 const f=path.join(os.tmpdir(),'not-a-node1-secret-'+process.pid);
 assert.equal(m.regularRootSecret(f),false);
});
test('SHA256 artifact implementation detects fixture content and rejects symlink',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'node1-backend-test-'));
 try {
  const file=path.join(d,'fixture.bin'),link=path.join(d,'link');
  const data=Buffer.from('synthetic-only / no server data');
  fs.writeFileSync(file,data);fs.symlinkSync(file,link);
  const meta=m.artifactHash(file);
  assert.equal(meta.regular,true);
  assert.equal(meta.bytes,data.length);
  assert.equal(meta.sha256,crypto.createHash('sha256').update(data).digest('hex'));
  assert.throws(()=>m.artifactHash(link),/artifact_not_regular/);
 }finally{fs.rmSync(d,{recursive:true,force:true})}
});
