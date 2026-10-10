'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const runner=require('./drtarjomeh-incident47-reviewed-host-runner-v1.js');
const registry=require('./drtarjomeh-incident47-runtime-registration-v1.js');
function gitBlob(bytes){
  return crypto.createHash('sha1').update(Buffer.concat([
    Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'incident47-python-review-'));
  const p=path.join(dir,'incident47-host-guard-v1.py');
  const q=path.join(dir,'apache-wp-uploads-exec-deny-v1.conf');
  const marker=path.join(dir,'must-not-execute.marker');
  const source=Buffer.from([
    'from pathlib import Path',
    'POLICY=Path(__file__).with_name("apache-wp-uploads-exec-deny-v1.conf")',
    'def read_exact_regular(path):',
    '    return path.read_bytes(),None',
    'def preflight(commit):',
    '    policy,_=read_exact_regular(POLICY)',
    '    return policy,{"reviewed":{}}',
    'def install_guard(policy,commit,evidence):',
    '    return {"source_sha":commit,"status":"GUARD_APPLIED_AND_NEGATIVE_TEST_PASS",',
    '            "destination":"/etc/httpd/conf.d/95-drt-wordpress-uploads-deny.conf",',
    '            "evidence":evidence}',
    ''
  ].join('\n'));
  const conf=Buffer.from('# Incident #47 fixed policy fixture\n<Directory "/reviewed">\nRequire all denied\n</Directory>\n');
  fs.writeFileSync(p,source);fs.writeFileSync(q,conf);
  const t=runner.INVOKE_PYTHON;
  assert.ok(t.includes(runner.SCRIPT));
  assert.ok(t.includes('4f532f6a1b58d80d4010002b954fe13eaaecb420'));
  assert.ok(t.includes('5adb676a1f9b7e3aa295f469a39071cfc1d1a6f5'));
  const invoke=t.replaceAll(runner.SCRIPT,p)
    .replace("source_blob='4f532f6a1b58d80d4010002b954fe13eaaecb420'",
      "source_blob='"+gitBlob(source)+"'")
    .replace("policy_blob='5adb676a1f9b7e3aa295f469a39071cfc1d1a6f5'",
      "policy_blob='"+gitBlob(conf)+"'");
  const run=()=>cp.spawnSync('python3',['-c',invoke],{
    encoding:'utf8',timeout:4000,maxBuffer:65536,env:{PATH:process.env.PATH||'/usr/bin:/bin'}});
  return {p,q,marker,source,conf,run,clean:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('reviewed runner source matches registry pinned Git blob',()=>{
  const contents=fs.readFileSync(path.join(__dirname,'drtarjomeh-incident47-reviewed-host-runner-v1.js'));
  assert.equal(gitBlob(contents),registry.RUNNER_GIT_BLOB);
  assert.doesNotThrow(()=>registry.verifyRunner(()=>contents));
});
test('reviewed bytes are compiled and run from memory only after verifying both Git blobs',()=>{
  const x=fixture();
  try{
    const result=x.run();
    assert.equal(result.status,0,result.stderr);
    const payload=JSON.parse(result.stdout.trim());
    assert.equal(payload.schema_version,'prhm.host-action-result.v1');
    assert.equal(payload.action,registry.ACTION);
    assert.equal(payload.status,'GUARD_APPLIED_AND_NEGATIVE_TEST_PASS');
    assert.equal(payload.rollback_performed,false);
  }finally{x.clean()}
});
test('malicious replacement of Python source after first verification never executes',()=>{
  const x=fixture();
  try{
    fs.appendFileSync(x.p,'open('+JSON.stringify(x.marker)+',"w").write("unsafe")\n');
    const result=x.run();
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/reviewed_python_source_changed/);
    assert.equal(fs.existsSync(x.marker),false);
  }finally{x.clean()}
});
test('replaced policy after early verification cannot reach install_guard',()=>{
  const x=fixture();
  try{
    fs.appendFileSync(x.q,'# attacker policy change\n');
    const result=x.run();
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/reviewed_apache_policy_changed/);
  }finally{x.clean()}
});
test('symlink replacement of reviewed Python source cannot be followed',()=>{
  const x=fixture();
  try{
    const other=x.p+'.moved';
    fs.renameSync(x.p,other);fs.symlinkSync(other,x.p);
    const result=x.run();
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/OSError|Too many levels of symbolic links/);
  }finally{x.clean()}
});
test('no CLI approval bypass is introduced by hardened runner',()=>{
  const result=cp.spawnSync(process.execPath,
    [path.join(__dirname,'drtarjomeh-incident47-reviewed-host-runner-v1.js'),'--apply'],{encoding:'utf8'});
  assert.equal(result.status,64);
  assert.match(result.stderr,/No CLI/);
  assert.doesNotMatch(runner.INVOKE_PYTHON,/spec.loader.exec_module/);
  assert.match(runner.INVOKE_PYTHON,/os.O_NOFOLLOW/);
  assert.match(runner.INVOKE_PYTHON,/exec\(compile\(source,p,'exec'\),m.__dict__\)/);
});
