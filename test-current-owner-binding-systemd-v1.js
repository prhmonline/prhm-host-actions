'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const s=require('./current-owner-binding-systemd-v1.js');

test('constants are exact and never broaden /var/backups',()=>{
 assert.equal(s.SERVICE,'prhm-agent-selfmaint-exec.service');
 assert.equal(s.DROPIN,'/etc/systemd/system/prhm-agent-selfmaint-exec.service.d/current-baseline-backup-rw.conf');
 assert.equal(s.BACKUP_ROOT,'/var/backups/prhm-current-baseline-refresh-v1');
 assert.equal(s.DROPIN_CONTENT,'[Service]\nReadWritePaths=/var/backups/prhm-current-baseline-refresh-v1\n');
 assert.doesNotMatch(s.DROPIN_CONTENT,/ReadWritePaths=\/var\/backups(?:\n|$)/);
 assert.deepEqual(s.RESTART_UNITS,['prhm-agent-selfmaint-exec.service']);
});

test('absent drop-in plans create and exact drop-in is unchanged',()=>{
 assert.deepEqual(s.planDropin({exists:false}),{state:'create',content:s.DROPIN_CONTENT});
 assert.deepEqual(s.planDropin({exists:true,is_file:true,is_symlink:false,realpath:s.DROPIN,content:s.DROPIN_CONTENT}),{state:'unchanged',content:s.DROPIN_CONTENT});
});

test('differing or unsafe existing drop-in fails closed',()=>{
 assert.throws(()=>s.planDropin({exists:true,is_file:true,is_symlink:false,realpath:s.DROPIN,content:'[Service]\nReadWritePaths=/var/backups\n'}),/dropin_preimage_drift/);
 assert.throws(()=>s.planDropin({exists:true,is_file:true,is_symlink:true,realpath:s.DROPIN,content:s.DROPIN_CONTENT}),/dropin_not_regular/);
 assert.throws(()=>s.planDropin({exists:true,is_file:true,is_symlink:false,realpath:'/tmp/escape',content:s.DROPIN_CONTENT}),/dropin_noncanonical/);
});

test('effective state requires active service, nonzero pid, exact writable path, and preserved hardening',()=>{
 const good={active_state:'active',main_pid:123,read_write_paths:['/etc/systemd/system/prhm-agent-api.service.d',s.BACKUP_ROOT],protect_system:'strict',protect_home:'yes'};
 assert.equal(s.validateEffectiveState(good),true);
 for(const bad of [
  {...good,active_state:'failed'},
  {...good,main_pid:0},
  {...good,read_write_paths:['/etc/systemd/system/prhm-agent-api.service.d']},
  {...good,protect_system:'full'},
  {...good,protect_home:'no'},
 ]) assert.throws(()=>s.validateEffectiveState(bad),/effective_/);
});
