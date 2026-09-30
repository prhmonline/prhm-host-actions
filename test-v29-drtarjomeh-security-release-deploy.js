'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');

const IMPL=path.join(__dirname,'bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js');
let m=null;
try{ m=require(IMPL); }catch(_e){ m=null; }

const EXPECTED_PAYLOAD=[
  'api/config/main-local.php','api/config/web.php','api/web/index.php','backend/web/index.php',
  'common/components/DisabledSmsService.php','common/config/base.php','common/config/base_env.php',
  'common/config/env/dev.php','common/config/env/dev_m.php','common/config/env/devmp.php',
  'common/config/env/drtarjomeh-ir.php','common/config/env/prod.php','common/config/load-environment.php',
  'common/config/params.php','console/config/main.php','core/helpers/sms/webservice/mediana.php',
  'environments/prod/yii','frontend/web/index.php','panel/web/index.php','scripts/probe-runtime-bootstrap.php',
  'scripts/test-environment-loader.php','site_configs/drtarjomeh-ir.php','translator/web/index.php','yii',
];

function requireImpl(){ assert.ok(m,'v29 bootstrap missing'); return m; }

test('v29 bootstrap exists',()=>{ assert.ok(m,'v29 bootstrap missing'); });

test('exports fixed DrTarjomeh security identity',()=>{
  const x=requireImpl();
  assert.equal(x.ACTION,'drtarjomeh_security_release_deploy_v1');
  assert.equal(x.OPERATION,'host_action.drtarjomeh_security_release_deploy_v1');
  assert.equal(x.TARGET_COMMIT,'f22b1d17801239f7539f84e5aa8b91250c87dc58');
  assert.equal(x.EXPECTED_RELEASE,'20260805-011747-672d32f490bd');
  assert.equal(x.PRODUCTION_POINTER,'/home/drtarjomeh/domains/drtarjomeh.ir/public_html');
  assert.equal(x.RELEASES_ROOT,'/home/drtarjomeh/domains/drtarjomeh.ir/releases');
  assert.equal(x.SOURCE_REPOSITORY,'/home/drtarjomeh/domains/drtarjomeh.ir/repository');
  assert.equal(x.ENV_PATH,'/etc/drtarjomeh/production.env');
});

test('payload is exactly the approved 24-path runtime/security set',()=>{
  const x=requireImpl();
  const paths=Object.keys(x.PAYLOAD||{}).sort();
  assert.deepEqual(paths,[...EXPECTED_PAYLOAD].sort());
  for(const rel of paths){
    assert.equal(path.isAbsolute(rel),false,`absolute payload path: ${rel}`);
    assert.equal(rel.split('/').includes('..'),false,`unsafe payload path: ${rel}`);
    assert.ok(Number.isInteger(x.PAYLOAD[rel].mode));
  }
  for(const excluded of ['.env.production.example','.github/workflows/secret-scan.yml','scripts/scan-tracked-secrets.py']){
    assert.equal(paths.includes(excluded),false,`excluded file present: ${excluded}`);
  }
  assert.doesNotThrow(()=>x.assertFixedPayload(x.PAYLOAD));
});

test('installer freezes target and preimage sha256 values into immutable manifest',()=>{
  const x=requireImpl();
  const target={};
  const pre={};
  EXPECTED_PAYLOAD.forEach((rel,i)=>{
    target[rel]=(i.toString(16).padStart(2,'0').repeat(32)).slice(0,64);
    pre[rel]=i%3===0?'absent':{sha256:((i+1).toString(16).padStart(2,'0').repeat(32)).slice(0,64),isFile:true,isSymlink:false};
  });
  const frozen=x.freezeManifest(target,pre);
  assert.equal(Object.isFrozen(frozen),true);
  assert.deepEqual(Object.keys(frozen).sort(),[...EXPECTED_PAYLOAD].sort());
  for(const rel of EXPECTED_PAYLOAD){
    assert.match(frozen[rel].target_sha256,/^[a-f0-9]{64}$/);
    assert.ok(frozen[rel].preimage==='absent'||/^[a-f0-9]{64}$/.test(frozen[rel].preimage));
    assert.ok(Number.isInteger(frozen[rel].mode));
    assert.equal(Object.isFrozen(frozen[rel]),true);
  }
  assert.throws(()=>x.freezeManifest({...target,[EXPECTED_PAYLOAD[0]]:'bad'},pre),/target_sha_invalid/);
  const missing={...pre}; delete missing[EXPECTED_PAYLOAD[1]];
  assert.throws(()=>x.freezeManifest(target,missing),/preimage_missing/);
});

test('fixed smoke contract is immutable and public-root only',()=>{
  const x=requireImpl();
  assert.deepEqual(x.SMOKE,{host:'drtarjomeh.ir',path:'/',status_min:200,status_max:399,forbidden_body:'Internal Server Error'});
});

test('release identity fails closed on any other realpath',()=>{
  const x=requireImpl();
  const expected='/home/drtarjomeh/domains/drtarjomeh.ir/releases/20260805-011747-672d32f490bd';
  assert.doesNotThrow(()=>x.assertExpectedRelease(expected));
  assert.throws(()=>x.assertExpectedRelease(expected+'-other'),/unexpected_release/);
});

test('payload path validator rejects absolute and traversal paths',()=>{
  const x=requireImpl();
  assert.throws(()=>x.assertSafeRelativePath('/etc/passwd'),/unsafe_payload_path/);
  assert.throws(()=>x.assertSafeRelativePath('../common/config/base.php'),/unsafe_payload_path/);
  assert.throws(()=>x.assertSafeRelativePath('common/../config/base.php'),/unsafe_payload_path/);
});

test('preimage validator rejects changed bytes and symlink targets',()=>{
  const x=requireImpl();
  const sha='a'.repeat(64);
  assert.doesNotThrow(()=>x.assertPreimage('common/config/base.php',sha,{exists:true,sha256:sha,isFile:true,isSymlink:false}));
  assert.throws(()=>x.assertPreimage('common/config/base.php',sha,{exists:true,sha256:'b'.repeat(64),isFile:true,isSymlink:false}),/preimage_sha_mismatch/);
  assert.throws(()=>x.assertPreimage('common/config/base.php',sha,{exists:true,sha256:sha,isFile:true,isSymlink:true}),/preimage_not_regular/);
});

test('absent preimage requires destination to be absent',()=>{
  const x=requireImpl();
  assert.doesNotThrow(()=>x.assertPreimage('common/config/load-environment.php','absent',{exists:false}));
  assert.throws(()=>x.assertPreimage('common/config/load-environment.php','absent',{exists:true,isFile:true,isSymlink:false,sha256:'c'.repeat(64)}),/preimage_expected_absent/);
});
