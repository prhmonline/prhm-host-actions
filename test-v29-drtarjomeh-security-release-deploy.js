'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');

const IMPL=path.join(__dirname,'bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js');
let m=null;
try{ m=require(IMPL); }catch(_e){ m=null; }

const EXPECTED_PAYLOAD=[
  'api/config/main-local.php',
  'api/config/web.php',
  'api/web/index.php',
  'backend/web/index.php',
  'common/components/DisabledSmsService.php',
  'common/config/base.php',
  'common/config/base_env.php',
  'common/config/env/dev.php',
  'common/config/env/dev_m.php',
  'common/config/env/devmp.php',
  'common/config/env/drtarjomeh-ir.php',
  'common/config/env/prod.php',
  'common/config/load-environment.php',
  'common/config/params.php',
  'console/config/main.php',
  'core/helpers/sms/webservice/mediana.php',
  'environments/prod/yii',
  'frontend/web/index.php',
  'panel/web/index.php',
  'scripts/probe-runtime-bootstrap.php',
  'scripts/test-environment-loader.php',
  'site_configs/drtarjomeh-ir.php',
  'translator/web/index.php',
  'yii',
];

test('v29 bootstrap exists',()=>{
  assert.ok(m,'v29 bootstrap missing');
});

test('exports fixed DrTarjomeh security identity',()=>{
  assert.equal(m.ACTION,'drtarjomeh_security_release_deploy_v1');
  assert.equal(m.OPERATION,'host_action.drtarjomeh_security_release_deploy_v1');
  assert.equal(m.TARGET_COMMIT,'f22b1d17801239f7539f84e5aa8b91250c87dc58');
  assert.equal(m.EXPECTED_RELEASE,'20260805-011747-672d32f490bd');
  assert.equal(m.PRODUCTION_POINTER,'/home/drtarjomeh/domains/drtarjomeh.ir/public_html');
  assert.equal(m.RELEASES_ROOT,'/home/drtarjomeh/domains/drtarjomeh.ir/releases');
  assert.equal(m.ENV_PATH,'/etc/drtarjomeh/production.env');
});

test('payload is exactly the approved 24-path runtime/security set',()=>{
  const paths=Object.keys(m.PAYLOAD||{}).sort();
  assert.deepEqual(paths,[...EXPECTED_PAYLOAD].sort());
  for(const rel of paths){
    assert.equal(path.isAbsolute(rel),false,`absolute payload path: ${rel}`);
    assert.equal(rel.split('/').includes('..'),false,`unsafe payload path: ${rel}`);
  }
  for(const excluded of ['.env.production.example','.github/workflows/secret-scan.yml','scripts/scan-tracked-secrets.py']){
    assert.equal(paths.includes(excluded),false,`excluded file present: ${excluded}`);
  }
});

test('fixed smoke contract is immutable and public-root only',()=>{
  assert.deepEqual(m.SMOKE,{
    host:'drtarjomeh.ir',
    path:'/',
    status_min:200,
    status_max:399,
    forbidden_body:'Internal Server Error',
  });
});
