'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const registry=require('./drtarjomeh-incident47-runtime-registration-v1.js');

const prior="const HOST_ACTION_V2_SPECS = Object.freeze({\n  original_v1:{operation:'host_action.original_v1'}\n});\nasync function applyHostActionV2(action){const spec=hostActionV2Spec(action);if(action==='original_v1')return old();}";
const target='/opt/prhm-agent-selfmaint-exec/actions/drtarjomeh-incident47-reviewed-host-runner-v1.js';
const runnerSha='645d4f7f8946b1ed6a841bbae182a08ccea273e7';
function blob(bytes){
  return crypto.createHash('sha1').update(Buffer.concat([
    Buffer.from('blob '+bytes.length+'\0'),bytes
  ])).digest('hex');
}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'drt-i47-js-toctou-'));
  const file=path.join(dir,'verified-runner.js');
  const marker=path.join(dir,'ATTACKER-WOULD-EXECUTE');
  const checked=Buffer.from(
    "// Reviewed stand-in is NEVER a live host runner. "+'x'.repeat(90)+"\n"+
    "module.exports={runAfterTrustedApproval:()=>({kind:'VERIFIED_BYTES'})};\n"
  );
  const malicious=Buffer.from(
    "require('node:fs').writeFileSync("+JSON.stringify(marker)+",'executed');"+
    "module.exports={runAfterTrustedApproval:()=>({kind:'SWAPPED_DISK_BYTES'})};\n"
  );
  fs.writeFileSync(file,checked,{mode:0o600});
  const generated=registry.executorTransform(prior);
  const start=generated.indexOf('function applyDrtI47GuardAfterTrustedApproval(){');
  const end=generated.indexOf('async function applyHostActionV2(action)',start);
  assert.ok(start>=0&&end>start,'exact generated dispatcher function');
  const fn=generated.slice(start,end)
    .replaceAll(target,file)
    .replaceAll(runnerSha,blob(checked));
  const load=(io)=>new Function('fs','require','module',fn+';return applyDrtI47GuardAfterTrustedApproval;')(
    io,require,module);
  const base={
    constants:fs.constants,
    openSync:fs.openSync.bind(fs),
    fstatSync:(fd)=>Object.assign(Object.create(fs.fstatSync(fd)),{uid:0}),
    readFileSync:fs.readFileSync.bind(fs),
    closeSync:fs.closeSync.bind(fs)
  };
  return {dir,file,marker,checked,malicious,fn,load,base,
    cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('generated dispatcher compiles the approved runner without a second require(path)',()=>{
  const x=fixture();
  try{
    assert.doesNotMatch(x.fn,/require\(\s*(?:path|['"]\/opt\/prhm-agent-selfmaint-exec\/actions)/);
    assert.match(x.fn,/O_NOFOLLOW/);
    assert.match(x.fn,/loaded\._compile\(bytes\.toString/);
    assert.deepEqual(x.load(x.base)(),{kind:'VERIFIED_BYTES'});
  }finally{x.cleanup();}
});
test('mutable path swapped immediately after fd read cannot change executed bytes',()=>{
  const x=fixture();
  try{
    const io={...x.base,readFileSync:fd=>{
      const verified=fs.readFileSync(fd);
      fs.writeFileSync(x.file,x.malicious);
      return verified;
    }};
    assert.deepEqual(x.load(io)(),{kind:'VERIFIED_BYTES'});
    assert.equal(fs.existsSync(x.marker),false);
    assert.ok(fs.readFileSync(x.file).equals(x.malicious),
      'the disk file really was swapped after the read');
  }finally{x.cleanup();}
});
test('unreviewed source cannot be executed even if it has a runAfterTrustedApproval export',()=>{
  const x=fixture();
  try{
    fs.writeFileSync(x.file,x.malicious);
    assert.throws(()=>x.load(x.base)(),/drt_i47_runner_source_mismatch/);
    assert.equal(fs.existsSync(x.marker),false);
  }finally{x.cleanup();}
});
test('symlink runner target is rejected instead of followed',()=>{
  const x=fixture();
  try{
    const other=x.file+'.regular';
    fs.renameSync(x.file,other);
    fs.symlinkSync(other,x.file);
    assert.throws(()=>x.load(x.base)(),/ELOOP/);
  }finally{x.cleanup();}
});
test('unsafe owner or writable file is rejected before execution',()=>{
  const x=fixture();
  try{
    const wrongOwner={...x.base,fstatSync:fd=>Object.assign(Object.create(fs.fstatSync(fd)),{uid:1001})};
    assert.throws(()=>x.load(wrongOwner)(),/runner_file_unsafe/);
    const groupWritable={...x.base,fstatSync:fd=>Object.assign(Object.create(fs.fstatSync(fd)),{uid:0,mode:0o100664})};
    assert.throws(()=>x.load(groupWritable)(),/runner_file_unsafe/);
  }finally{x.cleanup();}
});
test('reviewed runner is not invoked unless the existing signed v2 dispatcher calls it',()=>{
  const transformed=registry.executorTransform(prior);
  assert.match(transformed,/if\(action==='drtarjomeh_incident47_uploads_guard_install_v1'\)return applyDrtI47GuardAfterTrustedApproval\(\)/);
  assert.doesNotMatch(transformed,/global\.|process\.argv|require\(['"]\/opt\/prhm-agent-selfmaint-exec\/actions\/drtarjomeh-incident47/);
});
