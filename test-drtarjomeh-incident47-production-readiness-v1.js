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
  assert.equal(pins.SOURCE_COMMIT,'e20f4055610d9e61bd8ec42e4d271d97f7433ace');
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
  t.reader.lstatSync=p=>p===guard?
     ({isSymbolicLink:()=>false,isFile:()=>true,size:8}):
     (()=>{throw Error('absent');})();
  t.reader.readFileSync=p=>p===guard?Buffer.from('guardabc'):Buffer.alloc(0);
  const out=m.inspect({read:t.reader,run:()=>null});
  assert.equal(out.indicators.apache_guard_installed,true);
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
