'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const p=require('./honartik-u06-native-root-mariadb-identity-v1.cjs');
test('immutable exact live MariaDB 10.6 topology, credential and project scope',()=>{
 assert.equal(p.P.host,'prhm-production.prhm.ir');
 assert.equal(p.P.container,'prhm-mariadb');
 assert.equal(p.P.network,'host');
 assert.equal(p.P.image,'sha256:27e8ebbe7dde20c1ec66c864629109cfcad003843315929ee25b262bc11fbef3');
 assert.equal(p.P.database,'honartik_db');
 assert.equal(p.P.account,'honartik_universal_backup');
 assert.equal(p.P.account_host,'127.0.0.1');
 assert.equal(p.P.credential,'/etc/deploy-control/secrets/honartik_back/mysql.cnf');
 assert.equal(p.P.profile_sha,'79783874cb5170eec3dedcc536f713c4567c585e118f881c1035862a7bba8698');
 assert.equal(p.P.adapter_sha,'d81223e31bde684f83d1b8b3c93a8fdf2bd4797db33159bf681e6d3898ade2a3');
});
test('not a standalone account installer or secret-reading command surface',()=>{
 assert.equal(p.ROOT_ACTION_REGISTERED,false);
 assert.equal(p.DIRECT_APPLY_EXPORTED,false);
 assert.equal(p.PRODUCTION_IDENTITY_CREATED,false);
 assert.equal(p.provision,undefined);
 assert.equal(p.exec,undefined);
 assert.equal(p.apply,undefined);
 assert.equal(p.rollback,undefined);
 assert.equal(Object.isFrozen(p),true);
 assert.equal(Object.isFrozen(p.P),true);
});
test('live creation needs Root trust and official signed-consumed L4 before any write',()=>{
 if(process.getuid()!==0)assert.throws(
  ()=>p.createLiveBoundProvider('22222222-2222-4222-8222-222222222222',()=>null),
  /executor_uid_mismatch/);
 const src=fs.readFileSync(require.resolve('./honartik-u06-native-root-mariadb-identity-v1.cjs'),'utf8');
 assert.ok(src.indexOf('t.reserveNativeLevel4ReplayFence(F,journal,approval)')>=0);
 assert.ok(src.indexOf('armed=journal.id')>src.indexOf('t.reserveNativeLevel4ReplayFence(F,journal,approval)'));
 assert.ok(src.indexOf('armed=null;return provisionAfterOfficialL4()')>src.indexOf('armed=journal.id'));
 assert.ok(src.indexOf('preflight();')>=0);
 assert.ok(src.includes('CREATE USER '));
 assert.ok(src.includes('GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON honartik_db.*'));
 assert.ok(src.includes('fs.constants.O_EXCL'));
 assert.ok(src.includes('fs.fsyncSync(fd)'));
 assert.ok(src.includes('SELECT COUNT(*) FROM mysql.user WHERE User='));
 assert.ok(src.includes('rollback'));
 assert.ok(!src.includes('process.argv'));
 assert.ok(!src.includes('execSync('));
 assert.ok(!src.includes('new Function'));
});
