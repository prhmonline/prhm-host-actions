'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const path=require('node:path');
const audit=require('../ops/agent3-universal-backup/private-owner-archive-audit.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(){
 const keys=['base','executor','policy','mcp'];
 const ownerBlobs=Object.fromEntries(keys.map(k=>[k,Buffer.from('ISOLATED-FIXTURE-ONLY:'+k)]));
 const spec=keys.map(k=>({key:k,name:'fixture/'+k+'.txt',sha:sha(ownerBlobs[k])}));
 return {ownerBlobs,spec,names:spec.map(x=>x.name)};
}
test('synthetic four-owner member set verifies only matching local fixture bytes',()=>{
 const f=fixture();
 assert.equal(audit.verifyMemberSet(f.names,f.ownerBlobs,f.spec),true);
 assert.throws(()=>audit.checkOwnerBlobs(f.names,f.ownerBlobs),
   /archive_member_set_drift/);
});
test('wrong list, duplicates, traversal and missing owners all fail closed',()=>{
 const f=fixture();
 for(const names of [
  f.names.slice(1),[...f.names,f.names[0]],
  [f.names[0],f.names[0],f.names[2],f.names[3]],
  ['../../escape',...f.names.slice(1)],
  f.names.map(x=>x.replace('fixture/','other/'))
 ]){
  assert.throws(()=>audit.verifyMemberSet(names,f.ownerBlobs,f.spec),
   /agent3_private_archive_audit_denied/);
 }
 for(const wrong of [
  {...f.ownerBlobs,extra:Buffer.from('extra')},
  Object.fromEntries(Object.entries(f.ownerBlobs).slice(1)),
  {...f.ownerBlobs,mcp:'not_buffer'},
  {...f.ownerBlobs,executor:Buffer.alloc(0)}
 ]){
  assert.throws(()=>audit.verifyMemberSet(f.names,wrong,f.spec),
   /agent3_private_archive_audit_denied/);
 }
});
test('byte-for-byte digest drift cannot be accepted as a success',()=>{
 const f=fixture();
 for(const k of ['base','executor','policy','mcp']){
  assert.throws(()=>audit.verifyMemberSet(f.names,{
    ...f.ownerBlobs,[k]:Buffer.from('MODIFIED')
   },f.spec),/member_hash_mismatch/);
 }
});
test('archive destination and four owner names are immutable and rooted',()=>{
 assert.equal(audit.ARCHIVE,'/root/agent3-owner-sources-review.tar.gz');
 assert.equal(audit.ARCHIVE_SHA,
  'ba591af9c53eb3f01ee78e347faba54dad9bf20edd2d49833b77449f25c108a6');
 assert.deepEqual(audit.MEMBERS.map(x=>x.name),[
  'opt/prhm-agent-selfmaint/server.js',
  'opt/prhm-agent-selfmaint-exec/server.js',
  'opt/prhm-company-control-plane/config/approval-policy.json',
  'home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'
 ]);
 assert.equal(new Set(audit.MEMBERS.map(x=>x.sha)).size,4);
 assert.equal(audit.MEMBERS.every(x=>/^[0-9a-f]{64}$/.test(x.sha)),true);
});
test('no arbitrary CLI, source export, approval or production execution authority',()=>{
 const filename=path.join(__dirname,'../ops/agent3-universal-backup/private-owner-archive-audit.cjs');
 const run=cp.spawnSync(process.execPath,[filename,'--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(run.status,64);
 assert.match(run.stderr,/read-only --check only/);
 assert.equal(run.stdout,'');
 for(const key of ['install','apply','approve','register','exportArchive','writeOwner']){
  assert.equal(Object.hasOwn(audit,key),false,key);
 }
});
