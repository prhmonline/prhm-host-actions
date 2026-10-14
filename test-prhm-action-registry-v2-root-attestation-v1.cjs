'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const P=require('./prhm-action-registry-v2-root-attestation-v1.cjs');
const M=require('./manifests/honartik-shared-registry-v2-reviewed-runtime-stage-v1.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const blob=b=>crypto.createHash('sha1')
 .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const FILE='/opt/trusted/one.js';
function fixture(data=Buffer.from('immutable Git bytes'),change={}){
 const parent={isDirectory:()=>true,isSymbolicLink:()=>false,
  uid:change.parentUid??0,mode:change.parentMode??0o40700};
 const file={isFile:()=>true,isSymbolicLink:()=>false,
  size:data.length,uid:change.uid??0,gid:0,
  dev:1,ino:5,mode:change.mode??0o100600};
 let opens=0,closes=0;
 const io={
  lstatSync:p=>p==='/opt/trusted'?parent:file,
  realpathSync:p=>p,
  openSync:()=>{opens++;return 55},
  fstatSync:()=>({...file,...change.fd}),
  readFileSync:()=>data,
  closeSync:()=>{closes++}
 };
 return {io,opens:()=>opens,closes:()=>closes};
}
test('the manifest contains exactly 20 immutable unambiguous staged git blob pins',()=>{
 assert.equal(P.validatePinnedClosure(),true);
 assert.equal(M.files.length,20);
 assert.equal(M.destination_root,P.ROOT);
 assert.deepEqual(P.OWNER_KEYS,['base','executor','policy','mcp']);
 assert.equal(M.installation_authorized,false);
 assert.equal(M.status,'NOT_STAGED');
});
test('root read-only reader verifies exact SHA256 and git blob as an O_NOFOLLOW fd',()=>{
 const bytes=Buffer.from('verified bytes');
 const f=fixture(bytes);
 const got=P.secureRead(f.io,FILE,{
  expectedSha256:sha(bytes),expectedGitBlob:blob(bytes)});
 assert.deepEqual(got,bytes);
 assert.equal(f.opens(),1);
 assert.equal(f.closes(),1);
});
test('SHA-256 owner drift and git blob tampering both fail closed',()=>{
 const f=fixture();
 assert.throws(()=>P.secureRead(f.io,FILE,{expectedSha256:'0'.repeat(64)}),
  /expected_sha256_mismatch/);
 assert.throws(()=>P.secureRead(f.io,FILE,{expectedGitBlob:'0'.repeat(40)}),
  /expected_git_blob_mismatch/);
 assert.equal(f.opens(),2);assert.equal(f.closes(),2);
});
test('unsafe parent, root UID mismatch and group-writable staged source rejected before read',()=>{
 for(const opt of [
  {parentUid:1000},{parentMode:0o40777},{uid:1000},{mode:0o100666}
 ]){
  const f=fixture(Buffer.from('safe bytes'),opt);
  assert.throws(()=>P.secureRead(f.io,FILE,{
   rootParent:true}),/parent_not_trusted|file_ownership_or_mode_or_size_untrusted/);
  assert.equal(f.opens(),0);
 }
});
test('TOCTOU inode replacement fails even when content and SHA match',()=>{
 const f=fixture(Buffer.from('same original bytes'),{fd:{ino:666}});
 assert.throws(()=>P.secureRead(f.io,FILE),/fd_race_or_metadata_drift/);
 assert.equal(f.opens(),1);assert.equal(f.closes(),1);
});
test('invalid paths, symlinks and strange parents never read protected files',()=>{
 const f=fixture();
 for(const file of ['/tmp/../opt/trusted/one.js','/tmp//x','relative.js']){
  assert.throws(()=>P.secureRead(f.io,file),
   /noncanonical_path/);
 }
});
test('full root attestation fails before reading a single file outside root',()=>{
 const f=fixture();
 assert.throws(()=>P.inspect({io:f.io,getuid:()=>1000}),/root_only/);
 assert.equal(f.opens(),0);
});
test('synthetic or unstaged runtime cannot be confused with live installed sidecar',()=>{
 let firstPath;
 const io={
  lstatSync:p=>{firstPath=p;const err=Error('ENOENT');err.code='ENOENT';throw err;}
 };
 assert.throws(()=>P.inspect({io,getuid:()=>0}),/ENOENT/);
 assert.equal(firstPath,'/opt/prhm-agent-selfmaint');
});
test('root attestation does not expose install, shell, approval or signing capabilities',()=>{
 for(const name of ['apply','install','start','request','approve','consume',
 'execute','runShell','writeFile','sign','rollback','deploy']){
  assert.equal(Object.hasOwn(P,name),false);
 }
 const source=fs.readFileSync('./prhm-action-registry-v2-root-attestation-v1.cjs','utf8');
 assert.equal(source.includes("spawnSync("),false);
 assert.equal(source.includes("execFileSync("),false);
});
