'use strict';
// Candidate adapter. NOT an independently authorized deployment or approval mechanism.
// Must be invoked only by a separately reviewed SHA-bound, Level-4 host action.
// No CLI; importing this file performs no I/O.
const vm=require('./node1-live-vm-backup-v1');
const offsite=require('./node1-db-offsite-v1');
const path=require('node:path');
const VIRSH='/usr/bin/virsh', DUMP=offsite.CONF.dbBin, RESTIC=offsite.CONF.restic;
const DOMAINS=Object.keys(vm.DOMAINS);
function deny(ok,reason){if(!ok)throw Error(reason)}
function isDomain(s){return DOMAINS.includes(s)}
function exactArray(actual,expected){return Array.isArray(actual)&&actual.length===expected.length&&actual.every((x,i)=>x===expected[i])}
function validRun(s){deny(/^20[0-9]{6}T[0-9]{6}Z$/.test(s),'run_id_rejected');return s}
function insideFixedRoot(p){deny(typeof p==='string'&&path.posix.isAbsolute(p),'path_not_absolute');const root=vm.ROOT;deny(p.startsWith(root+'/')&&path.posix.normalize(p)===p,'path_outside_fixed_stage');return p}
function planOf(domain,runId){deny(isDomain(domain),'domain_not_allowlisted');validRun(runId);return {base:path.posix.join(vm.ROOT,runId),xml:path.posix.join(vm.ROOT,runId,'vm',domain,'backup.xml'),artifact:path.posix.join(vm.ROOT,runId,'vm',domain,'vda.qcow2')}}
function virshSpec(args,runId){
 deny(Array.isArray(args)&&args.every(x=>typeof x==='string'),'virsh_argv_invalid');
 const [op,domain,...other]=args;
 deny(isDomain(domain),'vm_domain_not_allowlisted');
 const p=planOf(domain,runId);
 const allowed=[
  ['domblklist',domain,'--details'],['domjobinfo',domain],['domjobinfo',domain,'--completed'],
  ['domstate',domain],['domfsfreeze',domain],['domfsthaw',domain],['backup-begin',domain,p.xml]
 ];
 deny(allowed.some(a=>exactArray(args,a)),'virsh_operation_rejected');
 return Object.freeze({bin:VIRSH,args:[...args],mutating:['domfsfreeze','domfsthaw','backup-begin'].includes(op)});
}
function dumpSpec(bin,args,runId,target,opts){
 deny(bin===DUMP,'dump_binary_rejected');
 const plan=offsite.sqlDumpPlan(validRun(runId));
 deny(exactArray(args,plan.args)&&target===plan.file,'dump_command_rejected');
 deny(opts?.owner==='root'&&opts?.mode===0o600&&opts?.noShell===true&&opts?.createExclusive===true,'dump_output_flags_rejected');
 insideFixedRoot(target);
 return Object.freeze({bin:DUMP,args:[...plan.args],target,mode:0o600,mutating:true});
}
function resticSpec(bin,args,runId,dbFile){
 deny(bin===RESTIC,'restic_binary_rejected');
 validRun(runId);const p=planOf('prhm-production',runId);
 const tag='node1-'+runId;
 const base=['--repo',offsite.CONF.remote,'--password-file',offsite.CONF.password];
 const choices=[
  [...base,'backup','--json','--tag',tag,'--one-file-system','/etc','/home','/usr/local/directadmin',path.posix.join(p.base,'vm'),dbFile],
  [...base,'snapshots','--json','--tag',tag],
  [...base,'check','--read-data-subset=10%']
 ];
 deny(Array.isArray(args)&&choices.some(a=>exactArray(args,a)),'restic_operation_rejected');
 deny(dbFile===offsite.sqlDumpPlan(runId).file,'restic_dump_path_rejected');
 return Object.freeze({bin:RESTIC,args:[...args],mutating:args.includes('backup')});
}
function makeRestrictedAdapter({approved,backend,runId}){
 // An in-memory marker is merely a secondary guard, NOT authorization.
 deny(approved?.verifiedBy==='PRHM-L4-host-action'&&approved?.action==='node1_backup_implementation_v1'&&
      approved?.level===4&&approved?.commitSha&&/^[a-f0-9]{40}$/.test(approved.commitSha),'execution_authority_missing');
 deny(backend&&['invoke','createOutput','artifact','exportToFile','secretFileValid','remoteIdentityVerified','runtimePreflight'].every(k=>typeof backend[k]==='function'),'backend_missing');
 validRun(runId);
 return Object.freeze({
  command(bin,args){deny(bin===VIRSH,'binary_not_allowlisted');return backend.invoke(virshSpec(args,runId))},
  createOutput(dir,xml,body){
    const domain=DOMAINS.find(d=>planOf(d,runId).xml===xml);
    deny(!!domain,'xml_path_not_allowlisted');
    const p=planOf(domain,runId);
    deny(dir===path.posix.dirname(xml),'xml_dir_rejected');
    deny(body===vm.makePlan(domain,runId,'file disk vda '+vm.DOMAINS[domain].source+'\n').body,'xml_content_rejected');
    return backend.createOutput({dir,xml,body,exclusive:true,mode:0o600,symlinks:false});
  },
  artifact(p){insideFixedRoot(p);deny(p.startsWith(planOf('prhm-production',runId).base+'/'),'artifact_wrong_run');return backend.artifact(p)},
  preflight(plan){deny(plan?.runId===runId && isDomain(plan?.domain),'preflight_scope_rejected');return backend.runtimePreflight(plan)},
  exportToFile(bin,args,target,opts){return backend.exportToFile(dumpSpec(bin,args,runId,target,opts))},
  secretFileValid(file){deny(file===offsite.CONF.password,'secret_path_rejected');return backend.secretFileValid(file)},
  remoteIdentityVerified(repo){deny(repo===offsite.CONF.remote,'remote_repo_rejected');return backend.remoteIdentityVerified(repo)},
  run(bin,args){return backend.invoke(resticSpec(bin,args,runId,offsite.sqlDumpPlan(runId).file))}
 });
}
module.exports={VIRSH,DUMP,RESTIC,DOMAINS,validRun,insideFixedRoot,planOf,virshSpec,dumpSpec,resticSpec,makeRestrictedAdapter};
