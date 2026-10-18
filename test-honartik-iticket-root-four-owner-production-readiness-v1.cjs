'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const p=require('./honartik-iticket-root-four-owner-production-readiness-v1.cjs');
const full='/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js';
function mockDirs(overrides={}){
  const paths=new Set(['/']);
  let d=path.dirname(full);
  while(d!=='/'){paths.add(d);d=path.dirname(d);}
  return f=>{
    if(!paths.has(f))throw Error('not found '+f);
    const props={uid:0,mode:0o40755};
    Object.assign(props,overrides[f]||{});
    return {uid:props.uid,mode:props.mode,
      isDirectory:()=>props.isDirectory!==false,
      isSymbolicLink:()=>props.isSymbolicLink===true};
  };
}
test('the exact four owners, SHA pins and approved postimages are immutable',()=>{
  assert.deepEqual(p.KEYS,['base','exec','policy','mcp']);
  assert.deepEqual(p.PRE,{
    base:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
    exec:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
    policy:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',
    mcp:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'
  });
  assert.deepEqual(p.POST,{
    base:'629212ae3052eab380ea1b3fc7c0b15395dfb23a251331762ebb781e1bbf1b2f',
    exec:'9dade5d2a9a9722c1dd1283a3a1002325da02e134804aca1ea6d673cf2de3e87',
    policy:'9a2c47db59211a638976ee181e8a5b246c79f082371d82a7396c6a07f646faa7',
    mcp:'52d3c0c04cd3bb26815403e2c089f9a408047bd9d376536ae570df669a7fd2a3'
  });
});
test('safe root-owned, nonwritable real parents accepted',()=>{
  assert.doesNotThrow(()=>p.inspectDirectoryChain('/',full,mockDirs()));
});
for(const [reason,overrides] of [
  ['symlink',{isSymbolicLink:true}],
  ['group write',{mode:0o40775}],
  ['world write',{mode:0o40757}],
  ['nonroot owner',{uid:1001}],
  ['not directory',{isDirectory:false}]
]){
  test('reject one untrusted directory in chain: '+reason,()=>{
    const src={'/home/agent':overrides};
    assert.throws(()=>p.inspectDirectoryChain('/',full,mockDirs(src)),
      /root_readiness_blocked_parent_untrusted_|root_readiness_blocked_parent_not_real_directory/);
  });
}
test('reject relative and noncanonical root owner path',()=>{
  assert.throws(()=>p.inspectDirectoryChain('/','home/agent/file',mockDirs()),/noncanonical_path/);
  assert.throws(()=>p.inspectDirectoryChain('/','/home/agent/../agent/file',mockDirs()),/noncanonical_path/);
});
test('reject missing IO adapter before attempts to read root',()=>{
  assert.throws(()=>p.audit(),/io_missing/);
  assert.throws(()=>p.audit({lstat:mockDirs()}),/io_missing/);
});
test('fail-closed if one root owner parent is writable by an untrusted user',()=>{
  const io={
    lstat:f=>mockDirs({'/home/agent':{uid:1000}})(f),
    readPinned:()=>{throw Error('must_not_read');}
  };
  assert.throws(()=>p.audit(io),/parent_untrusted_\/home\/agent/);
});
test('fail-closed on owner symlink instead of accepting earlier lstat alone',()=>{
  const io={
    lstat:f=>{
      if(f===p.OWNER.base)return {
        uid:0,mode:0o100644,nlink:1,isFile:()=>true,isSymbolicLink:()=>true
      };
      return {uid:0,mode:0o40755,isDirectory:()=>true,isSymbolicLink:()=>false};
    },
    readPinned:()=>{throw Error('must_not_read');}
  };
  assert.throws(()=>p.audit(io),/owner_untrusted_base/);
});
test('fail-closed on hardlinked file or nonroot owner',()=>{
  for(const delta of [{nlink:2},{uid:1000}]){
    const io={
      lstat:f=>f===p.OWNER.base?{
        uid:0,mode:0o100644,nlink:1,isFile:()=>true,isSymbolicLink:()=>false,
        ...delta
      }:{uid:0,mode:0o40755,isDirectory:()=>true,isSymbolicLink:()=>false},
      readPinned:()=>{throw Error('must_not_read');}
    };
    assert.throws(()=>p.audit(io),/owner_untrusted_base/);
  }
});
test('fail-closed if inode/fstat mismatch after opening pinned owner',()=>{
  const io={
    lstat:f=>f===p.OWNER.base?{
      dev:55,ino:12,uid:0,gid:0,mode:0o100644,nlink:1,
      isFile:()=>true,isSymbolicLink:()=>false
    }:{uid:0,mode:0o40755,isDirectory:()=>true,isSymbolicLink:()=>false},
    readPinned:()=>({bytes:Buffer.from('fake'),fstat:{dev:55,ino:13,uid:0,gid:0,mode:0o100644,nlink:1}})
  };
  assert.throws(()=>p.audit(io),/owner_race_or_invalid_descriptor_base/);
});
test('fake root owner bytes cannot masquerade as verified source',()=>{
  const io={
    lstat:f=>f===p.OWNER.base?{
      dev:55,ino:12,uid:0,gid:0,mode:0o100644,nlink:1,
      isFile:()=>true,isSymbolicLink:()=>false
    }:{uid:0,mode:0o40755,isDirectory:()=>true,isSymbolicLink:()=>false},
    readPinned:()=>({bytes:Buffer.from('fake'),
      fstat:{dev:55,ino:12,uid:0,gid:0,mode:0o100644,nlink:1}})
  };
  assert.throws(()=>p.audit(io),/owner_preimage_drift_base/);
});
test('descriptor fileReader rejects symlink and captures stable direct file metadata',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-readiness-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const normal=path.join(dir,'x'),symlink=path.join(dir,'link');
  fs.writeFileSync(normal,'read-only owner bytes');
  fs.symlinkSync(normal,symlink);
  const fd=p.fileReader();
  const st=fd.lstat(normal),v=fd.readPinned(normal,st);
  assert.equal(v.bytes.toString(),'read-only owner bytes');
  assert.equal(v.fstat.ino,st.ino);
  assert.throws(()=>fd.readPinned(symlink,fd.lstat(symlink)),/ELOOP/);
});
test('no privileged write, remote execution, approval or release methods are exposed',()=>{
  assert.deepEqual(Object.keys(p).sort(),[
    'KEYS','OWNER','PRE','POST','sha256','inspectDirectoryChain','audit','fileReader'
  ].sort());
  const src=fs.readFileSync(require.resolve('./honartik-iticket-root-four-owner-production-readiness-v1.cjs'),'utf8');
  for(const token of ["require('node:child_process')",'fs.writeFileSync(', 'fs.renameSync(',
    'fs.unlinkSync(', 'fs.mkdirSync(', 'systemctl', 'process.exec(', 'https.request('])
    assert.equal(src.includes(token),false,'forbidden write/exec '+token);
});
