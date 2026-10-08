'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const a=require('./node1-host-adapter-v1');
const vm=require('./node1-live-vm-backup-v1');
const offsite=require('./node1-db-offsite-v1');
const R='20261008T153000Z',H='a'.repeat(40);
function backend(){const calls=[];return {calls,invoke(s){calls.push(['invoke',s]);return 'ok'},createOutput(s){calls.push(['output',s]);return true},artifact(p){calls.push(['artifact',p]);return {regular:true,symlink:false,bytes:100,sha256:'f'.repeat(64)}},exportToFile(s){calls.push(['dump',s]);return true},runtimePreflight(s){calls.push(['preflight',s]);return {libvirt_backup_api_supported:true,guest_agent_responsive:true,qemu_output_writable:true,selinux_context_verified:true,stage_path_exclusive:true}},secretFileValid(){return true},remoteIdentityVerified(){return true}}}
function gate(b,extra={}){return a.makeRestrictedAdapter({approved:{verifiedBy:'PRHM-L4-host-action',action:'node1_backup_implementation_v1',level:4,commitSha:H,...extra},backend:b,runId:R})}
test('cannot create adapter without bound L4 marker or required backend',()=>{
 assert.throws(()=>a.makeRestrictedAdapter({approved:{},backend:backend(),runId:R}),/execution_authority_missing/);
 assert.throws(()=>a.makeRestrictedAdapter({approved:{verifiedBy:'PRHM-L4-host-action',action:'node1_backup_implementation_v1',level:3,commitSha:H},backend:backend(),runId:R}),/execution_authority_missing/);
 assert.throws(()=>a.makeRestrictedAdapter({approved:{verifiedBy:'PRHM-L4-host-action',action:'node1_backup_implementation_v1',level:4,commitSha:H},backend:{},runId:R}),/backend_missing/);
});
test('allowlist accepts exact virsh domstate and guarded backup begin',()=>{
 const b=backend(),adapter=gate(b),p=a.planOf('prhm-production',R);
 assert.equal(adapter.command('/usr/bin/virsh',['domstate','prhm-production']),'ok');
 assert.equal(adapter.command('/usr/bin/virsh',['backup-begin','prhm-production',p.xml]),'ok');
 assert.equal(b.calls[1][1].mutating,true);
});
test('virsh mutation cannot alter domains or source destinations',()=>{
 const b=backend(),x=gate(b);
 assert.throws(()=>x.command('/usr/bin/bash',['-c','id']),/binary_not_allowlisted/);
 assert.throws(()=>x.command('/usr/bin/virsh',['destroy','prhm-production']),/virsh_operation_rejected/);
 assert.throws(()=>x.command('/usr/bin/virsh',['backup-begin','prhm-production','/tmp/fake.xml']),/virsh_operation_rejected/);
 assert.throws(()=>x.command('/usr/bin/virsh',['domstate','different-vm']),/vm_domain_not_allowlisted/);
 assert.equal(b.calls.length,0);
});
test('stage path confinement rejects traversal and other run',()=>{
 assert.throws(()=>a.insideFixedRoot('/etc/passwd'),/path_outside_fixed_stage/);
 assert.throws(()=>a.insideFixedRoot('/var/lib/prhm-backup/node1/staging/../../etc'),/path_outside_fixed_stage/);
 const x=gate(backend());assert.throws(()=>x.artifact('/var/lib/prhm-backup/node1/staging/other/vm/prhm-production/vda.qcow2'),/artifact_wrong_run/);
});
test('fixed XML only and safe exclusive creation',()=>{
 const b=backend(),x=gate(b),p=a.planOf('prhm-production',R);
 const body=vm.makePlan('prhm-production',R,'file disk vda /var/lib/libvirt/images/prhm-production.qcow2\n').body;
 x.createOutput(p.base+'/vm/prhm-production',p.xml,body);
 assert.deepEqual(b.calls[0][1],{dir:p.base+'/vm/prhm-production',xml:p.xml,body,exclusive:true,mode:0o600,symlinks:false});
 assert.throws(()=>x.createOutput(p.base+'/vm/prhm-production',p.xml,'<wrong/>'),/xml_content_rejected/);
 assert.throws(()=>x.createOutput('/tmp',p.xml,body),/xml_dir_rejected/);
});
test('SQL dump requires fixed credentials, exact argv, and root-exclusive output',()=>{
 const b=backend(),x=gate(b),p=offsite.sqlDumpPlan(R);
 x.exportToFile(p.bin,p.args,p.file,{owner:'root',mode:0o600,noShell:true,createExclusive:true});
 assert.equal(b.calls[0][0],'dump');
 assert.throws(()=>x.exportToFile(p.bin,['--all-databases'],p.file,{owner:'root',mode:0o600,noShell:true,createExclusive:true}),/dump_command_rejected/);
 assert.throws(()=>x.exportToFile(p.bin,p.args,p.file,{owner:'root',mode:0o644,noShell:true,createExclusive:true}),/dump_output_flags_rejected/);
});
test('Restic command cannot use alternative repo, delete/forget/prune or override file',()=>{
 const b=backend(),x=gate(b);
 const remote=offsite.CONF.remote,pw=offsite.CONF.password,base=['--repo',remote,'--password-file',pw];
 assert.equal(x.run(offsite.CONF.restic,[...base,'snapshots','--json','--tag','node1-'+R]),'ok');
 assert.throws(()=>x.run(offsite.CONF.restic,[...base,'forget','--prune']),/restic_operation_rejected/);
 assert.throws(()=>x.run(offsite.CONF.restic,['--repo','/etc', '--password-file',pw,'backup','/']),/restic_operation_rejected/);
 assert.throws(()=>x.run(offsite.CONF.restic,[...base,'restore','latest','--target','/']),/restic_operation_rejected/);
});
test('preflight is bound to run/domain',()=>{
 const x=gate(backend());
 assert.equal(x.preflight({domain:'prhm-production',runId:R}).libvirt_backup_api_supported,true);
 assert.throws(()=>x.preflight({domain:'prhm-production',runId:'other'}),/preflight_scope_rejected/);
});
