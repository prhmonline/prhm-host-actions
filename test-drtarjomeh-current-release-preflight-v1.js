'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const m=require('./drtarjomeh-current-release-preflight-v1.js');
const old=require('./bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js');

function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'drt-audit-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const root=path.join(base,'releases');
  const current=path.join(root,m.EXPECTED_RELEASE);
  const pointer=path.join(base,'public_html');
  const env=path.join(base,'private','production.env');
  fs.mkdirSync(current,{recursive:true});
  fs.mkdirSync(path.dirname(env),{recursive:true});
  const secret='FAKE_TEST_ONLY_SECRET_DO_NOT_LOG_1234';
  for(const rel of m.FILES){
    const p=path.join(current,rel);
    fs.mkdirSync(path.dirname(p),{recursive:true});
    fs.writeFileSync(p,secret);
  }
  fs.writeFileSync(env,secret,{mode:0o600});
  fs.chmodSync(env,0o600);
  fs.symlinkSync(current,pointer,'dir');
  return {base,root,current,pointer,env,secret,
    opts:{releasesRoot:root,pointer,env}};
}
test('pins approved git commit and expected Oct-06 release; 24 fixed paths',()=>{
  assert.equal(m.SOURCE_COMMIT,'f22b1d17801239f7539f84e5aa8b91250c87dc58');
  assert.equal(m.EXPECTED_RELEASE,'20261006-224241-0e8686eed30f');
  assert.deepEqual([...m.FILES].sort(),Object.keys(old.PAYLOAD).sort());
  assert.equal(m.FILES.length,24);
});
test('fixture inventory is read-only, SHA-bound, and never grants deploy approval',t=>{
  const f=fixture(t);
  const before=fs.readFileSync(path.join(f.current,m.FILES[0]));
  const out=m.preflight(fs,f.opts);
  assert.equal(out.pointer_identity,'MATCH');
  assert.deepEqual(out.summary,{regular:24,missing:0,restricted:0});
  assert.equal(out.files.length,24);
  assert.ok(out.files.every(x=>x.status==='REGULAR' && /^[a-f0-9]{64}$/.test(x.sha256)));
  assert.equal(out.audit_only,true);
  assert.equal(out.production_mutation,false);
  assert.equal(out.cutover_authorized,false);
  assert.match(out.gate,/BLOCKED/);
  assert.equal(out.protected_env.status,'REGULAR');
  assert.equal(out.protected_env.mode,0o600);
  assert.equal(out.protected_env.contents_read,false);
  assert.ok(!JSON.stringify(out).includes(f.secret));
  assert.deepEqual(fs.readFileSync(path.join(f.current,m.FILES[0])),before);
});
test('unexpected release identity is a hard block without file traversal',t=>{
  const f=fixture(t);
  fs.unlinkSync(f.pointer);
  fs.symlinkSync(f.base,f.pointer,'dir');
  const out=m.preflight(fs,f.opts);
  assert.equal(out.pointer_identity,'MISMATCH');
  assert.equal(out.files.length,0);
  assert.equal(out.cutover_authorized,false);
});
test('missing source files are reported without silent fallback',t=>{
  const f=fixture(t);
  fs.unlinkSync(path.join(f.current,'yii'));
  const out=m.preflight(fs,f.opts);
  assert.equal(out.files.find(x=>x.path==='yii').status,'MISSING');
  assert.equal(out.summary.missing,1);
  assert.match(out.gate,/BLOCKED/);
});
test('nested symlink is reported but not followed outside the release',t=>{
  const f=fixture(t);
  fs.rmSync(path.join(f.current,'scripts'),{recursive:true});
  fs.symlinkSync(f.base,path.join(f.current,'scripts'),'dir');
  const out=m.preflight(fs,f.opts);
  assert.equal(out.files.find(x=>x.path==='scripts/probe-runtime-bootstrap.php').status,'PARENT_SYMLINK');
  assert.equal(out.summary.restricted,2);
});
test('protected environment is metadata-only, never hashed or read',t=>{
  const f=fixture(t);
  const wrapped={...fs,
    lstatSync:fs.lstatSync.bind(fs),realpathSync:fs.realpathSync.bind(fs),
    readFileSync(file){assert.notEqual(file,f.env,'protected environment was read');return fs.readFileSync(file);}
  };
  const good=m.preflight(wrapped,f.opts);
  assert.equal(good.protected_env.mode,0o600);
  assert.ok(!('sha256' in good.protected_env));
  fs.chmodSync(f.env,0o644);
  const bad=m.preflight(wrapped,f.opts);
  assert.equal(bad.protected_env.permission_gate,'MODE_UNSAFE');
  assert.equal(bad.cutover_authorized,false);
});
test('unsafe path inputs are rejected before any traversal',()=>{
  for(const p of ['../etc/passwd','/etc/passwd','x//y','x/./y','x/../y','']){
    assert.equal(m.isSafeRelative(p),false);
    assert.equal(m.inventoryFile(fs,'/tmp',p).status,'UNSAFE_PATH');
  }
});
test('CLI accepts no arbitrary root, path, or deploy parameter',()=>{
  const r=spawnSync(process.execPath,[path.join(__dirname,'drtarjomeh-current-release-preflight-v1.js'),'--audit-only','--root=/tmp'],{encoding:'utf8'});
  assert.equal(r.status,2);
  assert.match(r.stderr,/Usage/);
  assert.equal(r.stdout,'');
});
