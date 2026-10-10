'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const runner=require('./node1-vm-geometry-runner-v1');
const vm=require('./node1-live-vm-backup-v1').DOMAINS;
const GiB=1024**3;
function fake(){
 const calls=[];
 const deps={
   spawn(bin,args,options){
     calls.push({bin,args,options});
     assert.equal(options.shell,false);
     const d=bin==='/usr/bin/virsh'?args[2]:Object.keys(vm).find(x=>vm[x].source===args[2]);
     const cap=d==='prhm-production'?350*GiB:80*GiB;
     let out;
     switch(bin==='/usr/bin/virsh'?args[1]:'qemu-info'){
       case 'domstate':out='running\n';break;
       case 'domblklist':out='Type Device Target Source\n--------\nfile disk vda '+vm[d].source+'\n';break;
       case 'domblkinfo':out='Capacity: '+cap+'\nAllocation: '+Math.floor(cap/2)+'\nPhysical: '+Math.floor(cap/2)+'\n';break;
       case 'domfsinfo':out='Mountpoint Name Type Target\n-----\n/ dm-0 xfs vda\n';break;
       case 'qemu-info':out=JSON.stringify({format:'qcow2','virtual-size':cap});break;
       default:throw Error('unexpected_spawn');
     }
     return {stdout:out,status:0,signal:null,error:null};
   },
   lstat(){return {isFile:()=>true,isSymbolicLink:()=>false}},
   realpath(p){return p}
 };
 return {deps,calls};
}
test('runner CLI accepts only exact readonly mode',()=>{
 assert.throws(()=>runner.main([]),/only_readonly_mode_supported/);
 assert.throws(()=>runner.main(['--execute']),/only_readonly_mode_supported/);
 assert.throws(()=>runner.main(['--readonly','--extra']),/only_readonly_mode_supported/);
});
test('runner reads both exact VM geometries without any privileged change operation',()=>{
 const f=fake(),r=runner.main(['--readonly'],f.deps);
 assert.equal(r.all_domains_verified,true);
 assert.equal(r.totalVirtualBytes,430*GiB);
 assert.equal(r.ready_for_deployment,false);
 assert.equal(f.calls.length,10);
 assert(f.calls.every(x=>x.options.shell===false));
 assert(f.calls.filter(x=>x.bin==='/usr/bin/virsh').every(x=>x.args[0]==='--readonly'));
 assert(!JSON.stringify(r).includes('/boot'));
});
test('runner rejects any arbitrary host command before spawn',()=>{
 const f=fake(),a=runner.realAdapter(f.deps);
 assert.throws(()=>a.read({bin:'/bin/bash',args:['-c','whoami']}),/readonly_command_not_allowlisted/);
 assert.throws(()=>a.read({bin:'/usr/bin/virsh',args:['destroy','prhm-production']}),/readonly_command_not_allowlisted/);
 assert.throws(()=>a.read({bin:'/usr/bin/qemu-img',args:['resize',vm['prhm-production'].source,'700G']}),/readonly_command_not_allowlisted/);
 assert.equal(f.calls.length,0);
});
test('runner rejects source paths outside both fixed VM images',()=>{
 const f=fake(),a=runner.realAdapter(f.deps);
 assert.throws(()=>a.fileMeta('/etc/shadow'),/vm_source_not_allowlisted/);
 assert.throws(()=>a.fileMeta('/var/lib/libvirt/images/another.qcow2'),/vm_source_not_allowlisted/);
});
test('runner rejects failed or timed-out readonly commands without leaking output',()=>{
 const f=fake();
 f.deps.spawn=()=>({stdout:'sensitive diagnostic output',stderr:'internal credentials',status:1,signal:null,error:null});
 const a=runner.realAdapter(f.deps);
 assert.throws(()=>a.read({bin:'/usr/bin/virsh',args:['--readonly','domstate','prhm-production']}),/readonly_probe_failed/);
});
