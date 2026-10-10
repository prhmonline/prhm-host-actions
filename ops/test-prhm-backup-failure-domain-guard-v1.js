'use strict';
const test=require('node:test'),a=require('node:assert/strict');
const {classify}=require('./prhm-backup-failure-domain-guard-v1.js');
const real={guestHost:'prhm-production.prhm.ir',guestVirt:'kvm',guestIp:'10.71.0.118/24',guestMac:'52:54:00:71:00:13',hypervisorDomain:'prhm-production',domainState:'running',domainIp:'10.71.0.118/24',domainMac:'52:54:00:71:00:13',hypervisorDisk:'/var/lib/libvirt/images/prhm-production.qcow2',repositoryHost:'server1.prhm.ir',independentRestore:true};
test('live-proven guest/hypervisor matching MAC and IP means SAME physical failure domain',()=>{const x=classify(real);a.equal(x.status,'SAME_PHYSICAL_FAILURE_DOMAIN_CONFIRMED');a.equal(x.independent_physical_offsite,false);a.equal(x.independent_restore_proven,true)});
test('different MAC or IP cannot claim separate physical backup',()=>{a.equal(classify({...real,domainMac:'52:54:00:71:00:14'}).independent_physical_offsite,false);a.equal(classify({...real,domainIp:'10.71.0.119/24'}).independent_physical_offsite,false)});
test('missing or ambiguous hypervisor evidence fails closed',()=>{const x=classify({repositoryHost:'server1.prhm.ir'});a.equal(x.status,'TOPOLOGY_NOT_PROVEN');a.equal(x.independent_physical_offsite,false)});
test('even clean backup and confirmed restore cannot change storage failure-domain classification',()=>{a.equal(classify({...real,independentRestore:true}).independent_physical_offsite,false)});
