#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const adapter=require('./deployhq-control-adapter-v1.js');
const boot=require('./bootstrap-deployhq-control-adapter-v1.js');

test('runtime listener is fixed loopback only',()=>{
 assert.deepEqual(adapter.LISTEN,{host:'127.0.0.1',port:8791});
 assert.throws(()=>adapter.validateListen({host:'0.0.0.0',port:8791}),/non_loopback_bind_forbidden/);
 assert.doesNotThrow(()=>adapter.validateListen(adapter.LISTEN));
});
test('unit uses two LoadCredential entries and no token environment',()=>{
 const u=boot.renderUnit();
 assert.match(u,/LoadCredential=deployhq_email:\/etc\/prhm-credentials\/deployhq\/email/);
 assert.match(u,/LoadCredential=deployhq_api_key:\/etc\/prhm-credentials\/deployhq\/api-key/);
 assert.doesNotMatch(u,/Environment=.*(TOKEN|API_KEY|PASSWORD|SECRET)/i);
 assert.match(u,/NoNewPrivileges=true/); assert.match(u,/PrivateTmp=true/); assert.match(u,/ProtectSystem=strict/); assert.match(u,/ProtectHome=true/);
 assert.match(u,/RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX/); assert.match(u,/StateDirectory=prhm-deployhq-control/);
 assert.match(u,/ExecStart=\/usr\/local\/bin\/prhm-node \/opt\/prhm-deployhq-control\/server\.js --serve/);
});
test('preflight is read-only and requires root-owned 0600 credential sources',()=>{
 const stat=(p)=>({isFile:()=>true,uid:0,mode:0o100600,size:p.endsWith('api-key')?40:20});
 const readFile=(p)=>Buffer.from(p.endsWith('api-key')?'K'.repeat(40):'user@example.test');
 const r=boot.preflight({stat,readFile}); assert.equal(r.ok,true); assert.equal(r.preflight_only,true); assert.equal(r.production_mutation,false); assert.equal(r.credential_present,true);
 assert.match(r.email_fingerprint,/^[0-9a-f]{12}$/); assert.match(r.api_key_fingerprint,/^[0-9a-f]{12}$/);
});
test('preflight fails closed when credential source is missing or too permissive',()=>{
 assert.throws(()=>boot.preflight({stat:()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'})},readFile:()=>Buffer.from('x')}),/deployhq_credential_source_missing/);
 assert.throws(()=>boot.preflight({stat:()=>({isFile:()=>true,uid:0,mode:0o100644,size:40}),readFile:()=>Buffer.from('x')}),/deployhq_credential_source_mode_invalid/);
});
test('bootstrap has explicit rollback-owned paths and preflight argument gate',()=>{
 assert.deepEqual(boot.PATHS,{installDir:'/opt/prhm-deployhq-control',server:'/opt/prhm-deployhq-control/server.js',unit:'/etc/systemd/system/prhm-deployhq-control.service',backupRoot:'/var/backups/prhm-deployhq-control-v1',emailSource:'/etc/prhm-credentials/deployhq/email',apiKeySource:'/etc/prhm-credentials/deployhq/api-key'});
 assert.equal(typeof boot.apply,'function'); assert.equal(typeof boot.rollback,'function');
});
