'use strict';
// Fixed-scope, read-only Node1 VM geometry/guest-agent candidate.
// No CLI, installer, service changes, backup action or production writes.
// This source must be reviewed, SHA-bound and invoked by an approved Agent3 readonly surface.
// A command runner is injected in tests; the caller must not accept arbitrary args.
const path=require('node:path');
const VM=require('./node1-live-vm-backup-v1').DOMAINS;
const DOMAINS=Object.freeze(Object.keys(VM).sort());
const VIRSH='/usr/bin/virsh', QEMU_IMG='/usr/bin/qemu-img';
function requireValid(test,code){if(!test)throw Error(code)}
function getCommands(domain){
  requireValid(DOMAINS.includes(domain),'unlisted_vm');
  return Object.freeze([
    Object.freeze({bin:VIRSH,args:Object.freeze(['--readonly','domstate',domain])}),
    Object.freeze({bin:VIRSH,args:Object.freeze(['--readonly','domblklist',domain,'--details'])}),
    Object.freeze({bin:VIRSH,args:Object.freeze(['--readonly','domblkinfo',domain,'vda'])}),
    Object.freeze({bin:VIRSH,args:Object.freeze(['--readonly','domfsinfo',domain])}),
    Object.freeze({bin:QEMU_IMG,args:Object.freeze(['info','--output=json',VM[domain].source])})
  ]);
}
function safeInteger(value,code){
  requireValid(typeof value==='number'&&Number.isSafeInteger(value)&&value>0,code);
  return value;
}
function diskListMatches(output,domain){
  const lines=String(output).split(/\r?\n/).map(s=>s.trim()).filter(s=>/^(file|block)\s+disk\s+/.test(s));
  const expected='file disk vda '+VM[domain].source;
  requireValid(lines.length===1&&lines[0]===expected,'unexpected_disk_mapping');
  return true;
}
function parseBlockInfo(output){
  const data={};
  for(const line of String(output).split(/\r?\n/)){
    const m=line.match(/^\s*(Capacity|Allocation|Physical):\s*(\d+)\s*$/);
    if(m){
      requireValid(data[m[1]]===undefined,'duplicate_blockinfo_key');
      data[m[1]]=Number(m[2]);
    }
  }
  for(const k of ['Capacity','Allocation','Physical'])safeInteger(data[k],'invalid_blockinfo_'+k);
  requireValid(data.Capacity>=data.Allocation||data.Physical>0,'blockinfo_incoherent');
  return Object.freeze({virtualBytes:data.Capacity,allocationBytes:data.Allocation,physicalBytes:data.Physical});
}
function parseQemuInfo(output){
  let j;
  try{j=JSON.parse(String(output))}catch{throw Error('qemu_info_not_json')}
  requireValid(j&&typeof j==='object'&&!Array.isArray(j),'qemu_info_not_object');
  safeInteger(j['virtual-size'],'qemu_virtual_size_invalid');
  requireValid(j.format==='qcow2','unexpected_image_format');
  requireValid(j['backing-filename']===undefined&&j['full-backing-filename']===undefined,'backing_chain_requires_review');
  return Object.freeze({virtualBytes:j['virtual-size'],format:'qcow2',backingChainDetected:false});
}
function validateFsInfo(output){
  const text=String(output);
  requireValid(text.length>0&&text.length<32768,'guest_agent_empty_or_too_large');
  requireValid(!/error:|failed|not connected|not supported|not running|unavailable/i.test(text),'guest_agent_error');
  // The "domfsinfo" reply may contain guest paths. Never return the raw output.
  const rows=text.split(/\r?\n/).filter(x=>/^\s*\d+\s+/.test(x));
  requireValid(rows.length>=1,'guest_fsinfo_missing');
  return Object.freeze({guestAgentResponsive:true,mountedFilesystems:rows.length});
}
function assessDomain(domain,runner){
  requireValid(DOMAINS.includes(domain),'unlisted_vm');
  requireValid(runner&&typeof runner.read==='function'&&typeof runner.fileMeta==='function','readonly_adapter_missing');
  const cmd=getCommands(domain);
  const evidence={domain,source:VM[domain].source,virtualBytes:null,physicalBytes:null,
    allocationBytes:null,geometrySource:null,guestAgentResponsive:false,mountedFilesystems:0,errors:[]};
  try{
    const state=String(runner.read(cmd[0])).trim().toLowerCase();
    requireValid(state==='running','vm_not_running');
    diskListMatches(runner.read(cmd[1]),domain);
    const meta=runner.fileMeta(VM[domain].source);
    requireValid(meta?.isRegular===true&&meta?.isSymlink===false&&meta?.realpath===VM[domain].source,'vm_source_file_unsafe');
    const blk=parseBlockInfo(runner.read(cmd[2]));
    const fsinfo=validateFsInfo(runner.read(cmd[3]));
    const qemu=parseQemuInfo(runner.read(cmd[4]));
    requireValid(blk.virtualBytes===qemu.virtualBytes,'virsh_qemu_virtual_size_mismatch');
    evidence.virtualBytes=blk.virtualBytes;
    evidence.physicalBytes=blk.physicalBytes;
    evidence.allocationBytes=blk.allocationBytes;
    evidence.geometrySource='qemu-img-info';
    evidence.guestAgentResponsive=fsinfo.guestAgentResponsive;
    evidence.mountedFilesystems=fsinfo.mountedFilesystems;
  }catch(err){
    evidence.errors.push(String(err.message||err).replace(/[^a-zA-Z0-9:_-]/g,'').slice(0,128));
  }
  return Object.freeze({...evidence,errors:Object.freeze(evidence.errors),ok:evidence.errors.length===0});
}
function report(runner){
  const domains=DOMAINS.map(x=>assessDomain(x,runner));
  const ok=domains.every(x=>x.ok);
  return Object.freeze({schema_version:'prhm.node1-vm-geometry-readonly.v1',
    host:'server1.prhm.ir',readonly:true,production_mutation:false,
    all_domains_verified:ok,domains:Object.freeze(domains),
    totalVirtualBytes:ok?domains.reduce((sum,x)=>sum+x.virtualBytes,0):null,
    ready_for_deployment:false});
}
module.exports={VIRSH,QEMU_IMG,DOMAINS,getCommands,diskListMatches,parseBlockInfo,parseQemuInfo,validateFsInfo,assessDomain,report};
