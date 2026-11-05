'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const unit=require('./prhm-action-registry-v2-sidecar-unit-review-v1.cjs');
const SOCKET=require('./prhm-action-registry-v2-isolated-socket-v1.cjs');
const TEXT=fs.readFileSync(path.join(__dirname,unit.SOURCE));
function ioFor({fileSymlink=false,otherOwner=false,parentWritable=false,
  changeInode=false,truncated=false}={}){
 const fd=8;
 const parent={uid:0,gid:0,ino:4,dev:2,mode:0o40755,
  isDirectory:()=>true,isSymbolicLink:()=>false};
 const before={uid:otherOwner?1001:0,gid:0,ino:5,dev:2,
  mode:0o100644,size:TEXT.length,
  isFile:()=>true,isSymbolicLink:()=>fileSymlink};
 const after={...before,ino:changeInode?6:5};
 const operations=[];
 const io={
  lstatSync:(p)=>{
   operations.push(['stat',p]);
   if(p==='/etc/systemd/system')return parentWritable?
    {...parent,mode:0o40777}:parent;
   assert.equal(p,unit.DEST);return before;
  },
  realpathSync:p=>p,
  openSync:(p,flags)=>{
   assert.equal(p,unit.DEST);
   assert.ok(flags&fs.constants.O_NOFOLLOW);
   assert.equal(flags&fs.constants.O_CREAT,0);
   operations.push(['open',p]);return fd
  },
  fstatSync:n=>{assert.equal(n,fd);return after},
  readFileSync:n=>{assert.equal(n,fd);return truncated?TEXT.subarray(0,-10):TEXT},
  closeSync:n=>{assert.equal(n,fd);operations.push(['close',n])}
 };
 return {io,operations};
}
test('review exact Git blob with pinned systemd root-only sandbox and no install authority',()=>{
 const report=unit.review(TEXT);
 assert.equal(report.unit,SOCKET.UNIT);
 assert.equal(report.review_passed,true);
 assert.equal(report.host_installed,false);
 assert.equal(report.installation_authorized,false);
 assert.equal(report.production_mutation,false);
 assert.equal(report.blockers.length,4);
 assert.ok(TEXT.includes(Buffer.from('ReadWritePaths=/run/prhm-shared-registry-v2 /var/lib/prhm-agent-selfmaint-exec/registry-approval-v2')));
 assert.ok(TEXT.includes(Buffer.from('RuntimeDirectoryMode=0700')));
 assert.ok(TEXT.includes(Buffer.from('ProtectSystem=strict')));
 assert.ok(TEXT.includes(Buffer.from('CapabilityBoundingSet=CAP_DAC_READ_SEARCH')));
 assert.ok(!TEXT.toString('utf8').split('\n').some(line=>line.trim()==='[Install]'));
 assert.ok(!TEXT.includes(Buffer.from('ExecStartPre=')));
 assert.ok(!TEXT.includes(Buffer.from('/bin/sh')));
});
test('read-only installed-unit inspection validates exact Git content via no-follow fd',()=>{
 const {io,operations}=ioFor();
 const result=unit.inspectInstalled({io,getuid:()=>0});
 assert.equal(result.review_passed,true);
 assert.equal(result.host_installed,true);
 assert.equal(result.installation_authorized,false);
 assert.ok(operations.some(x=>x[0]==='open'));
 assert.ok(operations.some(x=>x[0]==='close'));
 assert.equal(operations.filter(x=>x[0]==='write').length,0);
});
test('reject altered bytes, permissions, parent, symlink, FD swap and truncated read',()=>{
 for(const b of [
  Buffer.from(TEXT.toString('utf8').replace('ProtectSystem=strict','ProtectSystem=full')),
  Buffer.from(TEXT.toString('utf8').replace('ReadWritePaths=','ReadWritePaths=/ ')),
  Buffer.from(TEXT.toString('utf8')+'[Install]\nWantedBy=multi-user.target\n'),
  Buffer.from(TEXT.toString('utf8').replace('RuntimeDirectoryMode=0700','RuntimeDirectoryMode=0777'))
 ]){
  assert.throws(()=>unit.review(b),/git_blob_sha_mismatch/);
 }
 for(const opts of [
  {fileSymlink:true},{otherOwner:true},{parentWritable:true},
  {changeInode:true},{truncated:true}
 ])assert.throws(()=>unit.inspectInstalled({io:ioFor(opts).io,getuid:()=>0}),
  /unsafe|race|short_read/);
 assert.throws(()=>unit.inspectInstalled({io:ioFor().io,getuid:()=>1000}),
  /root_required/);
});
test('review module cannot issue or consume a token, install a unit or execute commands',()=>{
 assert.deepEqual(Object.keys(unit).sort(),
  ['SOURCE','DEST','REVIEWED_BLOB','NO_GO','review','inspectInstalled'].sort());
 assert.deepEqual(unit.NO_GO,[
  'NO_SIGNED_FIVE_FIELD_BOOTSTRAP_INSTALLED',
  'NO_VERIFIED_HOST_PRIVATE_LEDGER_ACCESS',
  'NO_SIGNED_INDEPENDENT_ROOT_LAUNCHER',
  'NO_ROOT_DURABLE_RECOVERY_AND_DUAL_MCP_DISCOVERY'
 ]);
});
