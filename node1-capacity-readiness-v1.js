'use strict';
// Pure release-planning gate. This is not a runtime authorization token.
// No OS APIs, SSH, cloud credentials, or production mutations.
const vm=require('./node1-live-vm-backup-v1');
const GIB=1024**3;
const REQUIRED_DOMAINS=Object.freeze(Object.keys(vm.DOMAINS).sort());
const CHECKS=Object.freeze([
  'virtual_geometry_verified','libvirt_push_backup_supported',
  'guest_agent_both_verified','qemu_output_access_verified',
  'selinux_runtime_context_verified','mariadb_inventory_complete',
  'database_consistency_plan_verified','restic_installed','rclone_installed',
  'dedicated_oauth_client_verified','encrypted_repository_verified',
  'offsite_credentials_verified','independent_restore_runtime_verified'
]);
const isInteger=x=>Number.isSafeInteger(x)&&x>=0;
function assess({freeBytes,dbStagingBytes,vmDisks,checks={}}={}){
 const missing=[];
 if(!isInteger(freeBytes)||freeBytes===0)missing.push('free_capacity_unverified');
 if(!isInteger(dbStagingBytes)||dbStagingBytes===0)missing.push('database_staging_estimate_unverified');
 if(!vmDisks||typeof vmDisks!=='object'||Array.isArray(vmDisks)||
    Object.keys(vmDisks).sort().join('|')!==REQUIRED_DOMAINS.join('|'))missing.push('vm_inventory_incomplete');
 let totalVirtual=0;
 for(const domain of REQUIRED_DOMAINS){
   const x=vmDisks?.[domain];
   if(!x||x.source!==vm.DOMAINS[domain].source||
     !Number.isSafeInteger(x.virtualBytes)||x.virtualBytes<=0||
     !Number.isSafeInteger(x.physicalBytes)||x.physicalBytes<=0||
     x.geometrySource!=='qemu-img-info'){
      missing.push('vm_geometry_unverified:'+domain);
      continue;
   }
   totalVirtual+=x.virtualBytes;
   if(!Number.isSafeInteger(totalVirtual))missing.push('vm_geometry_overflow');
 }
 for(const k of CHECKS)if(checks[k]!==true)missing.push('runtime_requirement_missing:'+k);
 let capacity;
 if(missing.every(x=>!x.startsWith('vm_geometry_'))&&isInteger(freeBytes)&&freeBytes>0&&
    isInteger(dbStagingBytes)&&dbStagingBytes>0){
   // Treat all VM backups as concurrently retained. Account for metadata,
   // DB staging, +20% transient growth and a hard 80 GiB safety reserve.
   const dataBudget=totalVirtual+dbStagingBytes;
   const requiredBytes=Math.ceil(dataBudget*1.2)+80*GIB;
   if(!Number.isSafeInteger(dataBudget)||!Number.isSafeInteger(requiredBytes)){
     missing.push('capacity_arithmetic_overflow');
   } else {
     capacity=Object.freeze({freeBytes,requiredBytes,virtualVmBytes:totalVirtual,
       dbStagingBytes,reserveBytes:80*GIB,headroomBytes:freeBytes-requiredBytes});
     if(freeBytes<requiredBytes)missing.push('aggregate_staging_capacity_insufficient');
   }
 }else missing.push('aggregate_capacity_not_provable');
 return Object.freeze({schema_version:'prhm.node1-capacity-and-readiness.v1',
  approved_for_production:false,all_static_gates_pass:missing.length===0,
  missing:Object.freeze([...new Set(missing)]),capacity:capacity||null,
  requires_independent_level4_approval:true,requires_signed_restore_evidence:true});
}
module.exports={GIB,REQUIRED_DOMAINS,CHECKS,assess};
