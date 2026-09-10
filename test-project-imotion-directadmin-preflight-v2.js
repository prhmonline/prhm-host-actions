'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const artifact=path.join(__dirname,'project-imotion-directadmin-preflight-v2.js');
assert.equal(fs.existsSync(artifact),true,'artifact must exist');
const src=fs.readFileSync(artifact,'utf8');
assert.match(src,/const IMOTION_DA_TARGET='10\.71\.0\.10'/);
assert.doesNotMatch(src,/10\.71\.0\.117/);
assert.match(src,/imotion_directadmin_preflight_v2/);
assert.match(src,/PROJECT_EXEC_NAME='project_exec_v1'/);
assert.match(src,/StrictHostKeyChecking=yes/);
assert.match(src,/UserKnownHostsFile=/);
assert.match(src,/GlobalKnownHostsFile=\/dev\/null/);
assert.match(src,/UpdateHostKeys=no/);
assert.doesNotMatch(src,/StrictHostKeyChecking=no/);
assert.match(src,/ssh-keyscan/);
for(const domain of ['imotion.ir','admin.imotion.ir','gym.imotion.ir','sale.imotion.ir','i-motion.ir','admin.i-motion.ir','test.i-motion.ir','imotion-iran.ir']){
  assert.equal(src.includes(`'${domain}'`),true,`missing fixed domain ${domain}`);
}
for(const field of ['host_key_bound:true','host_key_fingerprint:','directadmin_version:','admin_user:','service_active:','port_2222_listening:','api_url_capable:','login_url_capable:','taskq_capable:','db_client:','user_imotion_absent:','domain_owners:','production_mutation:false','database_mutation:false']){
  assert.equal(src.includes(field),true,`missing evidence contract field ${field}`);
}
assert.match(src,/readOnlyHint:true/);
assert.match(src,/destructiveHint:false/);
assert.match(src,/inputSchema:\{\}/);
for(const forbidden of ['CMD_API_ACCOUNT_USER','useradd ','action=create&add=Submit','passwd=','delete=yes']){
  assert.equal(src.includes(forbidden),false,`read-only artifact contains mutation marker: ${forbidden}`);
}
const check=cp.spawnSync(process.execPath,['--input-type=module','--check','-'],{input:src,encoding:'utf8'});
assert.equal(check.status,0,check.stderr||'module syntax check failed');
console.log(JSON.stringify({ok:true,test:'imotion-directadmin-preflight-v2-contract',preserves_project_exec:true,production_mutation:false}));
