'use strict';
// Pure topology decision: labels storage on the parent hypervisor LOCAL_REDUNDANCY,
// never "independent offsite". The mere presence of a second hostname/IP is NOT proof.
const sameMac=(a,b)=>typeof a==='string'&&typeof b==='string'&&
  /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(a)&&a.toLowerCase()===b.toLowerCase();
const sameIp=(a,b)=>typeof a==='string'&&typeof b==='string'&&
  a.split('/')[0]===b.split('/')[0]&&/^\d{1,3}(\.\d{1,3}){3}$/.test(a.split('/')[0]);
function classify({guestHost,guestVirt,guestIp,guestMac,hypervisorDomain,domainState,
                    domainIp,domainMac,hypervisorDisk,repositoryHost,independentRestore}={}){
 const observed=guestHost==='prhm-production.prhm.ir'&&guestVirt==='kvm'&&
   hypervisorDomain==='prhm-production'&&domainState==='running'&&
   sameIp(guestIp,domainIp)&&sameMac(guestMac,domainMac)&&
   hypervisorDisk==='/var/lib/libvirt/images/prhm-production.qcow2'&&
   repositoryHost==='server1.prhm.ir';
 if(observed)return Object.freeze({
  status:'SAME_PHYSICAL_FAILURE_DOMAIN_CONFIRMED',
  remote_replica_has_value:true,independent_physical_offsite:false,
  explanation:'KVM guest backup is stored on its own libvirt host disk',
  independent_restore_proven:independentRestore===true,
  operational_action:'PRESERVE_NODE1_COPY_AND_REQUIRE_ANOTHER_INDEPENDENT_DESTINATION'
 });
 return Object.freeze({status:'TOPOLOGY_NOT_PROVEN',remote_replica_has_value:true,
  independent_physical_offsite:false,explanation:'insufficient matching guest/hypervisor evidence',
  independent_restore_proven:independentRestore===true,
  operational_action:'DO_NOT_ASSERT_OFFSITE_INDEPENDENCE'});
}
module.exports={classify,sameMac,sameIp};
