'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const m=require('./node1-db-offsite-v1');
const id='20261008T151000Z',h='a'.repeat(64),snapshot='b'.repeat(64),tag='node1-'+id;
const vmEvidence=Object.freeze([
  {domain:'prhm-production',runId:id,status:'vm_disk_backup_captured',artifact:'/var/lib/prhm-backup/node1/staging/'+id+'/vm/prhm-production/vda.qcow2',bytes:100,sha256:h},
  {domain:'imotion-directadmin',runId:id,status:'vm_disk_backup_captured',artifact:'/var/lib/prhm-backup/node1/staging/'+id+'/vm/imotion-directadmin/vda.qcow2',bytes:100,sha256:h}
]);
function db(){return {runId:id,file:m.sqlDumpPlan(id).file,bytes:12345,sha256:h,mode:0o600}}
function stub(){
  const calls=[];
  return {
    calls,
    adapter:{
      secretFileValid:()=>true,
      remoteIdentityVerified:()=>true,
      run(bin,args){
        calls.push({bin,args});const op=args.find(x=>x==='backup'||x==='snapshots'||x==='check');
        if(op==='backup')return JSON.stringify({message_type:'summary',snapshot_id:snapshot})+'\n';
        if(op==='snapshots')return JSON.stringify([{id:snapshot,tags:[tag]}]);
        if(op==='check')return 'no errors were found\n';
      }
    }
  };
}
test('MariaDB dump plan is fixed, credential-safe, transactional',()=>{
 const p=m.sqlDumpPlan(id);
 assert.equal(p.bin,'/usr/bin/mariadb-dump');
 assert.equal(p.args[0],'--defaults-extra-file=/etc/prhm-backup/node1-mariadb.cnf');
 assert(p.args.includes('--single-transaction'));
 assert(p.args.includes('--all-databases'));
 assert(p.args.includes('--routines'));
 assert(!p.args.some(x=>x.includes('password=')));
});
test('MariaDB export asks for exclusive root-owned file and cannot overclaim SQL replay',()=>{
 let options;
 const adapter={exportToFile(_bin,_args,_file,o){options=o},artifact(){return{regular:true,symlink:false,mode:0o600,bytes:100,sha256:h}}};
 const r=m.exportMariaDb(id,adapter);
 assert.equal(options.noShell,true);
 assert.equal(options.createExclusive,true);
 assert.equal(r.sql_replay_verified,false);
 assert.equal(r.nontransactional_tables_consistency_verified,false);
});
test('bad dump artifact permissions or symlink fails closed',()=>{
 assert.throws(()=>m.objectEvidence({regular:true,symlink:false,mode:0o644,bytes:1,sha256:h},'database'),/unsafe_database_permissions/);
 assert.throws(()=>m.objectEvidence({regular:true,symlink:true,mode:0o600,bytes:1,sha256:h},'database'),/invalid_database_artifact/);
});
test('offsite uses restic encryption and checks exact remote snapshot',()=>{
 const x=stub();
 const r=m.encryptedOffsite(id,vmEvidence,db(),x.adapter);
 assert.equal(r.snapshotId,snapshot);
 assert.equal(r.remote_snapshot_confirmed,true);
 assert.equal(r.full_integrity_verified,false);
 assert.equal(r.sql_replay_verified,false);
 assert.equal(x.calls.length,3);
 assert(x.calls[0].args.includes('--password-file'));
 assert(x.calls[0].args.includes('/usr/local/directadmin'));
 assert(x.calls[0].args.some(a=>a.endsWith('all-databases.sql')));
 assert(x.calls[2].args.includes('--read-data-subset=10%'));
});
test('offsite blocks incomplete VM set',()=>{
 const x=stub();
 assert.throws(()=>m.encryptedOffsite(id,vmEvidence.slice(0,1),db(),x.adapter),/vm_backup_set_incomplete/);
 assert.equal(x.calls.length,0);
});
test('offsite blocks lack of verified encryption secret',()=>{
 const x=stub();x.adapter.secretFileValid=()=>false;
 assert.throws(()=>m.encryptedOffsite(id,vmEvidence,db(),x.adapter),/restic_secret_not_secure/);
 assert.equal(x.calls.length,0);
});
test('offsite refuses mismatched remote snapshot tag',()=>{
 const x=stub();x.adapter.run=(bin,args)=>{
   if(args.includes('backup'))return JSON.stringify({message_type:'summary',snapshot_id:snapshot});
   if(args.includes('snapshots'))return JSON.stringify([{id:snapshot,tags:['other']}]);
   return '';
 };
 assert.throws(()=>m.encryptedOffsite(id,vmEvidence,db(),x.adapter),/remote_snapshot_not_confirmed/);
});
test('closure is denied until independent SQL and boot restores pass',()=>{
 const x=m.closureGate({backup_pass:true,offsite_pass:true});
 assert.equal(x.ok,false);
 assert(x.missing.includes('sql_replay_verified'));
 assert(x.missing.includes('vm_boot_restore_verified'));
 assert(x.missing.includes('offsite_full_integrity_verified'));
 assert.equal(m.closureGate(Object.fromEntries(['backup_pass','offsite_pass','restore_pass','central_capacity_preflight_pass','sql_replay_verified','vm_boot_restore_verified','offsite_full_integrity_verified','closed'].map(k=>[k,true]))).ok,true);
});
test('source does not use shell, SSH, raw credentials, mutation-on-import',()=>{
 const text=fs.readFileSync(require.resolve('./node1-db-offsite-v1'),'utf8');
 assert.doesNotMatch(text,/shell:\s*true|\bexecSync\s*\(|\bssh\b|--password=|systemctl start/);
});
