'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const m=require('./drtarjomeh-incident47-production-readiness-v1.js');
const pins=require('./drtarjomeh-incident47-l4-registration-candidate-v1.js');

const mocks=()=>{
  const reads=[],execs=[];
  const reader={
    lstatSync(p){reads.push(p);throw Object.assign(new Error('missing'),{code:'ENOENT'});},
    readFileSync(){throw Error('unexpected-read')},
    realpathSync(p){return p}
  };
  const run=(cmd,args)=>{execs.push({cmd,args});return cmd==='/usr/sbin/apachectl'?'Syntax OK':null;};
  return {reader,run,reads,execs};
};
test('missing application checkout and artifacts never authorize production',()=>{
  const t=mocks(),value=m.inspect({read:t.reader,run:t.run,now:()=>'2026-10-11T00:00:00Z'});
  assert.equal(value.status,'BLOCKED');
  assert.equal(value.registration_authorized,false);
  assert.equal(value.production_mutation,false);
  assert.equal(value.security_guard_active,false);
  assert.equal(value.indicators.suspicious_exact_preimages,0);
  assert.equal(value.indicators.sidecar_configs_present,0);
  assert.ok(value.blockers.includes('SOURCE_APP_CHECKOUT_SHA_MISMATCH'));
  assert.ok(value.blockers.includes('MISSING_OR_DRIFTED_APP_SCRIPT'));
  assert.ok(value.blockers.includes('MISSING_OR_DRIFTED_APP_CONF'));
});
test('Git invocation binds safe.directory to the exact scoped checkout',()=>{
  const t=mocks();m.inspect({read:t.reader,run:t.run});
  const git=t.execs.filter(e=>e.cmd==='/usr/bin/git');
  assert.equal(git.length,2);
  assert.deepEqual(git[0].args,['-c','safe.directory='+m.CHECKOUT,'-C',m.CHECKOUT,'rev-parse','HEAD']);
  assert.deepEqual(git[1].args,['-c','safe.directory='+m.CHECKOUT,'-C',m.CHECKOUT,
    'status','--porcelain','--untracked-files=no']);
  assert.deepEqual(t.execs.map(e=>e.cmd),
    ['/usr/bin/git','/usr/bin/git','/usr/sbin/apachectl']);
  assert.equal(t.execs.some(e=>e.cmd.includes('sudo')||e.args.includes('reload')),false);
});
test('current source pins and suspect hashes are fixed and scoped',()=>{
  assert.equal(m.SUSPECTS.length,5);
  assert.equal(m.CONFIGS.length,7);
  assert.equal(Object.keys(m.FILES).length,2);
  assert.ok(m.SUSPECTS.every(x=>/^[a-f0-9]{64}$/.test(x.sha)&&
     !x.rel.startsWith('/')&&!x.rel.includes('..')));
  assert.equal(pins.SOURCE_COMMIT,'c1e03335f5b9c963672af1050089d8e197a729ef');
  assert.ok(m.EXPECTED_RELEASE.includes('20261010-security-5d4e6cf0'));
});
test('symlinks and large/nonregular files fail closed',()=>{
  const tests=[
    {isSymbolicLink:()=>true,isFile:()=>false,size:10},
    {isSymbolicLink:()=>false,isFile:()=>false,size:10},
    {isSymbolicLink:()=>false,isFile:()=>true,size:3*1024*1024}
  ];
  for(const st of tests){
    const fake={lstatSync:()=>st,readFileSync:()=>{throw Error('unsafe-read');}};
    assert.equal(m.safeRead(fake,'/anything'),null);
  }
});
test('Apache failure and pre-existing guard are explicit blockers',()=>{
  const t=mocks();
  const guard='/etc/httpd/conf.d/95-drt-wordpress-uploads-deny.conf';
  const state={isSymbolicLink:()=>false,isFile:()=>true,
    size:8,dev:1,ino:21,mtimeMs:55};
  t.reader.lstatSync=p=>p===guard?state:(()=>{throw Error('absent')})();
  t.reader.openSync=p=>p===guard?21:(()=>{throw Error('absent')})();
  t.reader.fstatSync=fd=>fd===21?state:(()=>{throw Error('bad fd')})();
  t.reader.readFileSync=fd=>fd===21?Buffer.from('guardabc'):(()=>{throw Error('bad fd')})();
  t.reader.closeSync=()=>{};
  const out=m.inspect({read:t.reader,run:()=>null});
  assert.equal(out.indicators.apache_guard_installed,true);
  assert.equal(out.security_guard_present,true);
  assert.equal(out.security_guard_active,false);
  assert.equal(out.effective_php_denial_verified,false);
  assert.ok(out.missing_effectiveness_evidence.includes('ORIGIN_HTTPS_BENIGN_PHP_403'));
  assert.ok(out.blockers.includes('GUARD_ALREADY_INSTALLED_RECHECK_POLICY'));
  assert.ok(out.blockers.includes('APACHE_SYNTAX_FAIL'));
});
test('no direct apply/install or write-capable CLI exists',()=>{
  const p=path.join(__dirname,'drtarjomeh-incident47-production-readiness-v1.js');
  for(const args of [['--apply'],['--install'],['--readonly','--apply'],[]]){
    const run=cp.spawnSync(process.execPath,[p,...args],{encoding:'utf8',timeout:5000});
    assert.equal(run.status,3);
    assert.match(run.stderr,/I47_READONLY_PREFLIGHT_FAILED/);
  }
  const src=fs.readFileSync(p,'utf8');
  assert.doesNotMatch(src,/writeFileSync|renameSync|unlinkSync|mkdirSync|execFileSync|systemctl|curl/);
});
test('transaction result does not impersonate the approval authority',()=>{
  const tx=fs.readFileSync(path.join(__dirname,
    'drtarjomeh-incident47-signed-registration-transaction-v1.js'),'utf8');
  assert.match(tx,/authorization_attested_by_transaction:false/);
  assert.doesNotMatch(tx,/approval_consumed_by_trusted_dispatcher:true/);
});

