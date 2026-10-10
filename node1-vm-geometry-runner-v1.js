'use strict';
// Deliberately standalone read-only runner for a future approved Agent 3 zero-input
// diagnostics action. No shell, no files created, no SSH, no service control.
// This program must run on node1 ONLY after a verified Git-SHA delivery. It
// never substitutes for explicit deployment approval.
const cp=require('node:child_process'),fs=require('node:fs');
const probe=require('./node1-vm-geometry-readonly-v1');
const vm=require('./node1-live-vm-backup-v1').DOMAINS;
function deny(cond,code){if(!cond)throw Error(code)}
const allowed=new Set(probe.DOMAINS.flatMap(d=>probe.getCommands(d).map(x=>JSON.stringify([x.bin,...x.args]))));
const allowedPaths=new Set(Object.values(vm).map(x=>x.source));
function realAdapter(deps={spawn:cp.spawnSync,lstat:fs.lstatSync,realpath:fs.realpathSync}){
 deny(typeof deps.spawn==='function'&&typeof deps.lstat==='function'&&typeof deps.realpath==='function','deps_invalid');
 return Object.freeze({
   read(spec){
     const key=JSON.stringify([spec?.bin,...(spec?.args||[])]);
     deny(allowed.has(key),'readonly_command_not_allowlisted');
     const ret=deps.spawn(spec.bin,[...spec.args],{
       encoding:'utf8',timeout:20000,maxBuffer:131072,
       shell:false,stdio:['ignore','pipe','pipe'],
       env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/root'}
     });
     deny(!ret.error&&ret.status===0&&!ret.signal,'readonly_probe_failed');
     deny(typeof ret.stdout==='string'&&ret.stdout.length<=131072,'readonly_probe_output_oversize');
     return ret.stdout;
   },
   fileMeta(file){
     deny(allowedPaths.has(file),'vm_source_not_allowlisted');
     const stat=deps.lstat(file);
     return Object.freeze({isRegular:stat.isFile(),isSymlink:stat.isSymbolicLink(),realpath:deps.realpath(file)});
   }
 });
}
function main(args=process.argv.slice(2),deps){
 deny(Array.isArray(args)&&args.length===1&&args[0]==='--readonly','only_readonly_mode_supported');
 // All returned metadata is bounded: no guest mount names, CLI stderr or secrets.
 return probe.report(realAdapter(deps));
}
if(require.main===module){
 try{
   const r=main();
   process.stdout.write(JSON.stringify(r)+'\n');
   if(!r.all_domains_verified)process.exitCode=2;
 }catch(e){
   process.stderr.write(JSON.stringify({ok:false,error:String(e.message||e).replace(/[^a-zA-Z0-9:_-]/g,'').slice(0,100)})+'\n');
   process.exitCode=2;
 }
}
module.exports={allowed,allowedPaths,realAdapter,main};