test('regular bounded forensic source is read only through the SAME verified fd',()=>{
  const os=require('node:os');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'i47-readonly-fd-'));
  const file=path.join(folder,'benign.txt');
  try{
    fs.writeFileSync(file,Buffer.from('safe-static-probe'),{mode:0o600});
    const opened=[];
    const traced={
      lstatSync:fs.lstatSync.bind(fs),
      openSync:(p,flags)=>{opened.push({p,flags});return fs.openSync(p,flags)},
      fstatSync:fs.fstatSync.bind(fs),
      readFileSync:(fd)=>{assert.equal(typeof fd,'number');return fs.readFileSync(fd)},
      closeSync:fs.closeSync.bind(fs)
    };
    assert.equal(m.safeRead(traced,file).toString(),'safe-static-probe');
    assert.equal(opened.length,1);
    assert.ok((opened[0].flags & fs.constants.O_NOFOLLOW)!==0);
    const link=path.join(folder,'untrusted-link');
    fs.symlinkSync(file,link);
    assert.equal(m.safeRead(traced,link),null);
  }finally{fs.rmSync(folder,{recursive:true,force:true})}
});
test('path replacement after lstat never returns swapped forensic bytes',()=>{
  const os=require('node:os');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'i47-readonly-swap-'));
  const file=path.join(folder,'tracked.txt');
  try{
    fs.writeFileSync(file,'known-initial-data',{mode:0o600});
    const reader={
      lstatSync:fs.lstatSync.bind(fs),
      openSync:(p,flags)=>{
        fs.renameSync(file,file+'.original');
        fs.writeFileSync(file,'malicious-new-data',{mode:0o600});
        return fs.openSync(p,flags);
      },
      fstatSync:fs.fstatSync.bind(fs),
      readFileSync:fs.readFileSync.bind(fs),
      closeSync:fs.closeSync.bind(fs)
    };
    assert.equal(m.safeRead(reader,file),null);
  }finally{fs.rmSync(folder,{recursive:true,force:true})}
});
test('in-place content change after fd read is discarded from readiness evidence',()=>{
  const os=require('node:os');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'i47-readonly-mutation-'));
  const file=path.join(folder,'tracked.txt');
  try{
    fs.writeFileSync(file,'known-initial-data',{mode:0o600});
    const reader={
      lstatSync:fs.lstatSync.bind(fs),openSync:fs.openSync.bind(fs),
      fstatSync:fs.fstatSync.bind(fs),
      readFileSync:(fd)=>{
        const bytes=fs.readFileSync(fd);
        fs.appendFileSync(file,'malicious-append');
        return bytes;
      },
      closeSync:fs.closeSync.bind(fs)
    };
    assert.equal(m.safeRead(reader,file),null);
  }finally{fs.rmSync(folder,{recursive:true,force:true})}
});
test('present Apache guard cannot be advertised as active without negative-test evidence',()=>{
  const src=fs.readFileSync(path.join(__dirname,'drtarjomeh-incident47-production-readiness-v1.js'),'utf8');
  assert.match(src,/security_guard_active:false/);
  assert.match(src,/effective_php_denial_verified:false/);
  assert.doesNotMatch(src,/security_guard_active:indicators\.apache_guard_installed/);
  assert.ok(m.EXPECTED_RELEASE.endsWith('20261010-security-5d4e6cf0'),
    'legacy release pin intentionally remains fail closed against current active release');
});
